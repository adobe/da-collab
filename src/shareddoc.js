/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import {
  aem2doc, doc2aem, json2doc, doc2json,
} from '@da-tools/da-parser';
import debounce from './debounce.js';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

/**
 * Returns true for Cloudflare platform events that are expected during normal operation
 * (deployments, DO live migrations) and should not be treated as errors.
 * @param {Error} err
 */
export const isExpectedPlatformEvent = (err) => {
  const msg = err?.message ?? '';
  return msg.includes('This script has been upgraded')
    || msg.includes('cannot access storage because object has moved to a different machine');
};

export const logError = (err, ...args) => {
  // eslint-disable-next-line no-console
  (isExpectedPlatformEvent(err) ? console.log : console.error)(...args);
};

// disable gc when using snapshots!
const gcEnabled = false;

// The local cache of ydocs
const docs = new Map();

const messageSync = 0;
const messageAwareness = 1;
export const messageFlushRequest = 2;
export const messageFlushResponse = 3;
const MAX_STORAGE_KEYS = 128;
const MAX_STORAGE_VALUE_SIZE = 131072;
// Matches da-admin EMPTY_DOC_SIZE — the byte-length of doc2aem(empty ydoc).
// PUTs at or below this size are the deterministic empty stub; allowing one
// through when no client edit happened silently overwrites real customer content
// (and triggers da-admin's Restore Point fallback).
const EMPTY_DOC_SIZE = 83;

function getDocType(docName) {
  if (docName.endsWith('.json')) {
    return 'json';
  }
  if (docName.endsWith('.html')) {
    return 'html';
  }
  return 'html'; // default
}

/**
 * Close the WebSocket connection for a document. If there are no connections left, remove
 * the ydoc from the local cache map.
 * @param {ydoc} doc - the ydoc to close the connection for.
 * @param {WebSocket} conn - the websocket connection to close.
 */
export const closeConn = async (doc, conn, isReentrant = false) => {
  try {
    if (doc.conns.has(conn)) {
      const controlledIds = doc.conns.get(conn);
      doc.conns.delete(conn);
      try {
        awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
        /* c8 ignore start */
      } catch (err) {
        // we can ignore an exception here, closing the connection will remove the awareness states
        logError(err, '[docroom] Error while removing awareness states', err);
        /* c8 ignore end */
      }

      if (doc.conns.size === 0) {
        // Skip flushSave when called re-entrantly from persistence.update's closeAll
        // loop — the in-flight save owns persistence; awaiting savingPromise here
        // would deadlock because persistence.update hasn't returned yet.
        if (doc.flushSave && !isReentrant) {
          // eslint-disable-next-line no-console
          console.log('[docroom] Flushing pending save on last connection close', doc.name);
          await doc.flushSave();
        }
        const duration = conn.connectedAt ? Date.now() - conn.connectedAt : 0;
        // eslint-disable-next-line no-console
        console.log('[docroom] Last connection closed', doc.name, `duration: ${duration}ms`, `unsaved: ${!!doc.hasClientChanged}`);
        doc.destroy();
        docs.delete(doc.name);
      }
    }
    conn.close();
  } catch (e) {
    /* c8 ignore start */
    // we can ignore an exception here, connection will be closed anyway
    logError(e, '[docroom] Error while closing connection', e);
    /* c8 ignore end */
  }
};

const send = (doc, conn, m) => {
  try {
    if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
      closeConn(doc, conn);
      return;
    }
    conn.send(m, (err) => err != null && closeConn(doc, conn));
  } catch (e) {
    logError(e, '[docroom] Error while sending message', e);
    closeConn(doc, conn);
  }
};

/**
 * Read the ydoc document state from durable object persistent storage. The format is as
 * in storeState function.
 * @param {string} docName - The document name
 * @param {TransactionalStorage} storage - The worker transactional storage
 * @returns {Promise<Uint8Array | undefined>} - The stored state or undefined if not found
 */
