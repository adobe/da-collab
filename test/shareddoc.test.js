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
import assert from 'node:assert';
import esmock from 'esmock';

import { aem2doc, doc2aem, EMPTY_DOC } from '@da-tools/da-parser';
import {
  closeConn, getYDoc, invalidateFromAdmin, messageListener, persistence,
  readState, setupWSConnection, setYDoc, showError, storeState, updateHandler, WSSharedDoc,
} from '../src/shareddoc.js';

function isSubArray(full, sub) {
  if (sub.length === 0) {
    return true;
  }

  const candidateIdxs = [];
  for (let i = 0; i < full.length; i += 1) {
    if (full[i] === sub[0]) {
      candidateIdxs.push(i);
    }
  }

  /* eslint-disable */
  nextCandidate:
  for (let i = 0; i < candidateIdxs.length; i++) {
    for (let j = 0; j < sub.length; j++) {
      if (sub[j] !== full[candidateIdxs[i] + j]) {
        break nextCandidate;
      }
    }
    return true;
  }
  /* eslint-enable */
  /* eslint-disable no-unused-vars, no-underscore-dangle */

  return false;
}

function getAsciiChars(str) {
  const codes = [];

  const strArr = Array.from(str);
  for (const c of strArr) {
    codes.push(c.charCodeAt(0));
  }
  return codes;
}

function wait(milliseconds) {
  return new Promise((r) => {
    setTimeout(r, milliseconds);
  });
}

