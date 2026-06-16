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
import assert from 'node:assert';

import defaultEdge, {
  DocRoom, handleApiRequest, handleErrors, wsAuthFailureResponse,
} from '../src/edge.js';
import { WSSharedDoc, persistence, setYDoc } from '../src/shareddoc.js';

function makeCtx(storage = null) {
  const accepted = [];
  return {
    storage,
    accepted,
    acceptWebSocket(ws) { accepted.push(ws); },
    waitUntil(p) { return p; },
  };
}

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

  it('Docroom clearStorage deletes all CF storage and closes connections', async () => {
    const ydocName = 'http://foobar.com/clearstorage-test.html';
    const testYdoc = new WSSharedDoc(ydocName);
    const m = setYDoc(ydocName, testYdoc);

    const connClosed = [];
    const mockConn = { close() { connClosed.push('close'); } }; // eslint-disable-line max-statements-per-line
    testYdoc.conns.set(mockConn, 1234);

    const deleteCalled = [];
    const mockStorage = {
      async deleteAll() { deleteCalled.push(true); },
    };

    const req = { url: `${ydocName}?api=clearStorage` };
    const dr = new DocRoom({ storage: mockStorage });

    assert(m.has(ydocName), 'Precondition: doc must be registered');
    const resp = await dr.fetch(req);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(deleteCalled, [true], 'storage.deleteAll() must be called');
    assert(!m.has(ydocName), 'Doc should have been removed from docs map');
    assert.deepStrictEqual(connClosed, ['close'], 'Active connections should be closed');
    testYdoc.destroy();
  });

  it('Docroom clearStorage without active doc still clears storage', async () => {
    const deleteCalled = [];
    const mockStorage = {
      async deleteAll() { deleteCalled.push(true); },
    };
    const dr = new DocRoom({ storage: mockStorage });

    const req = { url: 'http://foobar.com/no-doc.html?api=clearStorage' };
    const resp = await dr.fetch(req);

    assert.equal(200, resp.status, 'clearStorage returns 200 even when doc is not in memory');
    assert.deepStrictEqual(deleteCalled, [true], 'storage.deleteAll() must still be called');
  });

  it('Docroom clearStorage with no storage context still returns 200', async () => {
    const dr = new DocRoom({});
    const req = { url: 'http://foobar.com/no-storage.html?api=clearStorage' };
    const resp = await dr.fetch(req);
    assert.equal(200, resp.status);
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

      const attachCalled = [];
      const wsp0 = {};
      const wsp1 = {
        serializeAttachment(data) { attachCalled.push(data); },
        close() {},
      };
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { blah: 1234 };
      const ctx = makeCtx(null);
      const dr = new DocRoom(ctx, { daadmin });
      const headers = new Headers({
        Upgrade: 'websocket',
        Authorization: 'au123',
        'X-collab-room': 'http://foo.bar/1/2/3.html',
      });

      const req = {
        headers,
        url: 'http://localhost:4711/',
      };

      // fetch returns 101 immediately; Hibernation API accepts the socket synchronously.
      const resp = await dr.fetch(req, {}, 306);
      assert.equal(resp.headers.get('sec-websocket-protocol'), undefined);
      assert.equal(306 /* fabricated websocket response code */, resp.status);

      // CF Hibernation API: acceptWebSocket must be called before the response is returned
      assert.equal(1, ctx.accepted.length, 'acceptWebSocket must be called');
      assert.equal(wsp1, ctx.accepted[0], 'acceptWebSocket called with server socket');

      // serializeAttachment must carry docName and auth for hibernation recovery
      assert.equal(1, attachCalled.length);
      assert.equal('http://foo.bar/1/2/3.html', attachCalled[0].docName);
      assert.equal('au123', attachCalled[0].auth);

      // Auth set synchronously before initSession runs
      assert.equal('au123', wsp1.auth);

      // Wait for the async session setup to complete
      await sleep(10);

      assert.equal(1, bindCalled.length);
      assert.equal('http://foo.bar/1/2/3.html', bindCalled[0].nm);
      assert.equal('1234', bindCalled[0].d.daadmin.blah);
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
        serializeAttachment() {},
        close() {},
      };
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { blah: 1234 };
      const dr = new DocRoom(makeCtx(null), { daadmin });
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
        const err = new Error('unable to get resource - status: 404');
        err.status = 404;
        throw err;
      };

      const closeCalled = [];
      const wsp0 = {};
      const wsp1 = {
        serializeAttachment() {},
        close(...args) { closeCalled.push(args); },
      };
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { fetch: async () => ({ ok: true }) };
      const dr = new DocRoom(makeCtx(null), { daadmin });
      const headers = new Map();
      headers.set('Upgrade', 'websocket');
      headers.set('X-collab-room', 'http://foo.bar/test.html');
      headers.set('X-auth-actions', 'read=allow,write=allow');

      const req = { headers, url: 'http://localhost:4711/' };

      // fetch returns 101 immediately; setup fails asynchronously
      const resp = await dr.fetch(req, {}, 306);
      assert.equal(306, resp.status, 'fetch must return 101 immediately, not wait for setup');

      // Wait for the async setup to fail
      await sleep(20);

      assert.equal(1, closeCalled.length, 'server socket must be closed on setup failure');
      assert.equal(1011, closeCalled[0][0]);
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom fetch synchronous error returns 500', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    try {
      DocRoom.newWebSocketPair = () => {
        throw new Error('pair creation failed');
      };

      const dr = new DocRoom({ storage: null }, {});
      const headers = new Map();
      headers.set('Upgrade', 'websocket');
      headers.set('X-collab-room', 'http://foo.bar/test.html');

      const req = { headers, url: 'http://localhost:4711/' };
      const resp = await dr.fetch(req);
      assert.equal(500, resp.status);
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
    }
  });

  it('Test DocRoom fetch WebSocket setup exception', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      persistence.bindState = async () => {
        await sleep(1);
        throw new Error('WebSocket setup error');
      };

      const closeCalled = [];
      const wsp0 = {};
      const wsp1 = {
        serializeAttachment() {},
        close(...args) { closeCalled.push(args); },
      };
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { test: 'value' };
      const dr = new DocRoom(makeCtx(null), { daadmin });
      const headers = new Map();
      headers.set('Upgrade', 'websocket');
      headers.set('Authorization', 'au123');
      headers.set('X-collab-room', 'http://foo.bar/test.html');

      const req = { headers, url: 'http://localhost:4711/' };

      const resp = await dr.fetch(req, {}, 306);
      assert.equal(306, resp.status, 'fetch must return 101 immediately');

      await sleep(20);

      assert.equal(1, closeCalled.length, 'server socket must be closed on setup failure');
      assert.equal(1011, closeCalled[0][0]);
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
    // eslint-disable-next-line func-names
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
    // eslint-disable-next-line func-names
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

  it('Test handleApiRequest not authorized (non-WS)', async () => {
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

  async function testWsUpgradeAuthFailure(httpStatus, expectedCode, expectedReason, protocol) {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/hihi.html',
      headers: new Headers({ Upgrade: 'websocket', 'sec-websocket-protocol': protocol }),
    };
    const env = { daadmin: { fetch: async () => new Response(null, { status: httpStatus }) } };

    const ops = [];
    let triggerMessage;
    globalThis.WebSocketPair = function MockWSP() {
      const server = {
        accept() { ops.push('accept'); },
        addEventListener(type, fn) {
          ops.push(['addEventListener', type]);
          if (type === 'message') {
            triggerMessage = fn;
          }
        },
        close(c, r) { ops.push(['close', c, r]); },
      };
      return [{}, server];
    };
    try {
      try {
        await handleApiRequest(req, env);
      } catch (e) {
        // status 101 may not be constructable in node test env; listener assertions cover it
      }
      const expectedListeners = ['accept', ['addEventListener', 'message'], ['addEventListener', 'error'], ['addEventListener', 'close']];
      assert.deepEqual(ops, expectedListeners);
      assert(triggerMessage !== undefined, 'message listener must be registered');
      triggerMessage();
      assert.deepEqual(ops, [...expectedListeners, ['close', expectedCode, expectedReason]]);
    } finally {
      delete globalThis.WebSocketPair;
    }
  }

  it('Test handleApiRequest not authorized (WS upgrade) -> 4401 close', async () => {
    await testWsUpgradeAuthFailure(401, 4401, 'auth', 'yjs, stale-token');
  });

  it('Test handleApiRequest forbidden (WS upgrade) -> 4403 close', async () => {
    await testWsUpgradeAuthFailure(403, 4403, 'forbidden', 'yjs, t');
  });

  it('Test wsAuthFailureResponse closes via safety timeout when client never sends', async () => {
    const ops = [];
    let closeTimer;
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = (fn, ms) => {
      closeTimer = { fn, ms };
      return closeTimer;
    };
    globalThis.clearTimeout = (t) => {
      if (t === closeTimer) {
        closeTimer = null;
      }
    };
    globalThis.WebSocketPair = function MockWSP() {
      const server = {
        accept() { ops.push('accept'); },
        addEventListener() {},
        close(c, r) { ops.push(['close', c, r]); },
      };
      return [{}, server];
    };
    try {
      try {
        wsAuthFailureResponse(new Headers(), 4401, 'auth');
      } catch (e) {
        // status 101 is not constructable in Node test env — listeners are set up before the throw
      }
      assert(closeTimer !== undefined, 'safety timeout must be armed');
      assert.equal(closeTimer.ms, 5000);
      closeTimer.fn();
      assert.deepEqual(ops, ['accept', ['close', 4401, 'auth']]);
    } finally {
      globalThis.setTimeout = origSetTimeout;
      globalThis.clearTimeout = origClearTimeout;
      delete globalThis.WebSocketPair;
    }
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

  it('Test DocRoom webSocketMessage restores auth and processes message (cold start)', async () => {
    const savedBS = persistence.bindState;
    try {
      const bindCalled = [];
      persistence.bindState = async (nm, d, c) => {
        bindCalled.push({ nm, c });
        return new Map();
      };

      const docName = 'http://foo.bar/cold-start.html';
      // Doc is NOT in the map — simulates hibernation eviction

      const closeCalled = [];
      const mockConn = {
        auth: undefined,
        readOnly: undefined,
        binaryType: undefined,
        readyState: 1,
        send() {},
        close() { closeCalled.push('close'); },
        deserializeAttachment() {
          // authActions format: comma-separated values extracted after '=' from X-da-actions header
          return { docName, auth: 'Bearer session-token', authActions: 'read,write' };
        },
      };

      const dr = new DocRoom(makeCtx({}), { daadmin: {} });
      const msg = new Uint8Array([0, 0]).buffer; // minimal message

      await dr.webSocketMessage(mockConn, msg);

      // Auth must be restored from the serialized attachment
      assert.equal('Bearer session-token', mockConn.auth);
      assert.equal(undefined, mockConn.readOnly); // write is in authActions
      // Doc should have been initialized (bindState called)
      assert.equal(1, bindCalled.length);
      assert.equal(docName, bindCalled[0].nm);
    } finally {
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom webSocketMessage warm start (doc already in memory)', async () => {
    const savedBS = persistence.bindState;
    try {
      const bindCalled = [];
      persistence.bindState = async (nm) => {
        bindCalled.push(nm);
        return new Map();
      };

      const docName = 'http://foo.bar/warm-start.html';
      const testYdoc = new WSSharedDoc(docName);
      const mockConn = {
        auth: undefined,
        binaryType: undefined,
        readyState: 1,
        send() {},
        close() {},
        deserializeAttachment() {
          return { docName, auth: 'Bearer warm-token', authActions: 'write' };
        },
      };
      testYdoc.conns.set(mockConn, new Set());
      setYDoc(docName, testYdoc);

      try {
        const dr = new DocRoom(makeCtx({}), { daadmin: {} });
        const msg = new Uint8Array([0]).buffer;
        await dr.webSocketMessage(mockConn, msg);

        assert.equal('Bearer warm-token', mockConn.auth);
        // Doc was in memory — bindState must NOT be called again
        assert.equal(0, bindCalled.length);
      } finally {
        testYdoc.destroy();
      }
    } finally {
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom webSocketClose cleans up connection', async () => {
    const docName = 'http://foo.bar/ws-close.html';
    const testYdoc = new WSSharedDoc(docName);

    const closeCalled = [];
    const mockConn = {
      close() { closeCalled.push('close'); },
      deserializeAttachment() {
        return { docName, auth: 'test-auth', authActions: 'write=allow' };
      },
    };
    testYdoc.conns.set(mockConn, new Set());
    const m = setYDoc(docName, testYdoc);

    const dr = new DocRoom(makeCtx(null), {});
    await dr.webSocketClose(mockConn, 1000, 'Normal', true);

    assert.deepStrictEqual(['close'], closeCalled);
    assert(!m.has(docName), 'Doc should be removed when no connections remain');

    testYdoc.destroy();
  });

  it('Test DocRoom webSocketError logs and cleans up connection', async () => {
    const docName = 'http://foo.bar/ws-error.html';
    const testYdoc = new WSSharedDoc(docName);

    const closeCalled = [];
    const mockConn = {
      close() { closeCalled.push('close'); },
      deserializeAttachment() {
        return { docName, auth: undefined, authActions: '' };
      },
    };
    testYdoc.conns.set(mockConn, new Set());
    const m = setYDoc(docName, testYdoc);

    const dr = new DocRoom(makeCtx(null), {});
    await dr.webSocketError(mockConn, new Error('connection reset'));

    assert.deepStrictEqual(['close'], closeCalled);
    assert(!m.has(docName), 'Doc should be removed on error');

    testYdoc.destroy();
  });

  it('Test DocRoom webSocketClose no-op when doc not in memory', async () => {
    const mockConn = {
      close() { assert.fail('close must not be called when doc is not in memory'); },
      deserializeAttachment() {
        return { docName: 'http://foo.bar/gone.html', auth: undefined, authActions: '' };
      },
    };

    const dr = new DocRoom(makeCtx(null), {});
    await dr.webSocketClose(mockConn, 1000, 'Normal', true);
    // No assertion needed — test passes if close() is not called
  });

  it('Test DocRoom webSocketMessage read-only auth restored', async () => {
    const savedBS = persistence.bindState;
    try {
      persistence.bindState = async () => new Map();

      const docName = 'http://foo.bar/readonly.html';
      const mockConn = {
        auth: undefined,
        readOnly: undefined,
        binaryType: undefined,
        readyState: 1,
        send() {},
        close() {},
        deserializeAttachment() {
          // authActions without 'write' — should be read-only
          return { docName, auth: 'Bearer ro-token', authActions: 'read' };
        },
      };

      const dr = new DocRoom(makeCtx({}), { daadmin: {} });
      await dr.webSocketMessage(mockConn, new Uint8Array([0]).buffer);

      assert.equal('Bearer ro-token', mockConn.auth);
      assert.equal(true, mockConn.readOnly);
    } finally {
      persistence.bindState = savedBS;
    }
  });

  // ---------------------------------------------------------------------------
  // Backend resolution (api-live-switch branch)
  //
  // The backend is derived from the doc URL alone — there is no X-is-helix
  // header or isHelix attachment field. api.aem.live docs are reached via the
  // global fetch; everything else via the da-admin service binding.
  // ---------------------------------------------------------------------------

  it('Test handleApiRequest routes an api.aem.live HEAD through the global fetch', async () => {
    const savedFetch = globalThis.fetch;
    const helixCalls = [];
    globalThis.fetch = async (url, opts) => {
      helixCalls.push({ url, opts });
      return new Response(null, { status: 200 });
    };

    const roomFetchCalls = [];
    const myRoom = {
      fetch(req) {
        roomFetchCalls.push(req);
        return new Response(null, { status: 306 });
      },
    };
    const daadminCalls = [];
    const daadmin = {
      fetch: async (url, opts) => {
        daadminCalls.push({ url, opts });
        return new Response(null, { status: 200 });
      },
    };
    const rooms = {
      idFromName(nm) { return `id${hash(nm)}`; },
      get() { return myRoom; },
    };
    const env = { rooms, daadmin };

    try {
      const req = {
        url: 'http://do.re.mi/https://api.aem.live/o/r/p.html',
        headers: new Headers(),
      };
      const res = await handleApiRequest(req, env);
      assert.equal(306, res.status);

      assert.equal(1, helixCalls.length, 'the global fetch must be used for the Helix HEAD');
      assert.equal('HEAD', helixCalls[0].opts.method);
      assert.equal('https://api.aem.live/o/r/p.html', helixCalls[0].url);
      assert.equal(0, daadminCalls.length, 'daadmin.fetch must NOT be called for Helix docs');

      assert.equal(1, roomFetchCalls.length);
      assert.equal(
        'https://api.aem.live/o/r/p.html',
        roomFetchCalls[0].headers.get('X-collab-room'),
      );
      assert.equal(
        null,
        roomFetchCalls[0].headers.get('X-is-helix'),
        'X-is-helix header must no longer be sent — the room derives the backend from the doc URL',
      );
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('Test handleApiRequest routes a da-admin HEAD through the daadmin binding', async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      assert.fail('global fetch must not be used for da-admin docs');
    };

    const daadminCalls = [];
    const daadmin = {
      fetch: async (url, opts) => {
        daadminCalls.push({ url, opts });
        return new Response(null, { status: 200 });
      },
    };
    const myRoom = {
      fetch() { return new Response(null, { status: 306 }); },
    };
    const rooms = {
      idFromName(nm) { return `id${hash(nm)}`; },
      get() { return myRoom; },
    };
    const env = { rooms, daadmin };

    try {
      const req = {
        url: 'http://do.re.mi/https://admin.da.live/some.html',
        headers: new Headers(),
      };
      const res = await handleApiRequest(req, env);
      assert.equal(306, res.status);
      assert.equal(1, daadminCalls.length, 'daadmin.fetch must be used for da-admin docs');
      assert.equal('HEAD', daadminCalls[0].opts.method);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('Test handleApiRequest still rejects api.aem.* hosts that are not api.aem.live', async () => {
    const req = {
      url: 'http://do.re.mi/https://api.aem.fake/laaa.html',
      headers: new Headers(),
    };
    const res = await handleApiRequest(req, { daadmin: {} });
    assert.equal(404, res.status, 'Only api.aem.live (with trailing slash) is whitelisted');
  });

  it('Test DocRoom fetch forces read,write authActions for an api.aem.live doc', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      persistence.bindState = async () => new Map();

      const attachCalled = [];
      const wsp1 = {
        serializeAttachment(data) { attachCalled.push(data); },
        close() {},
      };
      DocRoom.newWebSocketPair = () => [{}, wsp1];

      const dr = new DocRoom(makeCtx(null), { daadmin: {} });
      const headers = new Headers({
        Upgrade: 'websocket',
        Authorization: 'au-helix',
        'X-collab-room': 'https://api.aem.live/o/r/p.html',
        // Empty X-auth-actions would normally mark the conn read-only; for a
        // Helix doc the backend's read,write default must override it.
        'X-auth-actions': '',
      });
      const req = { headers, url: 'http://localhost:4711/' };
      const resp = await dr.fetch(req, {}, 306);

      assert.equal(306, resp.status);
      assert.equal(1, attachCalled.length);
      assert.equal('https://api.aem.live/o/r/p.html', attachCalled[0].docName);
      assert.equal('au-helix', attachCalled[0].auth);
      assert.equal(
        'read,write',
        attachCalled[0].authActions,
        'Helix backend must force read,write authActions until Helix reports them',
      );
      assert.equal(
        false,
        Object.prototype.hasOwnProperty.call(attachCalled[0], 'isHelix'),
        'attachment must no longer carry an isHelix field',
      );
      assert.notEqual(true, wsp1.readOnly, 'must not be marked readOnly when the backend forces write');
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom fetch honours X-auth-actions for a da-admin doc', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      persistence.bindState = async () => new Map();

      const attachCalled = [];
      const wsp1 = {
        serializeAttachment(data) { attachCalled.push(data); },
        close() {},
      };
      DocRoom.newWebSocketPair = () => [{}, wsp1];

      const dr = new DocRoom(makeCtx(null), { daadmin: {} });
      const headers = new Headers({
        Upgrade: 'websocket',
        'X-collab-room': 'https://admin.da.live/foo.html',
        'X-auth-actions': 'read',
      });
      const req = { headers, url: 'http://localhost:4711/' };
      await dr.fetch(req, {}, 306);

      assert.equal('read', attachCalled[0].authActions, 'da-admin authActions must come from the header');
      assert.equal(true, wsp1.readOnly, 'a read-only da-admin connection must be marked readOnly');
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom routes an api.aem.live doc to bindState (Helix backend derived from URL)', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      const bindCalled = [];
      persistence.bindState = async (nm, ydoc) => {
        bindCalled.push({ nm, daadmin: ydoc.daadmin });
        return new Map();
      };

      const wsp1 = { serializeAttachment() {}, close() {} };
      DocRoom.newWebSocketPair = () => [{}, wsp1];

      const daadmin = { mark: 'da' };
      const dr = new DocRoom(makeCtx(null), { daadmin });
      const headers = new Headers({
        Upgrade: 'websocket',
        'X-collab-room': 'https://api.aem.live/x.html',
      });
      const req = { headers, url: 'http://localhost:4711/' };
      const resp = await dr.fetch(req, {}, 306);
      assert.equal(306, resp.status);

      // initSession runs asynchronously after the response is returned
      await sleep(10);

      assert.equal(1, bindCalled.length);
      assert.equal('https://api.aem.live/x.html', bindCalled[0].nm);
    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test DocRoom webSocketMessage works with an attachment that has no isHelix field', async () => {
    const savedBS = persistence.bindState;
    try {
      const bindCalled = [];
      persistence.bindState = async (nm) => {
        bindCalled.push(nm);
        return new Map();
      };

      const docName = 'https://api.aem.live/cold-helix.html';
      const mockConn = {
        auth: undefined,
        readOnly: undefined,
        binaryType: undefined,
        readyState: 1,
        send() {},
        close() {},
        deserializeAttachment() {
          return { docName, auth: 'Bearer t', authActions: 'read,write' };
        },
      };

      const dr = new DocRoom(makeCtx({}), { daadmin: {} });
      const msg = new Uint8Array([0, 0]).buffer;
      await dr.webSocketMessage(mockConn, msg);

      assert.equal('Bearer t', mockConn.auth);
      assert.equal(1, bindCalled.length);
      assert.equal(docName, bindCalled[0]);
    } finally {
      persistence.bindState = savedBS;
    }
  });
});
