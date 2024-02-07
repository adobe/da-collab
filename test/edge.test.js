import assert from 'assert';
import { updateHandler } from '../src/edge.js';

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

    const fe = (func) => {
      func(null, conn);
    };

    const deleted = [];
    const conns = {
      forEach: fe,
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
      message: null,
      readyState: 42, // unknown code, causes to close
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
    assert.deepStrictEqual(update, conn1.message.slice(-4));
    assert.deepStrictEqual(update, conn2.message.slice(-4));
  });
});