export const readState = async (docName, storage) => {
  const stored = await storage.list();
  if (stored.size === 0) {
    // eslint-disable-next-line no-console
    console.log('[docroom] No stored doc in persistence');
    return undefined;
  }

  if (stored.get('doc') !== docName) {
    // eslint-disable-next-line no-console
    console.log('[docroom] Docname mismatch in persistence. Expected:', docName, 'found:', stored.get('doc'), 'Deleting storage');
    await storage.deleteAll();
    return undefined;
  }

  if (stored.has('docstore')) {
    // eslint-disable-next-line no-console
    console.log('[docroom] Document found in persistence');
    return stored.get('docstore');
  }

  const data = [];
  for (let i = 0; i < stored.get('chunks'); i += 1) {
    const chunk = stored.get(`chunk_${i}`);

    // Note cannot use the spread operator here, as that goes via the stack and may lead to
    // stack overflow.
    for (let j = 0; j < chunk.length; j += 1) {
      data.push(chunk[j]);
    }
  }
  // eslint-disable-next-line no-console
  console.log('[docroom] Document data read');
  return new Uint8Array(data);
};

/**
 * Store the document in durable object persistent storage. The document is stored as one or
 * more byte arrays. Durable persistent storage is tied to each durable object, so the storage only
 * applies to the current document.
 * The durable object storage saves an object (keys and values) but there is a limit to the size
 * of the values. So if the state is too large, it is split into chunks.
 * The layout of the stored object is as follows:
 * a. State size less than max storage value size:
 *    serialized.doc = document name
 *    serialized.docstore = state of the document
 * b. State size greater than max storage value size:
 *    serialized.doc = document name
 *    serialized.chunks = number of chunks
 *    serialized.chunk_0 = first chunk
 *    ...
 *    serialized.chunk_n = last chunk, where n = chunks - 1
 * @param {string} docName - The document name
 * @param {Uint8Array} state - The Yjs document state, as produced by Y.encodeStateAsUpdate()
 * @param {TransactionalStorage} storage - The worker transactional storage
 * @param {number} chunkSize - The chunk size
 */
export const storeState = async (docName, state, storage, chunkSize = MAX_STORAGE_VALUE_SIZE) => {
  const oldChunkCount = await storage.get('chunks');

  let serialized;
  if (state.byteLength < chunkSize) {
    serialized = { docstore: state };
    if (oldChunkCount !== undefined) {
      const staleKeys = ['chunks', ...Array.from({ length: oldChunkCount }, (_, i) => `chunk_${i}`)];
      await storage.delete(staleKeys);
    }
  } else {
    serialized = {};
    let j = 0;
    for (let i = 0; i < state.length; i += chunkSize, j += 1) {
      serialized[`chunk_${j}`] = state.slice(i, i + chunkSize);
    }

    if (j >= MAX_STORAGE_KEYS) {
      // eslint-disable-next-line no-console
      console.error('[docroom] Object too big for worker storage', docName, j, MAX_STORAGE_KEYS);
      throw new Error('Object too big for worker storage');
    }

    serialized.chunks = j;
    await storage.delete('docstore');
    if (oldChunkCount !== undefined && oldChunkCount > j) {
      const extraKeys = Array.from({ length: oldChunkCount - j }, (_, i) => `chunk_${j + i}`);
      await storage.delete(extraKeys);
    }
  }
  serialized.doc = docName;

  await storage.put(serialized);
};

