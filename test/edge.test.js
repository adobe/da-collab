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
import assert from 'node:assert';

import * as Y from 'yjs';
import defaultEdge, { DocRoom, handleApiRequest, handleErrors } from '../src/edge.js';
import { WSSharedDoc, persistence, setYDoc } from '../src/shareddoc.js';
import { doc2aem } from '../src/collab.js';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hash(str) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
      let chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

class MockRoom extends DocRoom {
  calls = [];
  handleApiCall(api, docName) {
    this.calls.push({api, docName});
    return new Response(null, {status: 200});
  }
}

describe('Worker test suite', () => {
  it('Test deleteAdmin', async () => {
    const expectedHash = hash('https://some.where/some/doc.html');
    const req = {
      url: 'http://localhost:9999/api/v1/deleteadmin?doc=https://some.where/some/doc.html'
    };

    const room = new MockRoom();
    const rooms = {
      idFromName(nm) { return hash(nm) },
      get(id) {
        if (id === expectedHash) {
          return room;
        }
      }
    }
    const env = { rooms };

    const resp = await handleApiRequest(req, env);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(room.calls, [{
      api: 'deleteAdmin',
      docName: 'https://some.where/some/doc.html'
     }
    ])
  });

  it('Test syncAdmin request without doc', async () => {
    const req = {
      url: 'http://localhost:12345/api/v1/syncadmin'
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
      url: 'http://localhost:12345/api/v1/syncadmin?doc=http://foobar.com/a/b/c.html'
    };

    const room = new MockRoom();
    const rooms = {
      idFromName(nm) { return hash(nm) },
      get(id) {
        if (id === expectedHash) {
          return room;
        }
      }
    }
    const env = { rooms };

    const resp = await handleApiRequest(req, env);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(room.calls, [
      {
        api: 'syncAdmin',
        docName: 'http://foobar.com/a/b/c.html'
      }
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
      idFromName(nm) { return hash(nm) },
      get(id) {
        if (id === expectedHash) {
          return room;
        }
      }
    }
    const env = {
      rooms,
      COLLAB_SHARED_SECRET: 'test-secret',
    };

    const resp = await handleApiRequest(req, env);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(room.calls, [
      {
        api: 'syncAdmin',
        docName: 'http://foobar.com/a/b/c.html'
      }
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
      idFromName(nm) { return hash(nm) },
      get(id) {
        if (id === expectedHash) {
          return room;
        }
      }
    }
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
      url: 'http://localhost:12345/api/v1/syncadmin?doc=http://foobar.com/a/b/c.html'
    };

    const room = new MockRoom();
    const rooms = {
      idFromName(nm) { return hash(nm) },
      get(id) {
        if (id === expectedHash) {
          return room;
        }
      }
    }
    const env = { rooms };

    const resp = await defaultEdge.fetch(req, env);
    assert.equal(200, resp.status);
    assert.deepStrictEqual(room.calls, [
      {
        api: 'syncAdmin',
        docName: 'http://foobar.com/a/b/c.html'
      }
    ]);
  });

  it('Test unknown API', async () => {
    const req = {
      url: 'http://localhost:12345/api/v1/foobar'
    };

    const resp = await handleApiRequest(req, null);
    assert.equal(400, resp.status, 'Doc wasnt set so should return a 400 for invalid');
    assert.equal('Bad Request', await resp.text());
  });

  it('Docroom deleteFromAdmin', async () => {
    const ydocName = 'http://foobar.com/q.html';
    const testYdoc = new WSSharedDoc(ydocName);
    const m = setYDoc(ydocName, testYdoc);

    const connCalled = []
    const mockConn = {
      close() { connCalled.push('close'); }
    };
    testYdoc.conns.set(mockConn, 1234);

    const req = {
      url: `${ydocName}?api=deleteAdmin`
    };

    const dr = new DocRoom({});

    assert(m.has(ydocName), 'Precondition');
    const resp = await dr.fetch(req)
    assert.equal(204, resp.status);
    assert(!m.has(ydocName), 'Doc should have been removed');
    assert.deepStrictEqual(['close'], connCalled);
  });

  it('Docroom deleteFromAdmin not found', async () => {
    const req = {
      url: `https://blah.blah/blah.html?api=deleteAdmin`
    };

    const dr = new DocRoom({});
    const resp = await dr.fetch(req)
    assert.equal(404, resp.status);
  });

  it('Docroom syncFromAdmin', async () => {
    const ydocName = 'http://foobar.com/a/b/c.html';
    const testYdoc = new WSSharedDoc(ydocName);
    const m = setYDoc(ydocName, testYdoc);

    const connCalled = []
    const mockConn = {
      close() { connCalled.push('close'); }
    };
    testYdoc.conns.set(mockConn, 1234);

    const req = {
      url: `${ydocName}?api=syncAdmin`
    };

    const dr = new DocRoom({});

    assert(m.has(ydocName), 'Precondition');
    const resp = await dr.fetch(req)
    assert.equal(200, resp.status);
    assert(!m.has(ydocName), 'Doc should have been removed');
    assert.deepStrictEqual(['close'], connCalled);
  });

  it('Unknown doc update request gives 404', async () => {
    const dr = new DocRoom({});

    const req = {
      url: 'http://foobar.com/a/b/d/e/f.html?api=syncAdmin'
    };
    const resp = await dr.fetch(req)

    assert.equal(404, resp.status);
  });

  it('Unknown DocRoom API call gives 400', async () => {
    const dr = new DocRoom({ storage: null }, null);
    const req = {
      url: 'http://foobar.com/a.html?api=blahblahblah'
    };
    const resp = await dr.fetch(req)

    assert.equal(400, resp.status);
  });

  it('Test DocRoom fetch', async () => {
    const savedNWSP = DocRoom.newWebSocketPair;
    const savedBS = persistence.bindState;

    try {
      const bindCalled = [];
      persistence.bindState = async (nm, d, c) => {
        bindCalled.push({nm, d, c});
        return new Map();
      }

      const wspCalled = [];
      const wsp0 = {};
      const wsp1 = {
        accept() { wspCalled.push('accept'); },
        addEventListener(type) { wspCalled.push(`addEventListener ${type}`); },
        close() { wspCalled.push('close'); }
      }
      DocRoom.newWebSocketPair = () => [wsp0, wsp1];

      const daadmin = { blah: 1234 };
      const dr = new DocRoom({ storage: null }, { daadmin });
      const headers = new Map();
      headers.set('Upgrade', 'websocket');
      headers.set('Authorization', 'au123');
      headers.set('X-collab-room', 'http://foo.bar/1/2/3.html');

      const req = {
        headers,
        url: 'http://localhost:4711/'
      };
      const resp = await dr.fetch(req, {}, 306);
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

  it('Test DocRoom fetch expects websocket', async () => {
    const dr = new DocRoom({ storage: null }, null);

    const req = {
      headers: new Headers(),
      url: 'http://localhost:4711/'
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
      url: 'http://localhost:4711/'
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
        await sleep(1); // the real bindState is async and we only reset the failed doc in the promise
        throw new Error('unable to get resource - status: 404');
      };

      const wsp0 = {};
      const wsp1 = {
        accept() {},
        addEventListener() {},
        close() {}
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
        url: 'http://localhost:4711/'
      };

      const resp = await dr.fetch(req, {}, 306);

      // Should return 500 error when bindState fails
      assert.equal(500, resp.status);
      assert.equal('internal server error', await resp.text());
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
        await sleep(1); // the real bindState is async and we only reset the failed doc in the promise
        throw new Error('WebSocket setup error');
      };

      // Mock WebSocketPair to return valid objects
      const wsp0 = {};
      const wsp1 = {
        accept() {},
        addEventListener() {},
        close() {}
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
        url: 'http://localhost:4711/'
      };
      const resp = await dr.fetch(req);

      // Should return 500 error due to exception in WebSocket setup
      assert.equal(500, resp.status);
      assert.equal('internal server error', await resp.text());

    } finally {
      DocRoom.newWebSocketPair = savedNWSP;
      persistence.bindState = savedBS;
    }
  });

  it('Test handleErrors success', async () => {
    const f = () => 42;

    const res = await handleErrors(null, f);
    assert.equal(42, res);
  });

  it('Test HandleError error', async () => {
    const f = () => { throw new Error('testing'); }

    const req = {
      headers: new Headers()
    };
    const res = await handleErrors(req, f);
    assert.equal(500, res.status);
  });

  it('Test handleErrors WebSocket error', async () => {
    const f = () => { throw new Error('WebSocket error test'); }

    const req = {
      headers: new Headers({
        upgrade: 'websocket',
      })
    };

    // Mock WebSocketPair since it's not available in Node.js test environment
    const mockWebSocketPair = function() {
      const pair = [null, null];
      pair[0] = { // client side
        readyState: 1,
        close: () => {},
        send: () => {}
      };
      pair[1] = { // server side
        accept: () => {},
        send: () => {},
        close: () => {}
      };
      return pair;
    };

    // Mock WebSocketPair globally
    globalThis.WebSocketPair = mockWebSocketPair;

    try {
      // In Node.js, status 101 is not valid, so we expect an error
      // But the important thing is that the WebSocket error path is covered
      try {
        const res = await handleErrors(req, f);
        // If we get here, the test environment supports status 101
        assert.equal(101, res.status);
        assert(res.webSocket !== undefined);
      } catch (error) {
        // Expected in Node.js - status 101 is not valid
        assert(error.message.includes('must be in the range of 200 to 599'));
      }
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
      headers
    }

    const roomFetchCalled = [];
    const myRoom = {
      fetch(req) {
        roomFetchCalled.push(req);
        return new Response(null, { status: 306 });
      }
    }

    const mockFetchCalled = [];
    const mockFetch = async (url, opts) => {
      mockFetchCalled.push({ url, opts });
      return new Response(null, { status: 200 });
    };
    const serviceBinding = {
      fetch: mockFetch
    };

    const rooms = {
      idFromName(nm) { return `id${hash(nm)}`; },
      get(id) { return id === 'id1255893316' ? myRoom : null; }
    }
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

  it('Test handleApiRequest via Service Binding', async () => {
    const headers = new Map();
    headers.set('myheader', 'myval');
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/laaa.html?Authorization=lala',
      headers
    }

    const mockFetch = async (url, opts) => {
      if (opts.method === 'HEAD'
        && url === 'https://admin.da.live/laaa.html'
        && opts.headers.get('Authorization') === 'lala') {
        return new Response(null, {status: 410});
      }
    };

    // This is how a service binding is exposed to the program, via env
    const env = {
      daadmin: { fetch : mockFetch }
    };

    const res = await handleApiRequest(req, env);
    assert.equal(410, res.status);
  });

  it('Test handleApiRequest wrong host', async () => {
    const req = {
      url: 'http://do.re.mi/https://some.where.else/hihi.html',
    }

    const res = await handleApiRequest(req, {});
    assert.equal(404, res.status);
  });

  it('Test handleApiRequest document not found (404)', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/nonexistent.html',
    }

    const mockFetch = async (url, opts) => new Response(null, {status: 404});
    const daadmin = { fetch: mockFetch };
    const env = { daadmin };

    const res = await handleApiRequest(req, env);
    assert.equal(404, res.status);
    assert.equal('unable to get resource', await res.text());
  });

  it('Test handleApiRequest not authorized', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/hihi.html',
    }

    const mockFetch = async (url, opts) => new Response(null, {status: 401});
    const daadmin = { fetch: mockFetch };
    const env = { daadmin };

    const res = await handleApiRequest(req, env);
    assert.equal(401, res.status);
  });

  it('Test handleApiRequest da-admin fetch exception', async () => {
    const req = {
      url: 'http://do.re.mi/https://admin.da.live/test.html',
    }

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
    }

    // Mock daadmin.fetch to return a successful response
    const mockDaAdminFetch = async (url, opts) => {
      const response = new Response(null, { status: 200 });
      response.headers.set('X-da-actions', 'read=allow');
      return response;
    };

    // Mock room object fetch to throw an exception
    const mockRoomFetch = async (req) => {
      throw new Error('Room fetch error');
    };

    const mockRoom = {
      fetch: mockRoomFetch
    };

    const rooms = {
      idFromName: (name) => `id${hash(name)}`,
      get: (id) => mockRoom
    };

    const env = {
      daadmin: { fetch: mockDaAdminFetch },
      rooms
    };

    const res = await handleApiRequest(req, env);
    assert.equal(500, res.status);
    assert.equal('unable to get resource', await res.text());
  });

  it('Test DocRoom newWebSocketPair', () => {
    // Mock WebSocketPair since it's not available in Node.js test environment
    const mockWebSocketPair = function() {
      const pair = [null, null];
      pair[0] = { // client side
        readyState: 1,
        close: () => {},
        send: () => {}
      };
      pair[1] = { // server side
        accept: () => {},
        send: () => {},
        close: () => {}
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
    }

    const res = await defaultEdge.fetch(req, {});
    assert.equal(200, res.status);
    const json = await res.json();
    assert.equal('ok', json.status);
    assert.deepStrictEqual([], json.service_bindings);
  });

  it('Test ping API with service binding', async () => {
    const req = {
      url: 'http://some.host.name/api/v1/ping',
    }

    const res = await defaultEdge.fetch(req, { daadmin: {}});
    assert.equal(200, res.status);
    const json = await res.json();
    assert.equal('ok', json.status);
    assert.deepStrictEqual(['da-admin'], json.service_bindings);
  });
});