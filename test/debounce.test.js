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
import assert from 'node:assert';
import { setTimeout as sleep } from 'node:timers/promises';
import debounce from '../src/debounce.js';

describe('debounce', () => {
  it('does not call fn immediately', async () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 50);
    fn();
    assert.strictEqual(calls, 0);
    await sleep(100);
    assert.strictEqual(calls, 1);
  });

  it('coalesces rapid calls into one invocation', async () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 80);
    fn();
    fn();
    fn();
    await sleep(150);
    assert.strictEqual(calls, 1);
  });

  it('passes the most recent arguments to fn', async () => {
    let received;
    const fn = debounce((...args) => {
      received = args;
    }, 50);
    fn(1);
    fn(2);
    fn(3);
    await sleep(100);
    assert.deepStrictEqual(received, [3]);
  });

  it('resets the timer on each call within the wait window', async () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 80);
    fn();
    await sleep(40);
    fn();
    await sleep(40);
    // only 40ms have elapsed since the second call — should not have fired yet
    assert.strictEqual(calls, 0);
    await sleep(60);
    assert.strictEqual(calls, 1);
  });

  it('cancel() prevents the pending call from firing', async () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 50);
    fn();
    fn.cancel();
    await sleep(100);
    assert.strictEqual(calls, 0);
  });

  it('can be called again after cancel()', async () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 50);
    fn();
    fn.cancel();
    fn();
    await sleep(100);
    assert.strictEqual(calls, 1);
  });

  describe('maxWait', () => {
    it('fires after maxWait even when calls keep resetting the debounce timer', async () => {
      let calls = 0;
      const fn = debounce(() => {
        calls += 1;
      }, 80, { maxWait: 120 });
      // call repeatedly every 50ms — each call resets the 80ms timer
      fn();
      await sleep(50);
      fn();
      await sleep(50);
      fn();
      // 100ms elapsed: maxWait (120ms) not yet reached, debounce timer reset
      assert.strictEqual(calls, 0);
      await sleep(40);
      // 140ms elapsed: maxWait exceeded — must have fired at least once
      assert.strictEqual(calls, 1);
    });

    it('does not double-fire when debounce and maxWait expire simultaneously', async () => {
      let calls = 0;
      const fn = debounce(() => {
        calls += 1;
      }, 50, { maxWait: 50 });
      fn();
      await sleep(150);
      assert.strictEqual(calls, 1);
    });

    it('fires again on next call after maxWait flush', async () => {
      let calls = 0;
      const fn = debounce(() => {
        calls += 1;
      }, 80, { maxWait: 100 });
      fn();
      await sleep(150); // first maxWait fires
      fn();
      await sleep(150); // second debounce fires
      assert.strictEqual(calls, 2);
    });
  });
});
