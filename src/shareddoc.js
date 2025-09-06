/*
 * Copyright 2024 Adobe. All rights reserved.
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
import { aem2doc, doc2aem, EMPTY_DOC } from './collab.js';

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
  // eslint-disable-next-line no-console
  console.log('Closing connection', doc.name, doc.conns.size);
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    try {
      awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error removing awareness states', err);
    }

    if (doc.conns.size === 0) {
      // eslint-disable-next-line no-console
      console.log('No connections left, removing document from local map', doc.name);
      docs.delete(doc.name);
    }
  }
  conn.close();
};

const send = (doc, conn, m) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(m, (err) => err != null && closeConn(doc, conn));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Error sending message', e);
    closeConn(doc, conn);
  }
};

/**
 * Read the ydoc document state from durable object persistent storage. The format is as
 * in storeState function.
 * @param {string} docName - The document name
 * @param {TransactionalStorage} storage - The worker transactional storage
 * @returns {Uint8Array | undefined} - The stored state or undefined if not found
 */
export const readState = async (docName, storage) => {
  const stored = await storage.list();
  if (stored.size === 0) {
    // eslint-disable-next-line no-console
    console.log('No stored doc in persistence');
    return undefined;
  }

  if (stored.get('doc') !== docName) {
    // eslint-disable-next-line no-console
    console.log('Docname mismatch in persistence. Expected:', docName, 'found:', stored.get('doc'), 'Deleting storage');
    await storage.deleteAll();
    return undefined;
  }

  if (stored.has('docstore')) {
    // eslint-disable-next-line no-console
    console.log('Document found in persistence');
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
  console.log('Document data read');
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
      console.error('Object too big for worker storage', docName, j, MAX_STORAGE_KEYS);
      throw new Error('Object too big for worker storage');
    }

    serialized.chunks = j;
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
      em.set('stack', err.stack);
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Error showing error', e, err);
  }
};

const resetGuidArray = (ydoc, guidArray, guid, ts) => {
  ydoc.transact(() => {
    guidArray.delete(0, guidArray.length); // Delete the entire array
    guidArray.push([{ guid, ts }]);
  });
};