export const showError = (ydoc, err) => {
  try {
    const em = ydoc.getMap('error');

    // Perform the change in a transaction to avoid seeing a partial error
    ydoc.transact(() => {
      em.set('timestamp', Date.now());
      em.set('message', err.message);
      if (ydoc.sendStackTraces) {
        em.set('stack', err.stack);
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[docroom] Error while showing error', e, err);
  }
};

export const persistence = {
  closeConn,

  /**
   * Get the document from da-admin.
   * @param {string} docName - The document name
   * @param {string} auth - The authorization header
   * @param {object} daadmin - The da-admin worker service binding
   * @returns {Promise<string>} - The content of the document
   * @throws {Error} - If the document cannot be retrieved (including 404)
   */
  get: async (docName, auth, daadmin) => {
    const docType = getDocType(docName);
    const initalOpts = {};
    if (auth) {
      initalOpts.headers = new Headers({ Authorization: auth });
    }
    const initialReq = await daadmin.fetch(docName, initalOpts);
    if (initialReq.ok) {
      return docType === 'json' ? initialReq.json() : initialReq.text();
    } else {
      // eslint-disable-next-line no-console
      console.error(`[docroom] Unable to get resource from da-admin: ${initialReq.status} - ${initialReq.statusText}`);
      const err = new Error(`unable to get resource - status: ${initialReq.status}`);
      err.status = initialReq.status;
      throw err;
    }
  },

  /**
   * Store the content in da-admin.
   * @param {WSSharedDoc} ydoc - The Yjs document, which among other things contains the service
   * binding to da-admin.
   * @param {string} content - The content to store
   * @returns {Promise<object>} The response from da-admin.
   */
  put: async (ydoc, content) => {
    const mimeType = getDocType(ydoc.name) === 'json' ? 'application/json' : 'text/html';
    const blob = new Blob([content], { type: mimeType });

    const formData = new FormData();
    formData.append('data', blob);

    const opts = { method: 'PUT', body: formData };
    const keys = Array.from(ydoc.conns.keys());
    const allReadOnly = keys.length > 0 && keys.every((con) => con.readOnly === true);
    if (allReadOnly) {
      // eslint-disable-next-line no-console
      console.log('[docroom] All connections are read only, not storing');
      return { ok: true };
    }

    const headers = {
      'If-Match': '*',
      'X-DA-Initiator': 'collab',
    };

    const auth = keys
      .filter((con) => con.readOnly !== true)
      .map((con) => con.auth);

    if (auth.length > 0) {
      headers.Authorization = [...new Set(auth)].join(',');
    }

    opts.headers = new Headers(headers);

    if (blob.size <= EMPTY_DOC_SIZE) {
      // eslint-disable-next-line no-console
      console.warn('[docroom] Writing back an empty document', ydoc.name, blob.size);
    }

    const {
      ok, status, statusText, body,
    } = await ydoc.daadmin.fetch(ydoc.name, opts);

    if (body) {
      // tell CloudFlare to consider the request as completed
      body.cancel();
    }

    return {
      ok,
      status,
      statusText,
    };
  },

  /**
   * An update to the document has been received. Store it in da-admin.
   * @param {WSSharedDoc} ydoc - the ydoc that has been updated.
   * @param {string} current - the current content of the document previously
   * obtained from da-admin
   * @returns {Promise<string>} - the new content of the document in da-admin.
   */
  update: async (ydoc, current, docName) => {
    const docType = getDocType(docName);
    let closeAll = false;
    try {
      const content = docType === 'json' ? doc2json(ydoc) : doc2aem(ydoc);

      // Never overwrite real content with the deterministic empty stub when no
      // client edit produced it. Defends customer content against COR-31:
      // bindState fallbacks, awareness/storage-only updates, or transient
      // server-side transacts can otherwise debounce a stub PUT through.
      if (!ydoc.hasClientChanged && content.length <= EMPTY_DOC_SIZE) {
        // eslint-disable-next-line no-console
        console.log('[docroom] Skipping empty-stub PUT - no client edit', docName, content.length);
        return current;
      }

      if (current !== content) {
        // Only store the document if it was actually changed.
        const { ok, status, statusText } = await persistence.put(ydoc, content);

        if (!ok) {
          if (status === 412) {
            // Document doesn't exist - clean up cached state
            if (ydoc.storage) {
              try {
                await ydoc.storage.deleteAll();
                // eslint-disable-next-line no-console
                console.log('[docroom] Cleaned worker storage after 412 (document deleted)');
              } catch (storageErr) {
                // eslint-disable-next-line no-console
                console.error('[docroom] Failed to clean storage', storageErr);
              }
            }
          }
          closeAll = (status === 401 || status === 403 || status === 412);
          throw new Error(`${status} - ${statusText}`);
        }

        // eslint-disable-next-line no-console
        console.log('[docroom] Saved to da-admin', docName, `${content.length}b`);
        // Record what we just PUT so that on DO restart we can tell whether
        // CF storage is ahead of da-admin (safe to use) vs. da-admin was
        // externally modified (must use da-admin).
        if (ydoc.storage?.put) {
          try {
            await ydoc.storage.put('lastsync', content);
          } catch (storageErr) {
            // non-fatal: worst case the restore falls back to da-admin
            // eslint-disable-next-line no-console
            console.error('[docroom] Failed to write lastsync marker', storageErr);
          }
        }
        return content;
      }
    } catch (err) {
      if (err?.message?.startsWith('401')) {
        // eslint-disable-next-line no-console
        console.warn('[docroom] Failed to update document', docName, err.message);
      } else if (err?.message?.startsWith('403')) {
        // eslint-disable-next-line no-console
        console.log('[docroom] Failed to update document', docName, err.message);
      } else {
        // eslint-disable-next-line no-console
        console.error('[docroom] Failed to update document', docName, err);
      }
      showError(ydoc, err);
    }
    if (closeAll) {
      // We had an unauthorized from da-admin - lets reset the connections.
      // Pass isReentrant=true so closeConn skips flushSave here; the outer
      // save already handled (or failed to handle) persistence.
      for (const con of Array.from(ydoc.conns.keys())) {
        // eslint-disable-next-line no-await-in-loop
        await persistence.closeConn(ydoc, con, true);
      }
    }
    return current;
  },

  /**
   * Bind the Ydoc to the persistence layer.
   * @param {string} docName - the name of the document
   * @param {WSSharedDoc} ydoc - the new ydoc to be bound
   * @param {WebSocket} conn - the websocket connection
   * @param {TransactionalStorage} storage - the worker transactional storage object
   */
  bindState: async (docName, ydoc, conn, storage) => {
    const docType = getDocType(docName);
    let timingReadStateDuration;

    // Store storage reference for later use in persistence.update
    // eslint-disable-next-line no-param-reassign
    ydoc.storage = storage;

    let current;
    let restored = false; // True if restored from worker storage

    // Get document from da-admin (throws on error including 404)
    const timingBeforeDaAdminGet = Date.now();
    current = await persistence.get(docName, conn.auth, ydoc.daadmin);
    const timingDaAdminGetDuration = Date.now() - timingBeforeDaAdminGet;

    // Read the stored state from internal worker storage (errors are non-fatal)
    try {
      const timingBeforeReadState = Date.now();
      const stored = await readState(docName, storage);
      timingReadStateDuration = Date.now() - timingBeforeReadState;

      if (stored && stored.length > 0) {
        Y.applyUpdate(ydoc, stored);

        // CF storage is valid to use if:
        // 1. Its rendered content matches da-admin exactly (nothing pending), OR
        // 2. da-admin still has the same content as the last successful sync —
        //    meaning CF storage is ahead of da-admin (unsaved pending changes) but
        //    was built on top of it. Using CF storage preserves those pending changes.
        //    This correctly handles DO migration while a debounced save is in flight.
        //    If da-admin was externally modified since the last sync, lastSynced !==
        //    current, so we fall back to da-admin (external edit wins).
        const fromStorage = docType === 'json' ? doc2json(ydoc) : doc2aem(ydoc);
        const lastSynced = storage.get ? await storage.get('lastsync') : undefined;
        if (fromStorage === current || lastSynced === current) {
          restored = true;

          const syncState = fromStorage === current ? '(in sync with da-admin)' : '(has pending unsaved changes)';
          // eslint-disable-next-line no-console
          console.log('[docroom] Restored from worker persistence', docName, syncState);
        }
      }
    } catch (error) {
      logError(error, '[docroom] Problem restoring state from worker storage', error);
      if (!isExpectedPlatformEvent(error)) {
        showError(ydoc, error);
      }
    }

    if (!restored && current) {
      // The doc was not restored from worker persistence, so read it from da-admin,
      // but do this async to give the ydoc some time to get synced up first. Without
      // this timeout, the ydoc can get confused which may result in duplicated content.
      // eslint-disable-next-line no-console
      console.log('[docroom] Could not be restored, trying to restore from da-admin', docName);

      // Snapshot the state vector before yielding. If the client sends any Y.js update
      // before the timeout fires (e.g. an image whose FPO was replaced just before a
      // 412-triggered reconnect cleared worker storage), the state vector will advance
      // and we must NOT overwrite with the stale da-admin snapshot.
      const svBefore = Y.encodeStateVector(ydoc);

      setTimeout(async () => {
        if (ydoc === docs.get(docName)) {
          const svAfter = Y.encodeStateVector(ydoc);
          const clientHasUpdated = svBefore.length !== svAfter.length
            || svBefore.some((v, i) => v !== svAfter[i]);
          if (clientHasUpdated) {
            // eslint-disable-next-line no-console
            console.log('[docroom] Skipping da-admin reload: client state received', docName);
          } else {
            try {
              ydoc.transact(() => {
                if (docType === 'json') {
                  // Clear JSON structure
                  const ysheets = ydoc.getArray('sheets');
                  if (ysheets.length > 0) {
                    ysheets.delete(0, ysheets.length);
                  }
                  // restore from da-admin
                  json2doc(current, ydoc);
                } else {
                  // Clear HTML structure
                  const rootType = ydoc.getXmlFragment('prosemirror');
                  rootType.delete(0, rootType.length);
                  // clear all maps
                  ydoc.share.forEach((type) => {
                    if (type instanceof Y.Map) {
                      type.clear();
                    }
                  });
                  // Restore from da-admin
                  aem2doc(current, ydoc);
                }
              });

              // eslint-disable-next-line no-console
              console.log('[docroom] Restored from da-admin', docName, docType);
            } catch (error) {
              logError(error, '[docroom] Problem restoring state from da-admin', docName, error, current);
              if (!isExpectedPlatformEvent(error)) {
                showError(ydoc, error);
              }
            }
          }

          // Write lastsync anchor regardless of whether we restored or the client
          // had already sent updates. CF storage is now anchored to `current`, so
          // on DO restart we can detect it as a valid continuation even if no PUT
          // to da-admin has happened yet.
          if (storage?.put) {
            try {
              await storage.put('lastsync', current);
            } catch (storageErr) {
              // non-fatal
              // eslint-disable-next-line no-console
              console.error('[docroom] Failed to write lastsync after da-admin fetch', storageErr);
            }
          }
        }
      }, 1000);
    }

    ydoc.on('update', async () => {
      // Whenever we receive an update on the document store it in the local storage
      if (ydoc === docs.get(docName)) { // make sure this ydoc is still active
        try {
          await storeState(docName, Y.encodeStateAsUpdate(ydoc), storage);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[docroom] Failed to persist state to storage', docName, err);
        }
      }
    });

    let saving = false;
    let savingPromise = null;
    const saveToAdmin = async () => {
      if (saving) {
        return;
      }
      if (!current || ydoc !== docs.get(docName)) {
        return;
      }
      saving = true;
      savingPromise = (async () => {
        try {
          current = await persistence.update(ydoc, current, docName);
          // eslint-disable-next-line no-param-reassign
          ydoc.hasClientChanged = false;
        } finally {
          saving = false;
          savingPromise = null;
        }
      })();
      await savingPromise;
    };

    const debouncedSave = debounce(saveToAdmin, 2000, { maxWait: 10000 });
    ydoc.on('update', debouncedSave);

    ydoc.flushSave = async () => {
      debouncedSave.cancel();
      // If a save is already in flight, wait for it to complete before
      // starting a new one — ensures the ack is not sent before the PUT finishes.
      if (savingPromise) {
        await savingPromise;
      }
      await saveToAdmin();
    };

    ydoc.cancelSave = () => {
      debouncedSave.cancel();
    };

    const timingMap = new Map();
    timingMap.set('timingReadStateDuration', timingReadStateDuration);
    timingMap.set('timingDaAdminGetDuration', timingDaAdminGetDuration);
    return timingMap;
  },
};

export const updateHandler = (update, _origin, doc) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_, conn) => send(doc, conn, message));
};

