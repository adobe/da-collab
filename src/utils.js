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
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import * as syncProtocol from 'y-protocols/sync.js';
import {
  WS_READY_STATE_CONNECTING,
  WS_READY_STATE_OPEN,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from './config.js';

/**
 * Close the WebSocket connection for a document. If there are no connections left, remove
 * the ydoc from the local cache map.
 * @param {ydoc} doc - the ydoc to close the connection for.
 * @param {WebSocket} conn - the websocket connection to close.
 */
export const closeConn = (doc, conn) => {
  // eslint-disable-next-line no-console
  console.log('Closing connection for - removing awareness states', doc.name);
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
  }
  conn.close();
};

export const send = (doc, conn, m) => {
  if (conn.readyState !== WS_READY_STATE_CONNECTING && conn.readyState !== WS_READY_STATE_OPEN) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(m, (err) => err != null && closeConn(doc, conn));
  } catch (e) {
    closeConn(doc, conn);
  }
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
      case MESSAGE_SYNC:
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        readSyncMessage(decoder, encoder, doc, conn.readOnly);

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case MESSAGE_AWARENESS: {
        awarenessProtocol
          .applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Error in messageListener ${doc?.name} - messageType: ${messageType}`, err);
    showError(doc, err);
  }
};
