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
/* eslint-disable no-unused-vars */
/* eslint-disable object-curly-newline */

import assert from 'node:assert';

import defaultEdge, { DocRoom, handleApiRequest, handleErrors, handleConvert } from '../src/edge.js';
import { WSSharedDoc, persistence, setYDoc } from '../src/shareddoc.js';

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hash(str) {
  let h = 0;
  for (let i = 0, len = str.length; i < len; i += 1) {
    const chr = str.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    h = (h << 5) - h + chr;
    // eslint-disable-next-line no-bitwise
    h |= 0; // Convert to 32bit integer
  }
  return h;
}

class MockRoom extends DocRoom {
  calls = [];

  handleApiCall(api, docName) {
    this.calls.push({ api, docName });
    return new Response(null, { status: 200 });
  }
}

describe('Worker test suite', () => {
  it('Test deleteAdmin', async () => {
    const expectedHash = hash('https://some.where/some/doc.html');
    const req = {
      url: 'http://localhost:9999/api/v1/deleteadmin?doc=https://some.where/some/doc.html',
    };

    const room = new MockRoom();
    const rooms = {
      idFromName(nm) { return hash(nm); },
      // eslint-disable-next-line consistent-return
      get(id) {
        if (id === expectedHash) {
          return room;
        }
      },
    };
    const env = { rooms };

    const resp = await handleApiRequest(req, env);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(room.calls, [{
      api: 'deleteAdmin',
      docName: 'https://some.where/some/doc.html',
    },
    ]);
  });

  it('Test syncAdmin request without doc', async () => {
    const req = {
      url: 'http://localhost:12345/api/v1/syncadmin',
    };
    const rooms = {};
    const env = { rooms };

    const resp = await handleApiRequest(req, env);
    assert.equal(400, resp.status, 'Doc wasnt set so should return a 400 for invalid');
    assert.equal('Bad', await resp.text());
  });

  it('Test handle syncAdmin request', async () => {
    const expectedHash = hash('http://foobar.com/a/b/c.html');
    const req = {
      url: 'http://localhost:12345/api/v1/syncadmin?doc=http://foobar.com/a/b/c.html',
    };

    const room = new MockRoom();
    const rooms = {
      idFromName(nm) { return hash(nm); },
      // eslint-disable-next-line consistent-return
      get(id) {
        if (id === expectedHash) {
          return room;
        }
      },
    };
    const env = { rooms };

    const resp = await handleApiRequest(req, env);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(room.calls, [
      {
        api: 'syncAdmin',
        docName: 'http://foobar.com/a/b/c.html',
      },
    ]);
  });

  it('Test handle syncAdmin request (enforced shared secret)', async () => {
    const expectedHash = hash('http://foobar.com/a/b/c.html');
    const req = {
      url: 'http://localhost:12345/api/v1/syncadmin?doc=http://foobar.com/a/b/c.html',
      headers: new Headers({
        authorization: 'token test-secret',
      }),
    };

    const room = new MockRoom();
    const rooms = {
      idFromName(nm) { return hash(nm); },
      get(id) {
        if (id === expectedHash) {
          return room;
        }
        return null;
      },
    };
    const env = {
      rooms,
      COLLAB_SHARED_SECRET: 'test-secret',
    };

    const resp = await handleApiRequest(req, env);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(room.calls, [
      {
        api: 'syncAdmin',
        docName: 'http://foobar.com/a/b/c.html',
      },
    ]);
  });

  it('Test handle syncAdmin request (enforced shared secret, unauthorized)', async () => {
    const expectedHash = hash('http://foobar.com/a/b/c.html');
    const req = {
      url: 'http://localhost:12345/api/v1/syncadmin?doc=http://foobar.com/a/b/c.html',
      headers: new Headers(),
    };

    const room = new MockRoom();
    const rooms = {
      idFromName(nm) { return hash(nm); },
      get(id) {
        if (id === expectedHash) {
          return room;
        }
        return null;
      },
    };
    const env = {
      rooms,
      COLLAB_SHARED_SECRET: 'test-secret',
    };

    const resp = await handleApiRequest(req, env);
    assert.equal(401, resp.status);
    assert.deepStrictEqual(room.calls, []);
  });

  it('Test handle syncAdmin request via default export', async () => {
    const expectedHash = hash('http://foobar.com/a/b/c.html');
    const req = {
      url: 'http://localhost:12345/api/v1/syncadmin?doc=http://foobar.com/a/b/c.html',
    };

    const room = new MockRoom();
    const rooms = {
      idFromName(nm) { return hash(nm); },
      // eslint-disable-next-line consistent-return
      get(id) {
        if (id === expectedHash) {
          return room;
        }
      },
    };
    const env = { rooms };

    const resp = await defaultEdge.fetch(req, env);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(room.calls, [
      {
        api: 'syncAdmin',
        docName: 'http://foobar.com/a/b/c.html',
      },
    ]);
  });

  it('Test unknown API', async () => {
    const req = {
      url: 'http://localhost:12345/api/v1/foobar',
    };

    const resp = await handleApiRequest(req, null);
    assert.equal(400, resp.status, 'Doc wasnt set so should return a 400 for invalid');
    assert.equal('Bad Request', await resp.text());
  });

  it('Docroom deleteFromAdmin', async () => {
    const ydocName = 'http://foobar.com/q.html';
    const testYdoc = new WSSharedDoc(ydocName);
    const m = setYDoc(ydocName, testYdoc);

    const connCalled = [];
    const mockConn = {
      close() { connCalled.push('close'); },
    };
    testYdoc.conns.set(mockConn, 1234);

    const req = {
      url: `${ydocName}?api=deleteAdmin`,
    };

    const dr = new DocRoom({});

    assert(m.has(ydocName), 'Precondition');
    const resp = await dr.fetch(req);
    assert.equal(204, resp.status);
    assert(!m.has(ydocName), 'Doc should have been removed');
    assert.deepStrictEqual(['close'], connCalled);
    testYdoc.destroy();
  });

  it('Docroom deleteFromAdmin not found', async () => {
    const req = {
      url: 'https://blah.blah/blah.html?api=deleteAdmin',
    };

    const dr = new DocRoom({});
    const resp = await dr.fetch(req);
    assert.equal(404, resp.status);
  });

  it('Docroom syncFromAdmin', async () => {
    const ydocName = 'http://foobar.com/a/b/c.html';
    const testYdoc = new WSSharedDoc(ydocName);
    const m = setYDoc(ydocName, testYdoc);

    const connCalled = [];
    const mockConn = {
      close() { connCalled.push('close'); },
    };
    testYdoc.conns.set(mockConn, 1234);

    const req = {
      url: `${ydocName}?api=syncAdmin`,
    };

    const dr = new DocRoom({});

    assert(m.has(ydocName), 'Precondition');
    const resp = await dr.fetch(req);
    assert.equal(200, resp.status);
    assert(!m.has(ydocName), 'Doc should have been removed');
    assert.deepStrictEqual(['close'], connCalled);
    testYdoc.destroy();
  });

  it('Unknown doc update request gives 404', async () => {
    const dr = new DocRoom({});

    const req = {
      url: 'http://foobar.com/a/b/d/e/f.html?api=syncAdmin',
    };
    const resp = await dr.fetch(req);

    assert.equal(404, resp.status);
  });

  it('Unknown DocRoom API call gives 400', async () => {
    const dr = new DocRoom({ storage: null }, null);
    const req = {
      url: 'http://foobar.com/a.html?api=blahblahblah',
    };
    const resp = await dr.fetch(req);

    assert.equal(400, resp.status);
  });

  it('Test DocRoom fetch', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      const bindCalled = [];
      persistence.bindState = async (nm, d, c) => {
        bindCalled.push({ nm, d, c });
        return new Map();
      };

      const wspCalled = [];
      const wsp0 = {};
      const wsp1 = {
        accept() { wspCalled.push('accept'); },
        addEventListener(type) { wspCalled.push(`addEventListener ${type}`); },
        close() { wspCalled.push('close'); },
      };
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { blah: 1234 };
      const dr = new DocRoom({ storage: null }, { daadmin });
      const headers = new Headers({
        Upgrade: 'websocket',
        Authorization: 'au123',
        'X-collab-room': 'http://foo.bar/1/2/3.html',
      });

      const req = {
        headers,
        url: 'http://localhost:4711/',
      };
      const resp = await dr.fetch(req, {}, 306);
      assert.equal(resp.headers.get('sec-websocket-protocol'), undefined);
      assert.equal(306 /* fabricated websocket response code */, resp.status);

      assert.equal(1, bindCalled.length);
      assert.equal('http://foo.bar/1/2/3.html', bindCalled[0].nm);
      assert.equal('1234', bindCalled[0].d.daadmin.blah);

      assert.equal('au123', wsp1.auth);

      const acceptIdx = wspCalled.indexOf('accept');
      const alMessIdx = wspCalled.indexOf('addEventListener message');
      const alClsIdx = wspCalled.indexOf('addEventListener close');
      const clsIdx = wspCalled.indexOf('close');

      assert(acceptIdx >= 0);
      assert(alMessIdx > acceptIdx);
      assert(alClsIdx > alMessIdx);
      assert(clsIdx > alClsIdx);
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom fetch (with protocols)', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      persistence.bindState = async (nm, d, c) => new Map();

      const wsp0 = {};
      const wsp1 = {
        accept() { },
        addEventListener(type) { },
        close() { },
      };
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { blah: 1234 };
      const dr = new DocRoom({ storage: null }, { daadmin });
      const headers = new Headers({
        Upgrade: 'websocket',
        Authorization: 'au123',
        'X-collab-room': 'http://foo.bar/1/2/3.html',
        'sec-websocket-protocol': 'yjs,foobar',
      });

      const req = {
        headers,
        url: 'http://localhost:4711/',
      };
      const resp = await dr.fetch(req, {}, 306);
      assert.equal(resp.headers.get('sec-websocket-protocol'), 'yjs');
      assert.equal(306 /* fabricated websocket response code */, resp.status);
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom fetch expects websocket', async () => {
    const dr = new DocRoom({ storage: null }, null);

    const req = {
      headers: new Headers(),
      url: 'http://localhost:4711/',
    };
    const resp = await dr.fetch(req);
    assert.equal(400, resp.status, 'Expected a Websocket');
  });

  it('Test DocRoom fetch expects document name', async () => {
    const dr = new DocRoom({ storage: null }, null);
    const headers = new Headers({
      upgrade: 'websocket',
      authorization: 'au123',
    });

    const req = {
      headers,
      url: 'http://localhost:4711/',
    };
    const resp = await dr.fetch(req);
    assert.equal(400, resp.status, 'Expected a document name');
  });

  it('Test DocRoom fetch fails when document deleted after auth', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      // Mock bindState to throw 404 error (simulating document deleted between auth and bindState)
      persistence.bindState = async () => {
        // eslint-disable-next-line max-len
        await sleep(1); // the real bindState is async and we only reset the failed doc in the promise
        throw new Error('unable to get resource - status: 404');
      };

      const wsp0 = {};
      const wsp1 = {
        accept() {},
        addEventListener() {},
        close() {},
      };
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { fetch: async () => ({ ok: true }) };
      const dr = new DocRoom({ storage: null }, { daadmin });
      const headers = new Map();
      headers.set('Upgrade', 'websocket');
      headers.set('X-collab-room', 'http://foo.bar/test.html');
      headers.set('X-auth-actions', 'read=allow,write=allow');

      const req = {
        headers,
        url: 'http://localhost:4711/',
      };

      const resp = await dr.fetch(req, {}, 306);

      // Should return 500 error when bindState fails
      assert.equal(500, resp.status);
      assert.equal('Internal Server Error', await resp.text());
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom fetch WebSocket setup exception', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      // Mock bindState to throw an exception
      persistence.bindState = async (nm, d, c) => {
        // eslint-disable-next-line max-len
        await sleep(1); // the real bindState is async and we only reset the failed doc in the promise
        throw new Error('WebSocket setup error');
      };

      // Mock WebSocketPair to return valid objects
      const wsp0 = {};
      const wsp1 = {
        accept() {},
        addEventListener() {},
        close() {},
      };
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { test: 'value' };
      const dr = new DocRoom({ storage: null }, { daadmin });
      const headers = new Map();
      headers.set('Upgrade', 'websocket');
      headers.set('Authorization', 'au123');
      headers.set('X-collab-room', 'http://foo.bar/test.html');

      const req = {
        headers,
        url: 'http://localhost:4711/',
      };
      const resp = await dr.fetch(req);

      // Should return 500 error due to exception in WebSocket setup
      assert.equal(500, resp.status);
      assert.equal('Internal Server Error', await resp.text());
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test handleErrors success', async () => {
    const f = () => 42;
    const res = await handleErrors({}, {}, f);
    assert.equal(res, 42);
  });

  it('Test HandleError error (disable stack trace)', async () => {
    const f = async () => {
      throw new Error('testing');
    };

    const req = {
      url: 'http://localhost:4711/',
      headers: new Headers(),
    };
    const env = {
      RETURN_STACK_TRACES: false,
    };
    const res = await handleErrors(req, env, f);
    assert.strictEqual(res.status, 500);
    assert.strictEqual(await res.text(), 'Internal Server Error');
  });

  it('Test HandleError error (enable stack trace)', async () => {
    const f = async () => {
      throw new Error('testing');
    };

    const req = {
      url: 'http://localhost:4711/',
      headers: new Headers(),
    };
    const env = {
      RETURN_STACK_TRACES: true,
    };
    const res = await handleErrors(req, env, f);
    assert.strictEqual(res.status, 500);
    assert.match(await res.text(), /at handleErrors/m);
  });

  it('Test handleErrors WebSocket error (disable stack trace)', async () => {
    const f = () => {
      throw new Error('WebSocket error test');
    };

    const req = {
      url: 'wss://localhost:4711/',
      headers: new Headers({
        upgrade: 'websocket',
      }),
    };
    const env = {
      RETURN_STACK_TRACES: false,
    };

    // Mock WebSocketPair since it's not available in Node.js test environment
    const messages = [];
    const mockWebSocketPair = function () {
      const pair = [null, null];
      pair[0] = { // client side
        readyState: 1,
        close: () => {},
        send: () => {},
      };
      pair[1] = { // server side
        accept: () => {},
        send(msg) {
          messages.push(msg);
        },
        close: () => {},
      };
      return pair;
    };

    // Mock WebSocketPair globally
    globalThis.WebSocketPair = mockWebSocketPair;

    try {
      // In Node.js, status 101 is not valid, so we expect an error
      // But the important thing is that the WebSocket error path is covered
      try {
        const res = await handleErrors(req, env, f);
        // If we get here, the test environment supports status 101
        assert.equal(101, res.status);
        assert(res.webSocket !== undefined);
      } catch (error) {
        // Expected in Node.js - status 101 is not valid
        assert(error.message.includes('must be in the range of 200 to 599'));
      }
      assert.deepEqual(messages, ['Internal Server Error']);
    } finally {
      // Clean up the mock
      delete globalThis.WebSocketPair;
    }
  });

  it('Test handleErrors WebSocket error (enable stack trace)', async () => {
    const f = () => {
      throw new Error('WebSocket error test');
    };

    const req = {
      url: 'wss://localhost:4711/',
      headers: new Headers({
        upgrade: 'websocket',
      }),
    };
    const env = {
      RETURN_STACK_TRACES: true,
    };

    // Mock WebSocketPair since it's not available in Node.js test environment
    const messages = [];
    const mockWebSocketPair = function () {
      const pair = [null, null];
      pair[0] = { // client side
        readyState: 1,
        close: () => {},
        send: () => {},
      };
      pair[1] = { // server side
        accept: () => {},
        send(msg) {
          messages.push(msg);
        },
        close: () => {},
      };
      return pair;
    };

    // Mock WebSocketPair globally
    globalThis.WebSocketPair = mockWebSocketPair;

    try {
      // In Node.js, status 101 is not valid, so we expect an error
      // But the important thing is that the WebSocket error path is covered
      try {
        const res = await handleErrors(req, env, f);
        // If we get here, the test environment supports status 101
        assert.equal(101, res.status);
        assert(res.webSocket !== undefined);
      } catch (error) {
        // Expected in Node.js - status 101 is not valid
        assert(error.message.includes('must be in the range of 200 to 599'));
      }
      assert.match(messages[0], /at handleErrors/m);
    } finally {
      // Clean up the mock
      delete globalThis.WebSocketPair;
    }
  });

  it('Test handleApiRequest', async () => {
    const headers = new Map();
    headers.set('myheader', 'myval');
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/laaa.html?Authorization=qrtoefi',
      headers,
    };

    const roomFetchCalled = [];
    const myRoom = {
      // eslint-disable-next-line no-shadow
      fetch(req) {
        roomFetchCalled.push(req);
        return new Response(null, { status: 306 });
      },
    };

    const mockFetchCalled = [];
    const mockFetch = async (url, opts) => {
      mockFetchCalled.push({ url, opts });
      return new Response(null, { status: 200 });
    };
    const serviceBinding = {
      fetch: mockFetch,
    };

    const rooms = {
      idFromName(nm) { return `id${hash(nm)}`; },
      get(id) { return id === 'id1255893316' ? myRoom : null; },
    };
    const env = { rooms, daadmin: serviceBinding };

    const res = await handleApiRequest(req, env);
    assert.equal(306, res.status);

    assert.equal(1, mockFetchCalled.length);
    const mfreq = mockFetchCalled[0];
    assert.equal('https://admin.da.live/laaa.html', mfreq.url);
    assert.equal('HEAD', mfreq.opts.method);

    assert.equal(1, roomFetchCalled.length);

    const rfreq = roomFetchCalled[0];
    assert.equal('https://admin.da.live/laaa.html', rfreq.url);
    assert.equal('qrtoefi', rfreq.headers.get('Authorization'));
    assert.equal('myval', rfreq.headers.get('myheader'));
    assert.equal('https://admin.da.live/laaa.html', rfreq.headers.get('X-collab-room'));
  });

  it('Test handleApiRequest via Service Binding (param auth)', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/laaa.html?Authorization=lala',
      headers: new Headers(),
    };

    // eslint-disable-next-line consistent-return
    const mockFetch = async (url, opts) => {
      if (opts.method === 'HEAD'
        && url === 'https://admin.da.live/laaa.html'
        && opts.headers.get('Authorization') === 'lala') {
        return new Response(null, { status: 410 });
      }
    };

    // This is how a service binding is exposed to the program, via env
    const env = {
      daadmin: { fetch: mockFetch },
    };

    const res = await handleApiRequest(req, env);
    assert.equal(410, res.status);
  });

  it('Test handleApiRequest via Service Binding (header auth)', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/laaa.html',
      headers: new Headers({
        'sec-websocket-protocol': 'yjs,test-token',
      }),
    };

    // eslint-disable-next-line consistent-return
    const mockDaAdminFetch = async (url, opts) => {
      assert.equal(opts.headers.get('Authorization'), 'Bearer test-token');
      return new Response(null, { status: 200 });
    };

    // eslint-disable-next-line no-shadow
    const mockRoomFetch = async (req) => new Response(null, {
      status: 200,
      headers: {
        'sec-websocket-protocol': req.headers.get('sec-websocket-protocol'),
      },
    });

    const mockRoom = {
      fetch: mockRoomFetch,
    };

    const rooms = {
      idFromName: (name) => `id${hash(name)}`,
      get: (id) => mockRoom,
    };

    const env = {
      daadmin: { fetch: mockDaAdminFetch },
      rooms,
    };

    const res = await handleApiRequest(req, env);
    assert.equal(200, res.status);
    assert.deepEqual(Object.fromEntries(res.headers.entries()), {
      // test that service passes the sec-websocket-protocol header to docroom
      'sec-websocket-protocol': 'yjs,test-token',
    });
  });

  it('Test handleApiRequest wrong host', async () => {
    const req = {
      url: 'http://do.re.mi/https://some.where.else/hihi.html',
      headers: new Headers(),
    };

    const res = await handleApiRequest(req, {});
    assert.equal(404, res.status);
  });

  it('Test handleApiRequest document not found (404)', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/nonexistent.html',
      headers: new Headers(),
    };

    const mockFetch = async (url, opts) => new Response(null, { status: 404 });
    const daadmin = { fetch: mockFetch };
    const env = { daadmin };

    const res = await handleApiRequest(req, env);
    assert.equal(404, res.status);
    assert.equal('unable to get resource', await res.text());
  });

  it('Test handleApiRequest not authorized', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/hihi.html',
      headers: new Headers(),
    };

    const mockFetch = async (url, opts) => new Response(null, { status: 401 });
    const daadmin = { fetch: mockFetch };
    const env = { daadmin };

    const res = await handleApiRequest(req, env);
    assert.equal(401, res.status);
  });

  it('Test handleApiRequest da-admin fetch exception', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/test.html',
      headers: new Headers(),
    };

    // Mock daadmin.fetch to throw an exception
    const mockFetch = async (url, opts) => {
      throw new Error('Network error');
    };
    const daadmin = { fetch: mockFetch };
    const env = { daadmin };

    const res = await handleApiRequest(req, env);
    assert.equal(500, res.status);
    assert.equal('unable to get resource', await res.text());
  });

  it('Test handleApiRequest room object fetch exception', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/test.html',
      headers: new Headers(),
    };

    // Mock daadmin.fetch to return a successful response
    const mockDaAdminFetch = async (url, opts) => {
      const response = new Response(null, { status: 200 });
      response.headers.set('X-da-actions', 'read=allow');
      return response;
    };

    // Mock room object fetch to throw an exception
    // eslint-disable-next-line no-shadow
    const mockRoomFetch = async (req) => {
      throw new Error('Room fetch error');
    };

    const mockRoom = {
      fetch: mockRoomFetch,
    };

    const rooms = {
      idFromName: (name) => `id${hash(name)}`,
      get: (id) => mockRoom,
    };

    const env = {
      daadmin: { fetch: mockDaAdminFetch },
      rooms,
    };

    const res = await handleApiRequest(req, env);
    assert.equal(500, res.status);
    assert.equal('unable to get resource', await res.text());
  });

  it('Test DocRoom newWebSocketPair', () => {
    // Mock WebSocketPair since it's not available in Node.js test environment
    const mockWebSocketPair = function createWebSocketPair(url, opts) {
      const pair = [null, null];
      pair[0] = { // client side
        readyState: 1,
        close: () => {},
        send: () => {},
      };
      pair[1] = { // server side
        accept: () => {},
        send: () => {},
        close: () => {},
      };
      return pair;
    };

    // Mock WebSocketPair globally
    globalThis.WebSocketPair = mockWebSocketPair;

    try {
      const pair = DocRoom.newWebSocketPair();

      // Verify that newWebSocketPair returns an array-like object
      assert(Array.isArray(pair));
      assert.equal(pair.length, 2);

      // Verify that both elements are objects (WebSocket-like)
      assert(typeof pair[0] === 'object');
      assert(typeof pair[1] === 'object');

      // Verify that the server side has expected methods
      assert(typeof pair[1].accept === 'function');
      assert(typeof pair[1].send === 'function');
      assert(typeof pair[1].close === 'function');
    } finally {
      // Clean up the mock
      delete globalThis.WebSocketPair;
    }
  });

  it('Test ping API', async () => {
    const req = {
      url: 'http://do.re.mi/api/v1/ping',
    };

    const res = await defaultEdge.fetch(req, {});
    assert.equal(200, res.status);
    const json = await res.json();
    assert.equal('ok', json.status);
    assert.deepStrictEqual([], json.service_bindings);
  });

  it('Test ping API with service binding', async () => {
    const req = {
      url: 'http://some.host.name/api/v1/ping',
    };

    const res = await defaultEdge.fetch(req, { daadmin: {} });
    assert.equal(200, res.status);
    const json = await res.json();
    assert.equal('ok', json.status);
    assert.deepStrictEqual(['da-admin'], json.service_bindings);
  });
});