/**
 * Our specialisation of the YDoc.
 */
export class WSSharedDoc extends Y.Doc {
  /**
   * Controls if showError should send stack traces
   * @type {boolean}
   */
  sendStackTraces = false;

  constructor(name) {
    super({ gc: gcEnabled });
    this.name = name;
    this.conns = new Map();
    // Flipped by messageListener whenever a sync message advances the state
    // vector. Gates the empty-stub PUT guard in persistence.update — see COR-31.
    this.hasClientChanged = false;
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = ({ added, updated, removed }, conn) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs = (this.conns.get(conn));
        if (connControlledIDs !== undefined) {
          added.forEach((clientID) => {
            connControlledIDs.add(clientID);
          });
          removed.forEach((clientID) => {
            connControlledIDs.delete(clientID);
          });
        }
      }
      // broadcast awareness update
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol
        .encodeAwarenessUpdate(this.awareness, changedClients));
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => {
        send(this, c, buff);
      });
    };
    this.awareness.on('update', awarenessChangeHandler);
    this.on('update', updateHandler);
  }

  destroy() {
    super.destroy();
    this.awareness.destroy();
  }
}

/**
 *
 * @param {string} docname - The name of the document
 * @param {WebSocket} conn - the WebSocket connection being initiated
 * @param {object} env - the durable object environment object
 * @param {TransactionalStorage} storage - the durable object storage object
 * @param {boolean} gc - whether garbage collection is enabled
 * @returns The Yjs document object, which may be shared across multiple sockets.
 */
