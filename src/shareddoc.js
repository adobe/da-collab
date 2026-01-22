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
import debounce from 'lodash/debounce.js';
import { aem2doc, doc2aem } from '@da-tools/da-parser';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

// disable gc when using snapshots!
const gcEnabled = false;

// The local cache of ydocs
const docs = new Map();

const messageSync = 0;
const messageAwareness = 1;
const MAX_STORAGE_KEYS = 128;
const MAX_STORAGE_VALUE_SIZE = 131072;

/**
 * Close the WebSocket connection for a document. If there are no connections left, remove
 * the ydoc from the local cache map.
 * @param {ydoc} doc - the ydoc to close the connection for.
 * @param {WebSocket} conn - the websocket connection to close.
 */
export const closeConn = (doc, conn) => {
  try {
    if (doc.conns.has(conn)) {
      const controlledIds = doc.conns.get(conn);
      doc.conns.delete(conn);
      try {
        awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
        /* c8 ignore start */
      } catch (err) {
        // we can ignore an exception here, closing the connection will remove the awareness states
        // eslint-disable-next-line no-console
        console.error('[docroom] Error while removing awareness states', err);
        /* c8 ignore end */
      }

      if (doc.conns.size === 0) {
        // clear event handlers
        doc.destroy();
        docs.delete(doc.name);
      }
    }
    conn.close();
  } catch (e) {
    /* c8 ignore start */
    // we can ignore an exception here, connection will be closed anyway
    // eslint-disable-next-line no-console
    console.error('[docroom] Error while closing connection', e);
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
    // eslint-disable-next-line no-console
    console.error('[docroom] Error while sending message', e);
    closeConn(doc, conn);
  }
};

/**
 * Read the ydoc document state from durable object persistent storage. The format is as
 * in storeState function.
 * @param {string} docName - The document name
 * @param {TransactionalStorage} storage - The worker transactional storage
 * @returns {{ state: Uint8Array | undefined, etag: string | undefined }} - stored state and ETag
 */