describe('Convert API test suite', () => {
  it('converts simple HTML to ProseMirror JSON', async () => {
    const html = '<body><main><div><p>Hello World</p></div></main></body>';
    const request = new Request('http://test/api/v1/convert', {
      method: 'POST',
      body: JSON.stringify({ html }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await handleConvert(request);
    assert.equal(200, response.status);

    const { prosemirror, daMetadata } = await response.json();
    assert.equal(prosemirror.type, 'doc');
    assert.ok(prosemirror.content.length > 0);
    assert.ok(typeof daMetadata === 'object');

    // Verify CORS headers
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  });

  it('converts HTML with blocks to ProseMirror JSON', async () => {
    const html = `<body><main><div>
      <p>First paragraph</p>
      <div class="marquee light">
        <div><div><p>Marquee content</p></div></div>
      </div>
    </div></main></body>`;
    const request = new Request('http://test/api/v1/convert', {
      method: 'POST',
      body: JSON.stringify({ html }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await handleConvert(request);
    assert.equal(200, response.status);

    const { prosemirror } = await response.json();
    assert.equal(prosemirror.type, 'doc');
    // Should contain table node for the block
    const hasTable = JSON.stringify(prosemirror).includes('"type":"table"');
    assert.ok(hasTable, 'Should convert block to table');
  });

  it('extracts daMetadata from HTML', async () => {
    const html = `<body><main><div><p>Content</p></div></main>
      <div class="da-metadata">
        <div><div>template</div><div>/templates/default</div></div>
      </div>
    </body>`;
    const request = new Request('http://test/api/v1/convert', {
      method: 'POST',
      body: JSON.stringify({ html }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await handleConvert(request);
    assert.equal(200, response.status);

    const { daMetadata } = await response.json();
    assert.equal(daMetadata.template, '/templates/default');
  });

  it('returns 400 for missing html parameter', async () => {
    const request = new Request('http://test/api/v1/convert', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await handleConvert(request);
    assert.equal(400, response.status);

    const { error } = await response.json();
    assert.equal(error, 'Missing html parameter');
  });

  it('returns 405 for non-POST methods', async () => {
    const request = new Request('http://test/api/v1/convert', {
      method: 'GET',
    });

    const response = await handleConvert(request);
    assert.equal(405, response.status);
  });

  it('handles CORS preflight requests', async () => {
    const request = new Request('http://test/api/v1/convert', {
      method: 'OPTIONS',
    });

    const response = await handleConvert(request);
    assert.equal(204, response.status);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization');
  });

  it('handles malformed JSON gracefully', async () => {
    const request = new Request('http://test/api/v1/convert', {
      method: 'POST',
      body: 'not valid json',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await handleConvert(request);
    assert.equal(500, response.status);

    const { error } = await response.json();
    assert.equal(error, 'Conversion failed');
  });

  it('handles empty HTML document', async () => {
    const html = '';
    const request = new Request('http://test/api/v1/convert', {
      method: 'POST',
      body: JSON.stringify({ html }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await handleConvert(request);
    // Empty string is falsy, so it should return 400
    assert.equal(400, response.status);
  });

  it('convert API is accessible via handleApiRequest', async () => {
    const html = '<body><main><div><p>Test</p></div></main></body>';
    const req = {
      url: 'http://localhost:4711/api/v1/convert',
      method: 'POST',
      json: async () => ({ html }),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    };

    const res = await handleApiRequest(req, {});
    assert.equal(200, res.status);
  });
});