export const getYDoc = async (docname, conn, env, storage, timingData, gc = true) => {
  let doc = docs.get(docname);
  if (doc === undefined) {
    // The doc is not yet in the cache, create a new one.
    doc = new WSSharedDoc(docname);
    doc.gc = gc;
    doc.sendStackTraces = String(env.RETURN_STACK_TRACES) === 'true';
    docs.set(docname, doc);
  }

  if (!doc.conns.get(conn)) {
    doc.conns.set(conn, new Set());
  }

  const uniqueConnections = new Set(doc.conns.keys().toArray().map((c) => c.auth || 'none'));
  // eslint-disable-next-line no-console
  console.log(`[docroom] Getting ydoc ${docname}`, `Connections (unique / total): ${uniqueConnections.size} / ${doc.conns.size}`);

  // Store the service binding to da-admin which we receive through the environment in the doc
  doc.daadmin = env.daadmin;
  if (!doc.promise) {
    // The doc is not yet bound to the persistence layer, do so now. The promise will be resolved
    // when bound.
    doc.promise = persistence.bindState(docname, doc, conn, storage);
  }

  // We wait for the promise, for second and subsequent connections to the same doc, this will
  // already be resolved.
  try {
    const timings = await doc.promise;
    if (timingData) {
      timings.forEach((v, k) => timingData.set(k, v));
    }
  } catch (e) {
    // Remove the connection before destroy to prevent the awareness broadcast
    // (triggered by destroy) from calling send() → closeConn() on this conn.
    doc.conns.delete(conn);
    // ensure to cleanup event handlers and timers
    doc.destroy();
    docs.delete(docname);
    throw e;
  }
  return doc;
};