export const readState = async (docName, storage) => {
  const stored = await storage.list();
  if (stored.size === 0) {
    // eslint-disable-next-line no-console
    console.log('[docroom] No stored doc in persistence');
    return { state: undefined, etag: undefined };
  }

  if (stored.get('doc') !== docName) {
    // eslint-disable-next-line no-console
    console.log(
      '[docroom] Docname mismatch in persistence. Expected:',
      docName,
      'found:',
      stored.get('doc'),
      'Deleting storage',
    );
    await storage.deleteAll();
    return { state: undefined, etag: undefined };
  }

  const etag = stored.get('etag');

  if (stored.has('docstore')) {
    // eslint-disable-next-line no-console
    console.log('[docroom] Document found in persistence', etag ? `(etag: ${etag})` : '');
    return { state: stored.get('docstore'), etag };
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
  console.log('[docroom] Document data read', etag ? `(etag: ${etag})` : '');
  return { state: new Uint8Array(data), etag };
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
 *    serialized.etag = ETag from da-admin (optional)
 * b. State size greater than max storage value size:
 *    serialized.doc = document name
 *    serialized.chunks = number of chunks
 *    serialized.chunk_0 = first chunk
 *    ...
 *    serialized.chunk_n = last chunk, where n = chunks - 1
 *    serialized.etag = ETag from da-admin (optional)
 * @param {string} docName - The document name
 * @param {Uint8Array} state - The Yjs document state, as produced by Y.encodeStateAsUpdate()
 * @param {TransactionalStorage} storage - The worker transactional storage
 * @param {string} etag - Optional ETag from da-admin for conditional GET
 * @param {number} chunkSize - The chunk size
 */
export const storeState = async (
  docName,
  state,
  storage,
  etag = undefined,
  chunkSize = MAX_STORAGE_VALUE_SIZE,
) => {
  await storage.deleteAll();

  let serialized;
  if (state.byteLength < chunkSize) {
    serialized = { docstore: state };
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
  }
  serialized.doc = docName;
  if (etag) {
    serialized.etag = etag;
  }

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
  closeConn: closeConn.bind(this),

  /**
   * Get the document from da-admin, with optional conditional GET using ETag.
   * Also extracts authActions from response headers (optimization: replaces HEAD request).
   * @param {string} docName - The document name
   * @param {string} auth - The authorization header
   * @param {object} daadmin - The da-admin worker service binding
   * @param {string} etag - Optional ETag for conditional GET (If-None-Match)
   * @returns {Promise<{
   *   content: string | null, etag: string | null, notModified: boolean, authActions: string }>}
   * @throws {Error} - If the document cannot be retrieved (including 404)
   */
  get: async (docName, auth, daadmin, etag = undefined) => {
    const headers = new Headers();
    if (auth) {
      headers.set('Authorization', auth);
    }
    if (etag) {
      headers.set('If-None-Match', etag);
    }

    const initialReq = await daadmin.fetch(docName, { headers });

    // Extract authActions from response headers (same as HEAD would return)
    const daActions = initialReq.headers.get('X-da-actions') ?? '';
    const [, authActions] = daActions.split('=');

    if (initialReq.status === 304) {
      // Not modified - worker storage is current
      // eslint-disable-next-line no-console
      console.log('[docroom] da-admin returned 304 Not Modified, using worker storage');
      return {
        content: null, etag, notModified: true, authActions: authActions || '',
      };
    }

    if (initialReq.ok) {
      const responseEtag = initialReq.headers.get('ETag');
      const content = await initialReq.text();
      return {
        content, etag: responseEtag, notModified: false, authActions: authActions || '',
      };
    }

    // eslint-disable-next-line no-console
    console.error(`[docroom] Unable to get resource from da-admin: ${initialReq.status} - ${initialReq.statusText}`);
    throw new Error(`unable to get resource - status: ${initialReq.status}`);
  },

  /**
   * Store the content in da-admin.
   * @param {WSSharedDoc} ydoc - The Yjs document, which among other things contains the service
   * binding to da-admin.
   * @param {string} content - The content to store
   * @returns {object} The response from da-admin.
   */
  put: async (ydoc, content) => {
    const blob = new Blob([content], { type: 'text/html' });

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

    if (blob.size < 84) {
      // eslint-disable-next-line no-console
      console.warn('[docroom] Writting back an empty document', ydoc.name, blob.size);
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
   * @returns {string} - the new content of the document in da-admin.
   */
  update: async (ydoc, current) => {
    let closeAll = false;
    try {
      const content = doc2aem(ydoc);
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

        return content;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[docroom] Failed to update document', err);
      showError(ydoc, err);
    }
    if (closeAll) {
      // We had an unauthorized from da-admin - lets reset the connections
      Array.from(ydoc.conns.keys())
        .forEach((con) => persistence.closeConn(ydoc, con));
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
    let timingReadStateDuration;

    // Store storage reference for later use in persistence.update
    // eslint-disable-next-line no-param-reassign
    ydoc.storage = storage;

    let current;
    let currentEtag;
    let restored = false; // True if restored from worker storage

    // Read the stored state from internal worker storage first (errors are non-fatal)
    let storedState;
    let storedEtag;
    try {
      const timingBeforeReadState = Date.now();
      const { state, etag } = await readState(docName, storage);
      storedState = state;
      storedEtag = etag;
      timingReadStateDuration = Date.now() - timingBeforeReadState;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[docroom] Problem reading state from worker storage', error);
    }

    // Get document from da-admin, using conditional GET if we have an ETag
    // This also returns authActions, eliminating the need for a separate HEAD request
    const timingBeforeDaAdminGet = Date.now();
    const daAdminResult = await persistence.get(docName, conn.auth, ydoc.daadmin, storedEtag);
    const timingDaAdminGetDuration = Date.now() - timingBeforeDaAdminGet;

    // Set readOnly based on authActions from the GET response
    const { authActions } = daAdminResult;
    if (!authActions || !authActions.split(',').includes('write')) {
      // eslint-disable-next-line no-param-reassign
      conn.readOnly = true;
    }

    if (daAdminResult.notModified && storedState && storedState.length > 0) {
      // da-admin returned 304 Not Modified - use worker storage directly
      Y.applyUpdate(ydoc, storedState);
      restored = true;
      currentEtag = storedEtag;
      current = doc2aem(ydoc);
      // eslint-disable-next-line no-console
      console.log('[docroom] Restored from worker persistence (304 Not Modified)', docName);
    } else {
      // da-admin returned new content
      current = daAdminResult.content;
      currentEtag = daAdminResult.etag;

      // Try to restore from worker storage if available
      if (storedState && storedState.length > 0) {
        Y.applyUpdate(ydoc, storedState);

        // Check if the state from the worker storage is the same as the current state in da-admin.
        const fromStorage = doc2aem(ydoc);
        if (fromStorage === current) {
          restored = true;
          // eslint-disable-next-line no-console
          console.log('[docroom] Restored from worker persistence (content match)', docName);
        }
      }
    }

    if (!restored && current) {
      // The doc was not restored from worker persistence, so read it from da-admin,
      // but do this async to give the ydoc some time to get synced up first. Without
      // this timeout, the ydoc can get confused which may result in duplicated content.
      // eslint-disable-next-line no-console
      console.log('[docroom] Could not be restored, trying to restore from da-admin', docName);
      setTimeout(async () => {
        if (ydoc === docs.get(docName)) {
          try {
            const rootType = ydoc.getXmlFragment('prosemirror');
            // Clear document and maps in a sync transaction
            ydoc.transact(() => {
              rootType.delete(0, rootType.length);
              ydoc.share.forEach((type) => {
                if (type instanceof Y.Map) {
                  type.clear();
                }
              });
            });

            // Restore from da-admin (async)
            await aem2doc(current, ydoc);

            // eslint-disable-next-line no-console
            console.log('[docroom] Restored from da-admin', docName);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[docroom] Problem restoring state from da-admin', error, current);
            showError(ydoc, error);
          }
        }
      }, 1000);
    }

    ydoc.on('update', async () => {
      // Whenever we receive an update on the document store it in the local storage
      if (ydoc === docs.get(docName)) { // make sure this ydoc is still active
        storeState(docName, Y.encodeStateAsUpdate(ydoc), storage, currentEtag);
      }
    });

    ydoc.on('update', debounce(async () => {
      // If we receive an update on the document, store it in da-admin, but debounce it
      // to avoid excessive da-admin calls.
      if (current && ydoc === docs.get(docName)) {
        current = await persistence.update(ydoc, current);
      }
    }, 2000, { maxWait: 10000 }));

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
      if (!readOnly) syncProtocol.readSyncStep2(decoder, doc, transactionOrigin);
      break;
    case syncProtocol.messageYjsUpdate:
      if (!readOnly) syncProtocol.readUpdate(decoder, doc, transactionOrigin);
      break;
    default:
      throw new Error('Unknown message type');
  }
  return messageType;
};

export const messageListener = (conn, doc, message) => {
  let messageType;
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        readSyncMessage(decoder, encoder, doc, conn.readOnly);

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness: {
        awarenessProtocol
          .applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[docroom] messageListener - Message', err.stack, err);
    showError(doc, err);
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
 * @returns {Promise<void>} - The return value of this
 */
export const setupWSConnection = async (conn, docName, env, storage) => {
  const timingData = new Map();

  // eslint-disable-next-line no-param-reassign
  conn.binaryType = 'arraybuffer';
  // get doc, initialize if it does not exist yet
  const doc = await getYDoc(docName, conn, env, storage, timingData, true);

  // listen and reply to events
  conn.addEventListener('message', (message) => messageListener(conn, doc, new Uint8Array(message.data)));

  // Check if connection is still alive
  conn.addEventListener('close', () => {
    closeConn(doc, conn);
  });
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
    // eslint-disable-next-line no-console
    console.error('[docroom] Error while setting up WSConnection', docName, err);
  }

  return timingData;
};
