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
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';

import * as encoding from 'lib0/encoding.js';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from './config.js';
import { WSSharedDoc } from './wssharedoc.js';
import { closeConn, send, messageListener } from './utils.js';
import { persistence } from './persistence.js';

/**
 *
 * @param {string} docname - The name of the document
 * @param {WebSocket} conn - the WebSocket connection being initiated
 * @param {object} env - the durable object environment object
 * @param {TransactionalStorage} storage - the durable object storage object
 * @param {boolean} gc - whether garbage collection is enabled
 * @returns The Yjs document object, which may be shared across multiple sockets.
 */
export const createYDoc = (docname, conn, env, storage, docsCache, gc = true) => {
  const doc = new WSSharedDoc(docname);
  doc.gc = gc;

  // Store the service binding to da-admin which we receive through the environment in the doc
  doc.daadmin = env.daadmin;
  doc.promise = persistence.bindState(docname, doc, conn, storage, docsCache);

  return doc;
};

export const setupYDoc = async (doc, conn, timingData) => {
  if (!doc.conns.get(conn)) {
    doc.conns.set(conn, new Set());
  }

  // We wait for the promise, for second and subsequent connections to the same doc, this will
  // already be resolved.
  const timings = await doc.promise;
  if (timingData) {
    timings.forEach((v, k) => timingData.set(k, v));
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
export const invalidateFromAdmin = async (ydoc) => {
  if (ydoc) {
    // eslint-disable-next-line no-console
    console.log('Invalidating document', ydoc.name);

    // As we are closing all connections, the ydoc will be removed from the docs map
    ydoc.conns.forEach((_, c) => closeConn(ydoc, c));

    return true;
  } else {
    // eslint-disable-next-line no-console
    console.log('No document to invalidate');
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
export const setupWSConnection = async (conn, ydoc) => {
  // eslint-disable-next-line no-param-reassign
  conn.binaryType = 'arraybuffer';

  // listen and reply to events
  conn.addEventListener('message', (message) => messageListener(conn, ydoc, new Uint8Array(message.data)));

  // Check if connection is still alive
  conn.addEventListener('close', () => {
    closeConn(ydoc, conn);
  });
  // put the following in a variables in a block so the interval handlers don't keep in in
  // scope
  {
    // send sync step 1
    let encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, ydoc);
    send(ydoc, conn, encoding.toUint8Array(encoder));
    const awarenessStates = ydoc.awareness.getStates();
    if (awarenessStates.size > 0) {
      encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol
        .encodeAwarenessUpdate(ydoc.awareness, Array.from(awarenessStates.keys())));
      send(ydoc, conn, encoding.toUint8Array(encoder));
    }
  }
};
