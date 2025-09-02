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
import {
  invalidateFromAdmin,
  setupWSConnection,
  createYDoc,
  setupYDoc,
} from './shareddoc.js';

// =======================================================================================
// The Durable Object Class

// Implements a Durable Object that coordinates an individual doc room. Participants
// connect to the room using WebSockets, and the room broadcasts messages from each participant
// to all others.
export default class DocRoom {
  constructor(controller, env, docs = new Map()) {
    // `controller.storage` provides access to our durable storage. It provides a simple KV
    // get()/put() interface.
    this.storage = controller.storage;

    this.docs = docs;

    // `env` is our environment bindings (discussed earlier).
    this.env = env;
  }

  // Handle the API calls. Supported API calls right now are to sync the doc with the da-admin
  // state or to indicate that the document has been deleted from da-admin.
  // The implementation of these two is currently identical.
  // eslint-disable-next-line class-methods-use-this
  async handleApiCall(url, request) {
    const qidx = request.url.indexOf('?');
    const baseURL = request.url.substring(0, qidx);

    const api = url.searchParams.get('api');
    // eslint-disable-next-line no-console
    console.log('API Call received', api, baseURL);
    switch (api) {
      case 'deleteAdmin':
        if (await invalidateFromAdmin(this.docs.get(baseURL))) {
          return new Response(null, { status: 204 });
        } else {
          return new Response('Not Found', { status: 404 });
        }
      case 'syncAdmin':
        if (await invalidateFromAdmin(this.docs.get(baseURL))) {
          return new Response('OK', { status: 200 });
        } else {
          return new Response('Not Found', { status: 404 });
        }
      default:
        return new Response('Invalid API', { status: 400 });
    }
  }

  // Isolated for testing
  static newWebSocketPair() {
    // eslint-disable-next-line no-undef
    return new WebSocketPair();
  }

  // The system will call fetch() whenever an HTTP request is sent to this Object. Such requests
  // can only be sent from other Worker code, such as the code above; these requests don't come
  // directly from the internet. In the future, we will support other formats than HTTP for these
  // communications, but we started with HTTP for its familiarity.
  //
  // Note that strangely enough in a unit testing env returning a Response with status 101 isn't
  // allowed by the runtime, so we can set an alternative 'success' code here for testing.
  async fetch(request, _opts, successCode = 101) {
    const url = new URL(request.url);

    // If it's a pure API call then handle it and return.
    if (url.search.startsWith('?api=')) {
      return this.handleApiCall(url, request);
    }

    // If we get here, we're expecting this to be a WebSocket request.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 });
    }
    const auth = request.headers.get('Authorization');
    const authActions = request.headers.get('X-auth-actions') ?? '';
    const docName = request.headers.get('X-collab-room');

    if (!docName) {
      return new Response('expected docName', { status: 400 });
    }

    const timingBeforeSetupWebsocket = Date.now();
    // To accept the WebSocket request, we create a WebSocketPair (which is like a socketpair,
    // i.e. two WebSockets that talk to each other), we return one end of the pair in the
    // response, and we operate on the other end. Note that this API is not part of the
    // Fetch API standard; unfortunately, the Fetch API / Service Workers specs do not define
    // any way to act as a WebSocket server today.
    const pair = DocRoom.newWebSocketPair();

    // We're going to take pair[1] as our end, and return pair[0] to the client.
    const timingData = await this.handleSession(pair[1], docName, auth, authActions);
    const timingSetupWebSocketDuration = Date.now() - timingBeforeSetupWebsocket;

    const reqHeaders = request.headers;
    const respheaders = new Headers();
    respheaders.set('X-1-timing-da-admin-head-duration', reqHeaders.get('X-timing-da-admin-head-duration'));
    respheaders.set('X-2-timing-docroom-get-duration', reqHeaders.get('X-timing-docroom-get-duration'));
    respheaders.set('X-4-timing-da-admin-get-duration', timingData.get('timingDaAdminGetDuration'));
    respheaders.set('X-5-timing-read-state-duration', timingData.get('timingReadStateDuration'));
    respheaders.set('X-7-timing-setup-websocket-duration', timingSetupWebSocketDuration);
    respheaders.set('X-9-timing-full-duration', Date.now() - reqHeaders.get('X-timing-start'));

    // Now we return the other end of the pair to the client.
    return new Response(null, { status: successCode, headers: respheaders, webSocket: pair[0] });
  }

  /**
   * Implements our WebSocket-based protocol.
   * @param {WebSocket} webSocket - The WebSocket connection to the client
   * @param {string} docName - The document name
   * @param {string} auth - The authorization header
   */
  async handleSession(webSocket, docName, auth, authActions) {
    // Accept our end of the WebSocket. This tells the runtime that we'll be terminating the
    // WebSocket in JavaScript, not sending it elsewhere.
    webSocket.accept();
    // eslint-disable-next-line no-param-reassign
    webSocket.auth = auth;

    if (!authActions.split(',').includes('write')) {
      // eslint-disable-next-line no-param-reassign
      webSocket.readOnly = true;
    }
    // eslint-disable-next-line no-console
    console.log(`Setting up WSConnection for ${docName} with auth(${webSocket.auth
      ? webSocket.auth.substring(0, webSocket.auth.indexOf(' ')) : 'none'})`);

    const timingData = new Map();

    let ydoc = this.docs.get(docName);
    if (!ydoc) {
      ydoc = createYDoc(
        docName,
        webSocket,
        this.env,
        this.storage,
        this.docs,
        true,
      );
      this.docs.set(docName, ydoc);
    }

    await setupYDoc(ydoc, webSocket, timingData);

    webSocket.addEventListener('close', () => {
      const doc = this.docs.get(docName);
      if (doc && doc.conns.size === 0) {
        // eslint-disable-next-line no-console
        console.log(`All connections closed for ${docName} - removing from docs cache`);
        this.docs.delete(docName);
      }
    });

    await setupWSConnection(webSocket, ydoc);

    return timingData;
  }
}
