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

/**
 * Regression tests for the invalidateFromAdmin race condition.
 *
 * Root cause (fixed): invalidateFromAdmin called closeConn via a non-awaited
 * forEach, so the function resolved before flushSave + docs.delete completed.
 * An editor reconnecting during that window grabbed the stale ydoc from `docs`
 * instead of creating a fresh one that fetches the updated da-admin content.
 *
 * Fix: await Promise.all over all closeConn calls so docs.delete is guaranteed
 * to complete before invalidateFromAdmin returns.
 */

import assert from 'node:assert';
import { invalidateFromAdmin, setYDoc, WSSharedDoc } from '../src/shareddoc.js';

const wait = (ms) => new Promise((r) => {
  setTimeout(r, ms);
});

describe('invalidateFromAdmin race condition', () => {
  it('1 editor: docs entry removed and flushSave complete before invalidateFromAdmin returns', async () => {
    const docName = 'https://admin.da.live/source/org/repo/one-editor.html';

    const ydoc = new WSSharedDoc(docName);
    const docs = setYDoc(docName, ydoc);

    const conn1 = { close() {} };
    ydoc.conns.set(conn1, new Set());

    let flushDone = false;
    ydoc.flushSave = async () => {
      await wait(50);
      flushDone = true;
    };

    await invalidateFromAdmin(docName);

    assert.equal(flushDone, true, 'flushSave must complete before invalidateFromAdmin returns');
    assert.equal(docs.get(docName), undefined, 'doc must be removed from docs before invalidateFromAdmin returns');
  });

  it('2 editors: no stale ydoc visible after invalidateFromAdmin — reconnect creates fresh ydoc', async () => {
    const docName = 'https://admin.da.live/source/org/repo/two-editors.html';

    const ydoc = new WSSharedDoc(docName);
    const docs = setYDoc(docName, ydoc);

    const conn1 = { close() {} };
    const conn2 = { close() {} };
    ydoc.conns.set(conn1, new Set());
    ydoc.conns.set(conn2, new Set());

    let flushDone = false;
    ydoc.flushSave = async () => {
      await wait(50);
      flushDone = true;
    };

    await invalidateFromAdmin(docName);

    // After await: flushSave done, doc gone — reconnecting editor gets undefined
    // from docs.get() and creates a fresh ydoc that fetches new content from da-admin
    assert.equal(flushDone, true, 'flushSave must complete before invalidateFromAdmin returns');
    assert.equal(docs.get(docName), undefined, 'stale ydoc must not be in docs — reconnect loads fresh content');
  });

  it('2 editors: reconnect immediately after invalidateFromAdmin finds no stale ydoc', async () => {
    const docName = 'https://admin.da.live/source/org/repo/immediate-reconnect.html';

    const ydoc = new WSSharedDoc(docName);
    const docs = setYDoc(docName, ydoc);

    const conn1 = { close() {} };
    const conn2 = { close() {} };
    ydoc.conns.set(conn1, new Set());
    ydoc.conns.set(conn2, new Set());

    ydoc.flushSave = async () => {
      await wait(50);
    };

    const invalidatePromise = invalidateFromAdmin(docName);

    // Simulate immediate reconnect attempt (before invalidation settled)
    // With the fix, this microtask sees no doc because invalidateFromAdmin
    // awaits all closeConns before returning — so the race window is closed.
    // We can't truly race in a test, but we can verify the promise contract:
    // by the time invalidateFromAdmin resolves, the map is already clean.
    await invalidatePromise;

    const docOnReconnect = docs.get(docName);
    assert.equal(docOnReconnect, undefined, 'docs is clean after await — reconnect gets fresh ydoc');
  });
});