describe('Collab Test Suite', () => {
  it('Test updateHandler', () => {
    const conn = {
      isClosed: false,
      message: null,
      readyState: 1, // wsReadyStateOpen
      has() {
        return true;
      },
      close() {
        this.isClosed = true;
      },
      send(m) {
        this.message = m;
      },
    };

    const deleted = [];
    const conns = {
      forEach(f) {
        f(null, conn);
      },
      has(c) {
        return c === conn;
      },
      get: () => 123,
      delete(id) { deleted.push(id); },
    };

    const update = new Uint8Array([21, 31]);
    const doc = { conns };

    updateHandler(update, null, doc);

    assert(conn.isClosed === false);
    assert.deepStrictEqual(deleted, []);
    assert.deepStrictEqual(update, conn.message.slice(-2));
  });

  it('Test updateHandler closes first', () => {
    const conn1 = {
      isClosed: false,
      readyState: 42, // unknown code, causes to close
      has() {
        return true;
      },
      close() {
        this.isClosed = true;
      },
    };
    const conn2 = { ...conn1 }; // clone conn1 into conn2

    // We have multiple connections here
    const fe = (func) => {
      func(null, conn1);
      func(null, conn2);
    };

    const deleted = [];
    const conns = {
      forEach: fe,
      has(c) {
        return c === conn1 || c === conn2;
      },
      get: () => 123,
      delete(id) { deleted.push(id); },
    };

    const update = new Uint8Array([99, 98, 97, 96]);
    const doc = { conns };

    updateHandler(update, null, doc);

    assert(conn1.isClosed === true);
    assert(conn2.isClosed === true);
    assert.deepStrictEqual(deleted, [conn1, conn2]);
  });

  it('Test persistence get ok', async () => {
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      assert.equal(url, 'foo');
      assert.equal(opts.method, undefined);
      assert(opts.headers === undefined);
      return {
        ok: true, text: async () => 'content', status: 200, statusText: 'OK',
      };
    };
    const result = await persistence.get('foo', undefined, daadmin);
    assert.equal(result, 'content');
  });

  it('Test persistence get auth', async () => {
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      assert.equal(url, 'foo');
      assert.equal(opts.method, undefined);
      assert.equal(opts.headers.get('authorization'), 'auth');
      return {
        ok: true, text: async () => 'content', status: 200, statusText: 'OK',
      };
    };
    const result = await persistence.get('foo', 'auth', daadmin);
    assert.equal(result, 'content');
  });

  it('Test persistence get 404', async () => {
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      assert.equal(url, 'foo');
      assert.equal(opts.method, undefined);
      assert.equal(opts.headers.get('authorization'), 'auth');
      return {
        ok: false, text: async () => { throw new Error(); }, status: 404, statusText: 'Not Found',
      };
    };
    try {
      await persistence.get('foo', 'auth', daadmin);
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert(error.toString().includes('unable to get resource - status: 404'));
    }
  });

  it('Test persistence get throws', async () => {
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      assert.equal(url, 'foo');
      assert.equal(opts.method, undefined);
      assert.equal(opts.headers.get('authorization'), 'auth');
      return {
        ok: false, text: async () => { throw new Error(); }, status: 500, statusText: 'Error',
      };
    };
    try {
      await persistence.get('foo', 'auth', daadmin);
      assert.fail('Expected get to throw');
    } catch (error) {
      // expected
      assert(error.toString().includes('unable to get resource - status: 500'));
    }
  });

  it('Test persistence put ok', async () => {
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      assert.equal(url, 'foo');
      assert.equal(opts.method, 'PUT');
      assert.equal(opts.headers.get('If-Match'), '*', 'Should include If-Match: * header');
      assert.equal(await opts.body.get('data').text(), 'test');
      return { ok: true, status: 200, statusText: 'OK - Stored' };
    };
    const conns = new Map();
    // conns.set({}, new Set());
    const result = await persistence.put({ name: 'foo', conns, daadmin }, 'test');
    assert(result.ok);
    assert.equal(result.status, 200);
    assert.equal(result.statusText, 'OK - Stored');
  });

  it('Test persistence put ok with auth', async () => {
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      assert.equal(url, 'foo');
      assert.equal(opts.method, 'PUT');
      assert.equal('myauth', opts.headers.get('Authorization'));
      assert.equal('collab', opts.headers.get('X-DA-Initiator'));
      assert.equal('*', opts.headers.get('If-Match'));
      assert.equal(await opts.body.get('data').text(), 'test');
      return { ok: true, status: 200, statusText: 'OK - Stored too' };
    };
    const conns = new Map();
    conns.set({ auth: 'myauth' }, new Set());
    const result = await persistence.put({ name: 'foo', conns, daadmin }, 'test');
    assert(result.ok);
    assert.equal(result.status, 200);
    assert.equal(result.statusText, 'OK - Stored too');
  });

  it('Test persistence readonly does not put but is ok', async () => {
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      assert.equal(url, 'foo');
      assert.equal(opts.method, 'PUT');
      assert.equal(opts.headers.get('If-Match'), '*');
      assert.equal(await opts.body.get('data').text(), 'test');
      return { ok: true, status: 200, statusText: 'OK' };
    };
    const result = await persistence.put({ name: 'foo', conns: new Map(), daadmin }, 'test');
    assert(result.ok);
  });

  it('Test persistence put auth', async () => {
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      assert.equal(url, 'foo');
      assert.equal(opts.method, 'PUT');
      assert.equal(opts.headers.get('authorization'), 'auth');
      assert.equal(opts.headers.get('X-DA-Initiator'), 'collab');
      assert.equal(opts.headers.get('If-Match'), '*');
      assert.equal(await opts.body.get('data').text(), 'test');
      return { ok: true, status: 200, statusText: 'okidoki' };
    };
    const result = await persistence.put({
      name: 'foo',
      conns: new Map().set({ auth: 'auth', authActions: ['read', 'write'] }, new Set()),
      daadmin,
    }, 'test');
    assert(result.ok);
    assert.equal(result.status, 200);
    assert.equal(result.statusText, 'okidoki');
  });

  it('Test persistence put auth no perm', async () => {
    const fetchCalled = [];
    const daadmin = {};
    daadmin.fetch = async (url, opts) => {
      fetchCalled.push('true');
    };
    const result = await persistence.put({
      name: 'bar',
      conns: new Map().set({ auth: 'auth', readOnly: true }, new Set()),
      daadmin,
    }, 'toast');
    assert(result.ok);
    assert.equal(fetchCalled.length, 0, 'Should not have called fetch');
  });

  it('Test persistence update does not put if no change', async () => {
    const mockDoc2Aem = () => 'Svr content';
    const pss = await esmock('../src/shareddoc.js', {
      '@da-tools/da-parser': {
        doc2aem: mockDoc2Aem,
      },
    });

    pss.persistence.put = async (ydoc, content) => {
      assert.fail('update should not have happend');
    };

    const mockYDoc = {
      conns: { keys() { return [{}]; } },
      name: 'http://foo.bar/0/123.html',
    };

    pss.persistence.put = async (ydoc, content) => {
      assert.fail('update should not have happend');
    };

    const result = await pss.persistence.update(mockYDoc, 'Svr content', 'test.html');
    assert.equal(result, 'Svr content');
  });

  it('Test persistence update does put if change', async () => {
    const mockDoc2Aem = () => 'Svr content update';
    const pss = await esmock('../src/shareddoc.js', {
      '@da-tools/da-parser': {
        doc2aem: mockDoc2Aem,
      },
    });

    const mockYDoc = {
      conns: { keys() { return [{}]; } },
      name: 'http://foo.bar/0/123.html',
    };

    let called = false;
    pss.persistence.put = async (ydoc, content) => {
      assert.equal(ydoc, mockYDoc);
      assert.equal(content, 'Svr content update');
      called = true;
      return { ok: true, status: 201, statusText: 'Created' };
    };

    let calledCloseCon = false;
    pss.persistence.closeConn = (doc, conn) => {
      calledCloseCon = true;
    };

    const result = await pss.persistence.update(mockYDoc, 'Svr content', 'test.html');
    assert.equal(result, 'Svr content update');
    assert(called);
    assert(!calledCloseCon);
  });

  async function testCloseAllOnAuthFailure(httpError) {
    const mockDoc2Aem = () => 'Svr content update';
    const pss = await esmock('../src/shareddoc.js', {
      '@da-tools/da-parser': {
        doc2aem: mockDoc2Aem,
      },
    });

    const mockYDoc = {
      conns: new Map().set('foo', 'bar'),
      name: 'http://foo.bar/0/123.html',
      getMap(nm) { return nm === 'error' ? new Map() : null; },
      transact: (f) => f(),
    };

    let called = false;
    pss.persistence.put = async (ydoc, content) => {
      assert.equal(ydoc, mockYDoc);
      assert.equal(content, 'Svr content update');
      called = true;
      return { ok: false, status: httpError, statusText: 'Unauthorized' };
    };

    let calledCloseCon = false;
    pss.persistence.closeConn = (doc, conn) => {
      assert.equal(doc, mockYDoc);
      assert.equal(conn, 'foo');
      calledCloseCon = true;
    };

    const result = await pss.persistence.update(mockYDoc, 'Svr content', 'test.html');
    assert.equal(result, 'Svr content');
    assert(called);
    assert(calledCloseCon);
  }

  it('Test persistence update closes all on auth failure', async () => {
    await testCloseAllOnAuthFailure(401);
    await testCloseAllOnAuthFailure(403);
  });

  it('Test persistence update closes all and cleans storage on 412', async () => {
    const docName = 'https://admin.da.live/source/foo.html';
    const ydoc = new WSSharedDoc(docName);

    const storageDeleteAllCalled = [];
    ydoc.storage = {
      deleteAll: async () => storageDeleteAllCalled.push('deleteAll'),
    };

    const closeCalled = [];
    const conn1 = { close: () => closeCalled.push('close1'), readOnly: false };
    const conn2 = { close: () => closeCalled.push('close2'), readOnly: false };
    ydoc.conns.set(conn1, new Set(['client1']));
    ydoc.conns.set(conn2, new Set(['client2']));

    // Register the doc in the global map
    const docs = setYDoc(docName, ydoc);
    assert(docs.has(docName), 'Precondition: doc should be in global map');

    ydoc.daadmin = {
      fetch: async () => ({ ok: false, status: 412, statusText: 'Precondition Failed' }),
    };

    aem2doc('<main><div><p>test content</p></div></main>', ydoc);

    const result = await persistence.update(ydoc, '<main><div><p>old content</p></div></main>', 'test.html');

    // Should have cleaned storage
    assert.equal(storageDeleteAllCalled.length, 1, 'Should have called storage.deleteAll');

    // Should have closed all connections
    assert.equal(closeCalled.length, 2, 'Should have closed both connections');

    // Connections should be removed from ydoc.conns
    assert.equal(ydoc.conns.size, 0, 'All connections should be removed from ydoc.conns');

    // Doc should be removed from global docs map when last connection closes
    assert(!docs.has(docName), 'Doc should be removed from global docs map');

    // Should return the original content (update failed)
    assert.equal(result, '<main><div><p>old content</p></div></main>');
  });

  it('Test 412 cleanup allows fresh connection attempt', async () => {
    const docName = 'https://admin.da.live/source/bar.html';

    // First connection and 412 scenario
    const ydoc = new WSSharedDoc(docName);
    ydoc.storage = {
      deleteAll: async () => {},
    };

    const conn1 = { close: () => {}, readOnly: false };
    ydoc.conns.set(conn1, new Set(['client1']));

    const docs = setYDoc(docName, ydoc);
    assert(docs.has(docName), 'Precondition');

    ydoc.daadmin = {
      fetch: async () => ({ ok: false, status: 412, statusText: 'Precondition Failed' }),
    };

    aem2doc('<main><div><p>content</p></div></main>', ydoc);

    // Trigger 412 - should close all connections and remove from global map
    await persistence.update(ydoc, '<main><div><p>old</p></div></main>', 'test.html');

    assert.equal(ydoc.conns.size, 0, 'All connections should be closed');
    assert(!docs.has(docName), 'Doc should be removed from global map after last connection closes');

    // Now simulate a fresh connection attempt
    // This should create a NEW ydoc since the old one was removed from the global map
    const conn2 = { close: () => {}, readOnly: false };
    const newYdoc = docs.get(docName);
    assert.equal(newYdoc, undefined, 'Old ydoc should not be in map');
  });

  it('Test ydoc error map is set on 412', async () => {
    const docName = 'https://admin.da.live/source/baz.html';
    const ydoc = new WSSharedDoc(docName);
    ydoc.storage = { deleteAll: async () => {} };

    const conn1 = { close: () => {}, readOnly: false };
    ydoc.conns.set(conn1, new Set());
    setYDoc(docName, ydoc);

    ydoc.daadmin = {
      fetch: async () => ({ ok: false, status: 412, statusText: 'Precondition Failed' }),
    };

    aem2doc('<main><div><p>content</p></div></main>', ydoc);

    // Before 412, error map should be empty
    const errorMap = ydoc.getMap('error');
    assert.equal(errorMap.size, 0, 'Precondition: error map should be empty');

    await persistence.update(ydoc, '<main><div><p>old</p></div></main>', 'test.html');

    // After 412, error map should contain error details
    assert(errorMap.size > 0, 'Error map should have entries');
    assert(errorMap.has('timestamp'), 'Should have timestamp');
    assert(errorMap.has('message'), 'Should have message');
    assert(!errorMap.has('stack'), 'Should not have stack');
    assert(errorMap.get('message').includes('412'), 'Error message should mention 412');
  });

  it('Test update handlers stop after 412 cleanup', async () => {
    const mockdebounce = (f) => {
      const debounced = async () => f();
      debounced.cancel = () => {};
      return debounced;
    };
    const pss = await esmock('../src/shareddoc.js', {
      'lodash/debounce.js': {
        default: mockdebounce,
      },
    });

    const docName = 'https://admin.da.live/source/qux.html';
    const ydoc = new pss.WSSharedDoc(docName);
    ydoc.storage = { deleteAll: async () => {} };

    const conn1 = { close: () => {}, readOnly: false };
    ydoc.conns.set(conn1, new Set());

    const docs = pss.setYDoc(docName, ydoc);
    assert(docs.has(docName), 'Precondition');

    // Mock da-admin to return 412
    ydoc.daadmin = {
      fetch: async () => ({ ok: false, status: 412, statusText: 'Precondition Failed' }),
    };

    const updateHandlers = [];
    const originalOn = ydoc.on.bind(ydoc);
    ydoc.on = (event, handler) => {
      if (event === 'update') {
        updateHandlers.push(handler);
      }
      return originalOn(event, handler);
    };

    // Set up bindState which registers update handlers
    const storage = {
      list: async () => new Map(),
      deleteAll: async () => {},
      put: async () => {},
    };
    pss.persistence.get = async () => '<main><div><p>initial</p></div></main>';

    await pss.persistence.bindState(docName, ydoc, conn1, storage);

    assert.equal(updateHandlers.length, 2, 'Should have two update handlers registered');

    // Modify document
    aem2doc('<main><div><p>modified</p></div></main>', ydoc);

    // Trigger 412 which closes all connections and removes from global map
    await pss.persistence.update(ydoc, '<main><div><p>initial</p></div></main>', 'test.html');

    assert(!docs.has(docName), 'Doc should be removed from global map');

    // Now try to call the update handlers -
    // they should not execute because ydoc is no longer in global map
    const putCalls = [];
    pss.persistence.put = async () => {
      putCalls.push('put');
      return { ok: true };
    };

    // Simulate another update after 412
    aem2doc('<main><div><p>another change</p></div></main>', ydoc);

    // Call the debounced update handler
    if (updateHandlers[1]) {
      await updateHandlers[1]();
    }

    // Put should NOT have been called because ydoc is not in global map anymore
    assert.equal(putCalls.length, 0, 'PUT should not be called after doc removed from global map');
  });

  it('Test 412 closes all clients including readonly', async () => {
    const docName = 'https://admin.da.live/source/multi.html';
    const ydoc = new WSSharedDoc(docName);
    ydoc.storage = { deleteAll: async () => {} };

    const closeCalled = [];
    const conn1 = { close: () => closeCalled.push('conn1'), readOnly: false, auth: 'auth1' };
    const conn2 = { close: () => closeCalled.push('conn2'), readOnly: false, auth: 'auth2' };
    const conn3 = { close: () => closeCalled.push('conn3'), readOnly: true, auth: 'auth3' };

    ydoc.conns.set(conn1, new Set(['client1']));
    ydoc.conns.set(conn2, new Set(['client2']));
    ydoc.conns.set(conn3, new Set(['client3']));

    const docs = setYDoc(docName, ydoc);

    ydoc.daadmin = {
      fetch: async () => ({ ok: false, status: 412, statusText: 'Precondition Failed' }),
    };

    aem2doc('<main><div><p>content</p></div></main>', ydoc);

    await persistence.update(ydoc, '<main><div><p>old</p></div></main>', 'test.html');

    // All connections should be closed (including readonly)
    assert.equal(closeCalled.length, 3, 'Should have closed all 3 connections');
    assert(closeCalled.includes('conn1'), 'Should close conn1');
    assert(closeCalled.includes('conn2'), 'Should close conn2');
    assert(closeCalled.includes('conn3'), 'Should close readonly conn3');

    // All connections removed from ydoc
    assert.equal(ydoc.conns.size, 0, 'All connections should be removed');

    // Doc removed from global map
    assert(!docs.has(docName), 'Doc should be removed from global map');
  });

  it('Test invalidateFromAdmin', async () => {
    const docName = 'http://blah.di.blah/a/ha.html';

    const closeCalled = [];
    const conn1 = { close: () => closeCalled.push('close1') };
    const conn2 = { close: () => closeCalled.push('close2') };
    const conns = new Map();
    conns.set(conn1, new Set());
    conns.set(conn2, new Set());

    const testYDoc = new WSSharedDoc(docName);
    testYDoc.conns = conns;

    const m = setYDoc(docName, testYDoc);

    assert(m.has(docName), 'Precondition');
    invalidateFromAdmin(docName);
    assert(!m.has(docName), 'Document should have been removed from global map');

    const res1 = ['close1', 'close2'];
    const res2 = ['close2', 'close1'];
    assert(res1.toString() === closeCalled.toString()
      || res2.toString() === closeCalled.toString());
  });

  it('Test close connection', async () => {
    const awarenessEmitted = [];
    const mockDoc = {
      destroyed: false,
      awareness: {
        emit(_, chg) { awarenessEmitted.push(chg); },
        name: 'http://foo.bar/q/r.html',
        states: new Map(),
      },
      conns: new Map(),
      destroy() {
        this.destroyed = true;
      },
    };
    mockDoc.awareness.states.set('123', null);
    const docs = setYDoc(mockDoc.name, mockDoc);

    const called = [];
    const mockConn = {
      close() { called.push('close'); },
    };
    const ids = new Set();
    ids.add('123');
    mockDoc.conns.set(mockConn, ids);

    assert.equal(0, called.length, 'Precondition');
    assert(docs.get(mockDoc.name), 'Precondition');
    closeConn(mockDoc, mockConn);
    assert.deepStrictEqual(['close'], called);
    assert.equal(0, mockDoc.conns.size);
    assert.deepStrictEqual(
      ['123'],
      awarenessEmitted[0][0].removed,
      'removeAwarenessStates should be called',
    );

    assert.equal(
      docs.get(mockDoc.name),
      undefined,
      'Document should be removed from global map',
    );

    assert(docs.get(mockDoc.name) === undefined, 'Should have been removed from docs map');
    assert(mockDoc.destroyed, true, 'Should have been destroyed.');
  });

  it('Test close unknown connection', async () => {
    const mockDoc = {
      conns: new Map(),
    };

    const called = [];
    const mockConn = {
      close() { called.push('close'); },
    };

    assert.equal(0, called.length, 'Precondition');
    closeConn(mockDoc, mockConn);
    assert.deepStrictEqual(['close'], called);
  });

  it('Test bindState read from da-admin', async () => {
    const aem2DocCalled = [];
    const mockAem2Doc = (sc, yd) => aem2DocCalled.push(sc, yd);
    const pss = await esmock('../src/shareddoc.js', {
      '@da-tools/da-parser': {
        aem2doc: mockAem2Doc,
      },
    });

    const docName = 'http://lalala.com/ha/ha/ha.html';
    const testYDoc = new Y.Doc();
    testYDoc.daadmin = 'daadmin';
    const mockConn = {
      auth: 'myauth',
      authActions: ['read'],
    };
    pss.setYDoc(docName, testYDoc);

    const mockStorage = { list: () => new Map() };

    pss.persistence.get = async (nm, au, ad) => `Get: ${nm}-${au}-${ad}`;
    const updated = new Map();
    pss.persistence.update = async (d, v) => updated.set(d, v);

    assert.equal(0, updated.size, 'Precondition');
    await pss.persistence.bindState(docName, testYDoc, mockConn, mockStorage);

    assert.equal(0, aem2DocCalled.length, 'Precondition, it\'s important to handle the doc setting async');

    // give the async methods a change to finish
    await wait(1500);

    assert.equal(2, aem2DocCalled.length);
    assert.equal('Get: http://lalala.com/ha/ha/ha.html-myauth-daadmin', aem2DocCalled[0]);
    assert.equal(testYDoc, aem2DocCalled[1]);
  });

  it('Test bindstate read from worker storage', async () => {
    const docName = 'https://admin.da.live/source/foo/bar.html';

    // Prepare the (mocked) storage
    const testDoc = new Y.Doc();
    testDoc.getMap('foo').set('someattr', 'somevalue');
    const storedYDoc = Y.encodeStateAsUpdate(testDoc);
    const stored = new Map();
    stored.set('docstore', storedYDoc);
    stored.set('doc', docName);

    // Create a new YDoc which will be initialised from storage
    const ydoc = new Y.Doc();
    const conn = {};
    const storage = { list: async () => stored };

    const savedGet = persistence.get;
    try {
      // eslint-disable-next-line consistent-return
      persistence.get = (d) => {
        if (d === docName) {
          return `
<body>
  <header></header>
  <main><div></div></main>
  <footer></footer>
</body>
`;
        }
      };

      await persistence.bindState(docName, ydoc, conn, storage);

      assert.equal('somevalue', ydoc.getMap('foo').get('someattr'));
    } finally {
      persistence.get = savedGet;
    }
  });

  it('Test bindstate falls back to daadmin on worker storage error', async () => {
    const docName = 'https://admin.da.live/source/foo/bar.html';
    const ydoc = new Y.Doc();
    setYDoc(docName, ydoc);

    const storage = {
      list: async () => {
        throw new Error('yikes');
      },
    };

    const savedGet = persistence.get;
    const savedSetTimeout = globalThis.setTimeout;
    try {
      let timeoutPromise;
      globalThis.setTimeout = (f) => {
        timeoutPromise = f();
      }; // run timeout method instantly

      persistence.get = async () => `
        <body>
        <header></header>
        <main><div>From daadmin</div></main>
        <footer></footer>
        </body>`;
      await persistence.bindState(docName, ydoc, {}, storage);
      await timeoutPromise; // wait for async callback to complete

      assert(doc2aem(ydoc).includes('<div><p>From daadmin</p></div>'));
    } finally {
      persistence.get = savedGet;
      globalThis.setTimeout = savedSetTimeout;
    }
  });

  it('test persistence update on storage update', async () => {
    const mockdebounce = (f) => async () => f();
    const pss = await esmock('../src/shareddoc.js', {
      'lodash/debounce.js': {
        default: mockdebounce,
      },
    });

    const docName = 'https://admin.da.live/source/foo/bar.html';
    const storage = { list: async () => new Map() };
    const updObservers = [];
    const ydoc = new Y.Doc();
    ydoc.on = (ev, fun) => {
      if (ev === 'update') {
        updObservers.push(fun);
      }
    };
    pss.setYDoc(docName, ydoc);

    const savedSetTimeout = globalThis.setTimeout;
    const savedGet = pss.persistence.get;
    const savedPut = pss.persistence.put;
    try {
      globalThis.setTimeout = (f) => {
        // Restore the global function
        globalThis.setTimeout = savedSetTimeout;
        f();
      };

      pss.persistence.get = async () => '<main><div>oldcontent</div></main>';
      const putCalls = [];
      // eslint-disable-next-line consistent-return
      pss.persistence.put = async (yd, c) => {
        if (yd === ydoc && c.includes('newcontent')) {
          putCalls.push(c);
          return { ok: true, status: 200 };
        }
      };

      await pss.persistence.bindState(docName, ydoc, {}, storage);

      aem2doc('<main><div>newcontent</div></main>', ydoc);

      assert.equal(2, updObservers.length);
      await updObservers[0]();
      await updObservers[1]();
      assert.equal(1, putCalls.length);
      assert.equal(`<body>
  <header></header>
  <main><div><p>newcontent</p></div></main>
  <footer></footer>
</body>`, putCalls[0].trim());
    } finally {
      globalThis.setTimeout = savedSetTimeout;
      pss.persistence.get = savedGet;
      pss.persistence.put = savedPut;
    }
  });

  it('test persist state in worker storage on update', async () => {
    const docName = 'https://admin.da.live/source/foo/bar.html';

    const updObservers = [];
    const ydoc = new Y.Doc();
    // mock out the 'on' function on the ydoc
    ydoc.on = (ev, fun) => {
      if (ev === 'update') {
        updObservers.push(fun);
      }
    };
    setYDoc(docName, ydoc);

    const conn = {};
    const called = [];
    const storage = {
      deleteAll: async () => called.push('deleteAll'),
      list: async () => new Map(),
      put: async (obj) => called.push(obj),
    };

    const savedSetTimeout = globalThis.setTimeout;
    const savedGet = persistence.get;
    try {
      let timeoutPromise;
      globalThis.setTimeout = (f) => {
        // Restore the global function
        globalThis.setTimeout = savedSetTimeout;
        timeoutPromise = f();
      };
      persistence.get = async () => '<main><div>myinitial</div></main>';

      await persistence.bindState(docName, ydoc, conn, storage);
      await timeoutPromise; // wait for async callback to complete
      assert(doc2aem(ydoc).includes('myinitial'));
      assert.equal(2, updObservers.length);

      ydoc.getMap('yah').set('a', 'bcd');
      await updObservers[0]();
      await updObservers[1]();

      // check that it was stored
      assert.equal(2, called.length);
      assert.equal('deleteAll', called[0]);

      const ydoc2 = new Y.Doc();
      Y.applyUpdate(ydoc2, called[1].docstore);

      assert.equal('bcd', ydoc2.getMap('yah').get('a'));
      assert(doc2aem(ydoc2).includes('myinitial'));
    } finally {
      globalThis.setTimeout = savedSetTimeout;
      persistence.get = savedGet;
    }
  });

  it('Test getYDoc', async () => {
    const savedBS = persistence.bindState;

    try {
      const bsCalls = [];
      persistence.bindState = async (dn, d, c) => {
        bsCalls.push({ dn, d, c });
      };

      const docName = 'http://www.acme.org/somedoc.html';
      const mockConn = {};

      assert.equal(0, bsCalls.length, 'Precondition');
      const doc = await getYDoc(docName, mockConn, {}, {});
      assert.equal(1, bsCalls.length);
      assert.equal(bsCalls[0].dn, docName);
      assert.equal(bsCalls[0].d, doc);
      assert.equal(bsCalls[0].c, mockConn);

      const daadmin = { foo: 'bar' };
      const env = { daadmin };
      const doc2 = await getYDoc(docName, mockConn, env, {});
      assert.equal(1, bsCalls.length, 'Should not have called bindstate again');
      assert.equal(doc, doc2);
      assert.equal('bar', doc.daadmin.foo, 'Should have bound daadmin now');
    } finally {
      persistence.bindState = savedBS;
    }
  });

  it('Test WSSharedDoc', () => {
    const doc = new WSSharedDoc('hello');
    assert.equal(doc.name, 'hello');
    assert.equal(doc.awareness.getLocalState(), null);

    const conn = {
      isClosed: false,
      message: null,
      readyState: 1, // wsReadyStateOpen
      has() {
        return true;
      },
      close() {
        this.isClosed = true;
      },
      send(m) {
        this.message = m;
      },
    };

    doc.conns.set(conn, 'conn1');
    doc.awareness.setLocalState('foo');
    assert(conn.isClosed === false);
    const fooAsUint8Arr = new Uint8Array(getAsciiChars('foo'));
    assert(isSubArray(conn.message, fooAsUint8Arr));
  });

  it('Test WSSharedDoc awarenessHandler', () => {
    const docName = 'http://a.b.c/d.html';

    const doc = new WSSharedDoc(docName);
    doc.awareness.setLocalState('barrr');

    assert.deepStrictEqual([updateHandler], Array.from(doc._observers.get('update')));
    const ah = Array.from(doc.awareness._observers.get('update'));
    assert.equal(1, ah.length);

    assert.equal(0, doc.conns.size, 'Should not yet be any connections');

    const sentMessages = [];
    const mockConn = {
      readyState: 1, // wsReadyStateOpen
      send(m, e) { sentMessages.push({ m, e }); },
    };
    doc.conns.set(mockConn, new Set());

    ah[0]({ added: [], updated: [doc.clientID], removed: [] }, mockConn);

    const barrAsUint8Arr = new Uint8Array(getAsciiChars('barrr'));
    assert(isSubArray(sentMessages[0].m, barrAsUint8Arr));
  });

  it('Test setupWSConnection', async () => {
    const savedBind = persistence.bindState;

    try {
      const bindCalls = [];
      persistence.bindState = async (nm, d, c, s) => {
        bindCalls.push({
          nm, d, c, s,
        });
        return new Map();
      };

      const docName = 'https://somewhere.com/somedoc.html';
      const eventListeners = new Map();
      const closeCalls = [];
      const mockConn = {
        addEventListener(msg, fun) { eventListeners.set(msg, fun); },
        close() { closeCalls.push('close'); },
        readyState: 1, // wsReadyStateOpen
        send() {},
      };

      const daadmin = { a: 'b' };
      const env = { daadmin };
      const storage = { foo: 'bar' };

      assert.equal(0, bindCalls.length, 'Precondition');
      assert.equal(0, eventListeners.size, 'Precondition');
      await setupWSConnection(mockConn, docName, env, storage);

      assert.equal('arraybuffer', mockConn.binaryType);
      assert.equal(1, bindCalls.length);
      assert.equal(docName, bindCalls[0].nm);
      assert.equal(docName, bindCalls[0].d.name);
      assert.equal('b', bindCalls[0].d.daadmin.a);
      assert.equal(mockConn, bindCalls[0].c);
      assert.deepStrictEqual(storage, bindCalls[0].s);

      const closeLsnr = eventListeners.get('close');
      assert(closeLsnr);
      const messageLsnr = eventListeners.get('message');
      assert(messageLsnr);

      assert.equal(0, closeCalls.length, 'Should not yet have recorded any close calls');
      closeLsnr();
      assert.deepStrictEqual(['close'], closeCalls);
    } finally {
      persistence.bindState = savedBind;
    }
  });

  it('Test setupWSConnection sync step 1', async () => {
    const savedBind = persistence.bindState;

    try {
      persistence.bindState = async (nm, d, c, s) => new Map();

      const docName = 'https://somewhere.com/myotherdoc.html';
      const closeCalls = [];
      const sendCalls = [];
      const mockConn = {
        addEventListener() {},
        close() { closeCalls.push('close'); },
        readyState: 1, // wsReadyStateOpen
        send(m, e) { sendCalls.push({ m, e }); },
      };

      const awarenessStates = new Map();
      awarenessStates.set('foo', 'blahblahblah');
      const awareness = {
        getStates: () => awarenessStates,
        meta: awarenessStates,
        states: awarenessStates,
      };

      const ydoc = await getYDoc(docName, mockConn, {}, {}, true);
      ydoc.awareness = awareness;

      await setupWSConnection(mockConn, docName, {}, {});

      assert.equal(0, closeCalls.length);
      assert.equal(2, sendCalls.length);
      assert.deepStrictEqual([0, 0, 1, 0], Array.from(sendCalls[0].m));
      assert(isSubArray(sendCalls[1].m, getAsciiChars('blahblahblah')));
    } finally {
      persistence.bindState = savedBind;
    }
  });

  it('Test Sync Step1', () => {
    const connSent = [];
    const conn = {
      readyState: 0, // wsReadyState
      send(m, r) { connSent.push({ m, r }); },
    };

    const emitted = [];
    const doc = new Y.Doc();
    doc.emit = (t, e) => emitted.push({ t, e });
    doc.getMap('foo').set('bar', 'hello');

    const message = [0, 0, 1, 0];

    messageListener(conn, doc, new Uint8Array(message));
    assert.equal(1, connSent.length);
    assert(isSubArray(connSent[0].m, new Uint8Array(getAsciiChars('hello'))));

    for (let i = 0; i < emitted.length; i += 1) {
      assert(emitted[i].t !== 'error');
    }
  });

  it('Test Sync Step1 readonly connection', () => {
    const connSent = [];
    const conn = {
      readyState: 0, // wsReadyState
      send(m, r) { connSent.push({ m, r }); },
      readOnly: true,
    };

    const emitted = [];
    const doc = new Y.Doc();
    doc.emit = (t, e) => emitted.push({ t, e });
    doc.getMap('foo').set('bar', 'hello');

    const message = [0, 0, 1, 0];

    messageListener(conn, doc, new Uint8Array(message));
    assert.equal(1, connSent.length, 'Readonly connection should still call sync step 1');
    assert(isSubArray(connSent[0].m, new Uint8Array(getAsciiChars('hello'))));

    for (let i = 0; i < emitted.length; i += 1) {
      assert(emitted[i].t !== 'error');
    }
  });

  const testSyncStep2 = async (doc, readonly) => {
    const ss2Called = [];
    // eslint-disable-next-line no-shadow
    const mockSS2 = (dec, doc) => {
      ss2Called.push({ dec, doc });
    };

    const shd = await esmock('../src/shareddoc.js', {
      '@da-tools/da-parser': {
        aem2doc,
        doc2aem,
      },
      'y-protocols/sync.js': {
        messageYjsSyncStep1: 0,
        messageYjsSyncStep2: 1,
        messageYjsUpdate: 2,
        readSyncStep1: () => {},
        readSyncStep2: mockSS2,
        readUpdate: () => {},
        writeSyncStep1: () => {},
        writeUpdate: () => {},
      },
    });

    const conn = {};
    if (readonly) {
      conn.readOnly = true;
    }

    const message = [0, 1, 1, 0];

    assert.equal(ss2Called.length, 0, 'Precondition');
    shd.messageListener(conn, doc, new Uint8Array(message));
    return ss2Called;
  };

  it('Test Sync Step2', async () => {
    const doc = new Y.Doc();
    const ss2Called = await testSyncStep2(doc, false);
    assert.equal(ss2Called.length, 1);
    assert(ss2Called[0].dec);
    assert(ss2Called[0].doc === doc);
  });

  it('Test Sync Step2 readonly connection', async () => {
    const doc = new Y.Doc();
    const ss2Called = await testSyncStep2(doc, true);
    assert.equal(ss2Called.length, 0, 'Sync step 2 should not be called for a readonly connection');
  });

  const testYjsUpdate = async (doc, readonly) => {
    const updCalled = [];
    // eslint-disable-next-line no-shadow
    const mockUpd = (dec, doc) => {
      updCalled.push({ dec, doc });
    };

    const shd = await esmock('../src/shareddoc.js', {
      '@da-tools/da-parser': {
        aem2doc,
        doc2aem,
      },
      'y-protocols/sync.js': {
        messageYjsSyncStep1: 0,
        messageYjsSyncStep2: 1,
        messageYjsUpdate: 2,
        readSyncStep1: () => {},
        readSyncStep2: () => {},
        readUpdate: mockUpd,
        writeSyncStep1: () => {},
        writeUpdate: () => {},
      },
    });

    const conn = {};
    if (readonly) {
      conn.readOnly = true;
    }

    const message = [0, 2, 1, 0];

    assert.equal(updCalled.length, 0, 'Precondition');
    shd.messageListener(conn, doc, new Uint8Array(message));
    return updCalled;
  };

  it('Test YJS Update', async () => {
    const doc = new Y.Doc();
    const updCalled = await testYjsUpdate(doc, false);
    assert.equal(updCalled.length, 1);
    assert(updCalled[0].dec);
    assert(updCalled[0].doc === doc);
  });

  it('Test YJS Update readonly connection', async () => {
    const doc = new Y.Doc();
    const updCalled = await testYjsUpdate(doc, true);
    assert.equal(updCalled.length, 0, 'YJS update should not be called for a readonly connection');
  });

  it('Test message listener awareness', () => {
    // A fabricated message
    const message = [
      1, 247, 1, 1, 187, 143, 251, 213, 14, 21, 238, 1, 123, 34, 99, 117, 114, 115, 111,
      114, 34, 58, 123, 34, 97, 110, 99, 104, 111, 114, 34, 58, 123, 34, 116, 121, 112,
      101, 34, 58, 123, 34, 99, 108, 105, 101, 110, 116, 34, 58, 51, 49, 51, 52, 57, 50,
      57, 54, 56, 55, 44, 34, 99, 108, 111, 99, 107, 34, 58, 49, 57, 125, 44, 34, 116,
      110, 97, 109, 101, 34, 58, 110, 117, 108, 108, 44, 34, 105, 116, 101, 109, 34, 58,
      123, 34, 99, 108, 105, 101, 110, 116, 34, 58, 51, 49, 51, 52, 57, 50, 57, 54, 56,
      55, 44, 34, 99, 108, 111, 99, 107, 34, 58, 50, 48, 125, 44, 34, 97, 115, 115, 111,
      99, 34, 58, 48, 125, 44, 34, 104, 101, 97, 100, 34, 58, 123, 34, 116, 121, 112,
      101, 34, 58, 123, 34, 99, 108, 105, 101, 110, 116, 34, 58, 51, 49, 51, 52, 57, 50,
      57, 54, 56, 55, 44, 34, 99, 108, 111, 99, 107, 34, 58, 49, 57, 125, 44, 34, 116,
      110, 97, 109, 101, 34, 58, 110, 117, 108, 108, 44, 34, 105, 116, 101, 109, 34, 58,
      123, 34, 99, 108, 105, 101, 110, 116, 34, 58, 51, 49, 51, 52, 57, 50, 57, 54, 56,
      55, 44, 34, 99, 108, 111, 99, 107, 34, 58, 50, 48, 125, 44, 34, 97, 115, 115, 111,
      99, 34, 58, 48, 125, 125, 125];

    const awarenessEmitted = [];
    const awareness = {
      emit(t, d) { awarenessEmitted.push({ t, d }); },
      meta: new Map(),
      states: new Map(),
    };

    const docEmitted = [];
    const doc = new Y.Doc();
    doc.awareness = awareness;
    doc.emit = (t, e) => docEmitted.push({ t, e });

    const conn = {};
    messageListener(conn, doc, new Uint8Array(message));

    assert(awarenessEmitted.length > 0);
    for (let i = 0; i < awarenessEmitted.length; i += 1) {
      assert(awarenessEmitted[i].t === 'change'
        || awarenessEmitted[i].t === 'update');
      assert.deepStrictEqual([3938371515], awarenessEmitted[i].d[0].added);
      assert.equal(awarenessEmitted[i].d[1], conn);
    }

    for (let i = 0; i < docEmitted.length; i += 1) {
      assert(docEmitted[i].t !== 'error');
    }
  });

  it('readState not chunked', async () => {
    const docName = 'http://foo.bar/doc123.html';
    const stored = new Map();
    stored.set('docstore', new Uint8Array([254, 255]));
    stored.set('chunks', 17); // should be ignored
    stored.set('doc', docName);

    const storage = { list: async () => stored };

    const data = await readState(docName, storage);
    assert.deepStrictEqual(new Uint8Array([254, 255]), data);
  });

  it('readState doc mismatch', async () => {
    const docName = 'http://foo.bar/doc123.html';
    const stored = new Map();
    stored.set('docstore', new Uint8Array([254, 255]));
    stored.set('chunks', 17); // should be ignored
    stored.set('doc', 'http://foo.bar/doc456.html');

    const storageCalled = [];
    const storage = {
      list: async () => stored,
      deleteAll: async () => storageCalled.push('deleteAll'),
    };

    const data = await readState(docName, storage);
    assert.equal(data, undefined);
    assert.deepStrictEqual(['deleteAll'], storageCalled);
  });

  it('readState chunked', async () => {
    const stored = new Map();
    stored.set('chunk_0', new Uint8Array([1, 2, 3]));
    stored.set('chunk_1', new Uint8Array([4, 5]));
    stored.set('chunks', 2);
    stored.set('doc', 'mydoc');

    const storage = { list: async () => stored };

    const data = await readState('mydoc', storage);
    assert.deepStrictEqual(new Uint8Array([1, 2, 3, 4, 5]), data);
  });

  it('storeState not chunked', async () => {
    const docName = 'https://some.where/far/away.html';
    const state = new Uint8Array([1, 2, 3, 4, 5]);

    const called = [];
    const storage = {
      deleteAll: async () => called.push('deleteAll'),
      put: (obj) => called.push(obj),
    };

    await storeState(docName, state, storage, 10);

    assert.equal(2, called.length);
    assert.equal('deleteAll', called[0]);
    assert.deepStrictEqual(state, called[1].docstore);
    assert.equal(docName, called[1].doc);
  });

  it('storeState chunked', async () => {
    const state = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const called = [];
    const storage = {
      deleteAll: async () => called.push('deleteAll'),
      put: (obj) => called.push(obj),
    };

    await storeState('somedoc', state, storage, 4);

    assert.equal(2, called.length);
    assert.equal('deleteAll', called[0]);
    assert.equal(3, called[1].chunks);
    assert.equal('somedoc', called[1].doc);
    assert.deepStrictEqual(new Uint8Array([1, 2, 3, 4]), called[1].chunk_0);
    assert.deepStrictEqual(new Uint8Array([5, 6, 7, 8]), called[1].chunk_1);
    assert.deepStrictEqual(new Uint8Array([9]), called[1].chunk_2);
  });

  it('Test showError', () => {
    const errorMap = new Map();
    const called = [];
    const mockYDoc = {
      sendStackTraces: true,
      getMap(nm) { return nm === 'error' ? errorMap : null; },
      transact(f) {
        called.push('transact');
        f();
      },
    };

    const error = new Error('foo');

    showError(mockYDoc, error);
    assert.equal('foo', errorMap.get('message'));
    assert(errorMap.get('timestamp') > 0);
    assert(
      errorMap.get('stack').includes('shareddoc.test.js'),
      'The stack trace should contain the name of this test file',
    );
    assert.deepStrictEqual(['transact'], called);
  });

  it('test no empty document if daadmin fetch crashes', async () => {
    const docName = 'https://admin.da.live/source/foo/bar.html';

    const updObservers = [];
    const ydoc = new Y.Doc();
    // mock out the 'on' function on the ydoc
    ydoc.on = (ev, fun) => {
      if (ev === 'update') {
        updObservers.push(fun);
      }
    };
    setYDoc(docName, ydoc);

    const conn = {};
    const called = [];
    const storage = {
      deleteAll: async () => called.push('deleteAll'),
      list: async () => new Map(),
      put: async (obj) => called.push(obj),
    };

    const savedSetTimeout = globalThis.setTimeout;
    const savedGet = persistence.get;
    try {
      let timeoutPromise;
      globalThis.setTimeout = (f) => {
        // Restore the global function
        globalThis.setTimeout = savedSetTimeout;
        timeoutPromise = f();
      };
      let calledGet = 0;
      persistence.get = async () => {
        // eslint-disable-next-line no-plusplus
        if (calledGet++ > 0) {
          throw new Error('unexpected crash');
        }
        return `
<body>
  <header></header>
  <main><div>initial</div></main>
  <footer></footer>
</body>
`;
      };

      await persistence.bindState(docName, ydoc, conn, storage);
      await timeoutPromise; // wait for async callback to complete
      // strip line breaks
      const doc2aemStr = doc2aem(ydoc).replace(/\n\s*/g, '');
      assert.notEqual(doc2aemStr, EMPTY_DOC);
      assert(doc2aemStr.includes('initial'), true);
      assert.equal(2, updObservers.length);

      ydoc.getMap('yah').set('a', 'bcd');
      await updObservers[0]();
      await updObservers[1]();

      // check that it was stored
      assert.equal(2, called.length);
      assert.equal('deleteAll', called[0]);

      const ydoc2 = new Y.Doc();
      Y.applyUpdate(ydoc2, called[1].docstore);

      assert.equal('bcd', ydoc2.getMap('yah').get('a'));
      const doc2aemStr2 = doc2aem(ydoc2).replace(/\n\s*/g, '');
      assert.notEqual(doc2aemStr2, EMPTY_DOC);
      assert(doc2aemStr2.includes('initial'), true);
    } finally {
      globalThis.setTimeout = savedSetTimeout;
      persistence.get = savedGet;
    }
  });
});