export const persistence = {
  closeConn: closeConn.bind(this),

  /**
   * Get the document from da-admin. If da-admin doesn't have the doc, a new empty doc is
   * returned.
   * @param {string} docName - The document name
   * @param {string} auth - The authorization header
   * @param {object} daadmin - The da-admin worker service binding
   * @returns {object} - text: The content of the document and guid: the guid of the document.
   */
  get: async (docName, auth, daadmin) => {
    const initalOpts = {};
    if (auth) {
      initalOpts.headers = new Headers({ Authorization: auth });
    }
    const initialReq = await daadmin.fetch(docName, initalOpts);
    if (initialReq.ok) {
      return { text: await initialReq.text(), guid: initialReq.headers.get('X-da-id') };
    } else if (initialReq.status === 404) {
      return null;
    } else {
      // eslint-disable-next-line no-console
      console.error(`Unable to get resource from da-admin: ${initialReq.status} - ${initialReq.statusText}`);
      throw new Error(`unable to get resource - status: ${initialReq.status}`);
    }
  },

  /**
   * Store the content in da-admin.
   * @param {WSSharedDoc} ydoc - The Yjs document, which among other things contains the service
   * binding to da-admin.
   * @param {string} content - The content to store
   * @returns {object} The response from da-admin.
   */
  put: async (ydoc, content, guid) => {
    const blob = new Blob([content], { type: 'text/html' });

    const formData = new FormData();
    formData.append('data', blob);
    formData.append('guid', guid);

    const opts = { method: 'PUT', body: formData };
    const keys = Array.from(ydoc.conns.keys());
    const allReadOnly = keys.length > 0 && keys.every((con) => con.readOnly === true);
    if (allReadOnly) {
      // eslint-disable-next-line no-console
      console.log('All connections are read only, not storing');
      return { ok: true };
    }
    const auth = keys
      .filter((con) => con.readOnly !== true)
      .map((con) => con.auth);

    if (auth.length > 0) {
      opts.headers = new Headers({
        Authorization: [...new Set(auth)].join(','),
        'X-DA-Initiator': 'collab',
      });
    }

    if (blob.size < 84) {
      // eslint-disable-next-line no-console
      console.warn('Writting back an empty document', ydoc.name, blob.size);
    }
    const { ok, status, statusText } = await ydoc.daadmin.fetch(ydoc.name, opts);

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
   * @param {object} guidHolder - an object containing the guid of the document.
   * If the document exists, it will hold its guid. If the document does not yet
   * exists, it will be modified to set its guid in this method so that its known
   * for subsequent calls.
   * @returns {string} - the new content of the document in da-admin.
   */
  update: async (ydoc, current, guidHolder) => {
    let closeAll = false;
    try {
      const { guid } = guidHolder;

      // The guid array contains the known guids. We sort it by timestamp so that we
      // know to find the latest. Any other guids are considered stale.
      // Objects on the guid array may also contain a newDoc flag, which is set to true
      // when the document is just opened in the browser.
      const guidArray = ydoc.getArray('prosemirror-guids');
      const copy = [...guidArray];
      if (copy.length === 0) {
        // eslint-disable-next-line no-console
        console.log('No guid array found in update. Ignoring.');
        return current;
      }
      copy.sort((a, b) => a.ts - b.ts);
      const { newDoc, guid: curGuid, ts: createdTS } = copy.pop();

      if (guid && curGuid !== guid) {
        // Guid mismatch, need to update the editor to the guid from da-admin
        resetGuidArray(ydoc, guidArray, guid, createdTS + 1);
        return current;
      }

      if (!newDoc && !guid) {
        // Someone is still editing a document in the browser that has since been deleted
        // we know it's deleted because guid from da-admin is not set.
        // eslint-disable-next-line no-console
        console.log('Document GUID mismatch, da-admin guid:', guid, 'edited guid:', curGuid);
        showError(ydoc, { message: 'This document has since been deleted, your edits are not persisted' });
        return current;
      }

      const content = doc2aem(ydoc, curGuid);
      if (current !== content) {
        // Only store the document if it was actually changed.
        const { ok, status, statusText } = await persistence.put(ydoc, content, curGuid);
        if (newDoc) {
          // Update the guid in the guidHolder so that in subsequent calls we know what it is
          // eslint-disable-next-line no-param-reassign
          guidHolder.guid = curGuid;

          // Remove the stale guids, and set the array to the current
          resetGuidArray(ydoc, guidArray, curGuid, createdTS);
        }
        if (!ok) {
          closeAll = (status === 401 || status === 403);
          throw new Error(`${status} - ${statusText}`);
        }

        return content;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to update document', err);
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
    let timingDaAdminGetDuration;

    let current;
    let guid;
    let restored = false; // True if restored from worker storage
    try {
      let newDoc = false;
      const timingBeforeDaAdminGet = Date.now();
      const cur = await persistence.get(docName, conn.auth, ydoc.daadmin);
      if (cur === null) {
        current = null;
      } else {
        current = cur?.text;
        guid = cur?.guid;
      }
      timingDaAdminGetDuration = Date.now() - timingBeforeDaAdminGet;

      const timingBeforeReadState = Date.now();
      // Read the stored state from internal worker storage
      const stored = await readState(docName, storage);
      timingReadStateDuration = Date.now() - timingBeforeReadState;

      if (current === null) {
        if (!stored) {
          // This is a new document, it wasn't present in local storage
          newDoc = true;
        }
        // if stored has a value, the document previously existed but was deleted

        current = EMPTY_DOC;
        await storage.deleteAll();
      } else if (stored && stored.length > 0) {
        Y.applyUpdate(ydoc, stored);

        // Check if the state from the worker storage is the same as the current state in da-admin.
        // So for example if da-admin doesn't have the doc any more, or if it has been altered in
        // another way, we don't use the state of the worker storage.
        const fromStorage = doc2aem(ydoc, guid);
        if (fromStorage === current) {
          restored = true;

          // eslint-disable-next-line no-console
          console.log('Restored from worker persistence', docName);
        }
      }

      if (newDoc === true) {
        // There is no stored state and the document is empty, which means
        // we have a new doc here, which doesn't need to be restored from da-admin
        restored = true;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Problem restoring state from worker storage', error);
      showError(ydoc, error);
    }

    if (!restored && guid) {
      // The doc was not restored from worker persistence, so read it from da-admin,
      // but only if the doc actually exists in da-admin (guid has a value).
      // If it's a brand new document, subsequent update() calls will set it in
      // da-admin and provide the guid to use.

      // Do this async to give the ydoc some time to get synced up first. Without this
      // timeout, the ydoc can get confused which may result in duplicated content.
      // eslint-disable-next-line no-console
      console.log('Could not be restored, trying to restore from da-admin', docName);
      setTimeout(() => {
        if (ydoc === docs.get(docName)) {
          const rootType = ydoc.getXmlFragment(`prosemirror-${guid}`);
          ydoc.transact(() => {
            try {
              // clear document
              rootType.delete(0, rootType.length);
              // restore from da-admin
              aem2doc(current, ydoc, guid);

              // eslint-disable-next-line no-console
              console.log('Restored from da-admin', docName);
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error('Problem restoring state from da-admin', error, current);
              showError(ydoc, error);
            }
          });
        }
      }, 1000);
    }

    ydoc.on('update', async () => {
      // Whenever we receive an update on the document store it in the local storage
      if (ydoc === docs.get(docName)) { // make sure this ydoc is still active
        storeState(docName, Y.encodeStateAsUpdate(ydoc), storage);
      }
    });

    // Use a holder for the guid. This is needed in case the guid is not known yet
    // for a new document so that it can be updated later once its known.
    const guidHolder = { guid };

    ydoc.on('update', debounce(async () => {
      // If we receive an update on the document, store it in da-admin, but debounce it
      // to avoid excessive da-admin calls.
      if (ydoc === docs.get(docName)) {
        current = await persistence.update(ydoc, current, guidHolder);
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
    docs.set(docname, doc);
  }

  if (!doc.conns.get(conn)) {
    doc.conns.set(conn, new Set());
  }

  // Store the service binding to da-admin which we receive through the environment in the doc
  doc.daadmin = env.daadmin;
  if (!doc.promise) {
    // The doc is not yet bound to the persistence layer, do so now. The promise will be resolved
    // when bound.
    doc.promise = persistence.bindState(docname, doc, conn, storage);
  }

  // We wait for the promise, for second and subsequent connections to the same doc, this will
  // already be resolved.
  const timings = await doc.promise;
  if (timingData) {
    timings.forEach((v, k) => timingData.set(k, v));
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
    // eslint-disable-next-line no-console, no-nested-ternary
    console.error('messageListener - Received message', doc.name, messageType === messageSync ? 'sync' : (messageType === messageAwareness ? 'awareness' : 'unknown'));
    // eslint-disable-next-line no-console, no-nested-ternary
    console.error('messageListener - Stack', err.stack);
    // eslint-disable-next-line no-console, no-nested-ternary
    console.error('messageListener - Message', err.message);
    // eslint-disable-next-line no-console
    console.error('Error in messageListener', err);
    showError(doc, err);
  }
};

export const deleteFromAdmin = async (docName) => {
  // eslint-disable-next-line no-console
  console.log('Delete from Admin received', docName);
  const ydoc = docs.get(docName);
  if (ydoc) {
    // empty out all known docs, should normally just be one
    for (const { guid } of ydoc.getArray('prosemirror-guids')) {
      ydoc.transact(() => {
        const rootType = ydoc.getXmlFragment(`prosemirror-${guid}`);
        rootType.delete(0, rootType.length);
      });
    }

    // Reset the connections to flush the guids
    ydoc.conns.forEach((_, c) => closeConn(ydoc, c));
    return true;
  } else {
    // eslint-disable-next-line no-console
    console.log('Document not found', docName);
  }
  return false;
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
  console.log('Invalidate from Admin received', docName);
  const ydoc = docs.get(docName);
  if (ydoc) {
    // As we are closing all connections, the ydoc will be removed from the docs map
    ydoc.conns.forEach((_, c) => closeConn(ydoc, c));

    return true;
  } else {
    // eslint-disable-next-line no-console
    console.log('Document not found', docName);
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
    console.error('Error in setupWSConnection', err);
  }

  return timingData;
};