// For testing
export const setYDoc = (docname, ydoc) => docs.set(docname, ydoc);

// This read sync message handles readonly connections
const readSyncMessage = (decoder, encoder, doc, readOnly, transactionOrigin) => {
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case syncProtocol.messageYjsSyncStep1:
      syncProtocol.readSyncStep1(decoder, encoder, doc);
      break;
    case syncProtocol.messageYjsSyncStep2:
      if (!readOnly) {
        syncProtocol.readSyncStep2(decoder, doc, transactionOrigin);
      }
      break;
    case syncProtocol.messageYjsUpdate:
      if (!readOnly) {
        syncProtocol.readUpdate(decoder, doc, transactionOrigin);
      }
      break;
    default:
      throw new Error('Unknown message type');
  }
  return messageType;
};

export const messageListener = async (conn, doc, message) => {
  let messageType;
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync: {
        encoding.writeVarUint(encoder, messageSync);
        const onChange = () => {
          doc.hasClientChanged = true;
        };
        doc.on('update', onChange);
        readSyncMessage(decoder, encoder, doc, conn.readOnly);
        doc.off('update', onChange);

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      }
      case messageAwareness: {
        awarenessProtocol
          .applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      }
      case messageFlushRequest: {
        const ackEncoder = encoding.createEncoder();
        encoding.writeVarUint(ackEncoder, messageFlushResponse);
        try {
          if (doc.flushSave) {
            await doc.flushSave();
          }
          encoding.writeVarUint(ackEncoder, 1); // ok
        } catch (flushErr) {
          logError(flushErr, '[docroom] flushSave failed', flushErr);
          encoding.writeVarUint(ackEncoder, 0); // not ok
          encoding.writeVarString(ackEncoder, flushErr.message || 'flush failed');
        }
        send(doc, conn, encoding.toUint8Array(ackEncoder));
        break;
      }
      default:
        break;
    }
  } catch (err) {
    logError(err, '[docroom] messageListener - Message', err.stack, err);
    if (!isExpectedPlatformEvent(err)) {
      showError(doc, err);
    }
  }
};

/**
 * Invalidate the worker storage for the document, which will ensure that when accessed
 * the worker will fetch the latest version of the document from the da-admin.
 * Invalidation is implemented by closing all client connections to the doc, which will
 * cause it to be reinitialised when accessed.
 * @param {string} docName - The name of the document
 * @returns true if the document was found and invalidated, false otherwise.
 */
export const invalidateFromAdmin = async (docName) => {
  // eslint-disable-next-line no-console
  console.log('[worker] Invalidate from Admin received', docName);
  const ydoc = docs.get(docName);
  if (ydoc) {
    // As we are closing all connections, the ydoc will be removed from the docs map
    ydoc.conns.forEach((_, c) => closeConn(ydoc, c));

    return true;
  } else {
    // eslint-disable-next-line no-console
    console.log('[worker] Document not found', docName);
  }
  return false;
};

/**
 * Called when a new (Yjs) WebSocket connection is being established.
 * @param {WebSocket} conn - The WebSocket connection
 * @param {string} docName - The name of the document
 * @param {object} env - The durable object environment object
 * @param {TransactionalStorage} storage - The worker transactional storage object
 * @param {boolean} hibernation - When true, skip event listener registration (CF Hibernation API
 *   handles message/close routing via class methods instead of addEventListener).
 * @returns {Promise<void>} - The return value of this
 */
export const setupWSConnection = async (conn, docName, env, storage, hibernation = false) => {
  const timingData = new Map();

  // eslint-disable-next-line no-param-reassign
  conn.binaryType = 'arraybuffer';
  // eslint-disable-next-line no-param-reassign
  conn.connectedAt = Date.now();

  if (!hibernation) {
    // Register close listener BEFORE any async operation so cleanup always fires,
    // even if the client disconnects while the document is still loading.
    conn.addEventListener('close', () => {
      const doc = docs.get(docName);
      if (doc) {
        closeConn(doc, conn);
      }
    });
  }

  // get doc, initialize if it does not exist yet
  const doc = await getYDoc(docName, conn, env, storage, timingData, true);

  if (!hibernation) {
    // listen and reply to events
    conn.addEventListener('message', (message) => messageListener(conn, doc, new Uint8Array(message.data)));
  }

  // put the following in a variables in a block so the interval handlers don't keep in in
  // scope
  try {
    // send sync step 1
    let encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol
        .encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())));
      send(doc, conn, encoding.toUint8Array(encoder));
    }
  } catch (err) {
    logError(err, '[docroom] Error while setting up WSConnection', docName, err);
  }

  return timingData;
};

/**
 * Handle an incoming WebSocket message from the Cloudflare Hibernation API.
 * Re-establishes the Yjs session if the DO was hibernated (doc not in memory).
 * @param {WebSocket} conn - The WebSocket connection
 * @param {string} docName - The document name
 * @param {object} env - The durable object environment
 * @param {TransactionalStorage} storage - The durable object storage
 * @param {ArrayBuffer|string} message - The raw message from the WebSocket
 */
export const handleWebSocketMessage = async (conn, docName, env, storage, message) => {
  let doc = docs.get(docName);
  if (!doc) {
    // DO was hibernated; re-establish Yjs state without re-registering event listeners
    await setupWSConnection(conn, docName, env, storage, true);
    doc = docs.get(docName);
  }
  if (doc) {
    messageListener(conn, doc, new Uint8Array(message));
  }
};

/**
 * Handle a WebSocket close event from the Cloudflare Hibernation API.
 * @param {WebSocket} conn - The WebSocket connection
 * @param {string} docName - The document name
 */
export const handleWebSocketClose = (conn, docName) => {
  const doc = docs.get(docName);
  if (doc) {
    closeConn(doc, conn);
  }
};
