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
import assert from 'assert';
import * as Y from 'yjs';
import { readFileSync } from 'fs';
import { aem2doc, doc2aem, tableToBlock } from '../src/collab.js';

const collapseTagWhitespace = (str) => str.replace(/>\s+</g, '><');
const collapseWhitespace = (str) => collapseTagWhitespace(str.replace(/\s+/g, ' ')).trim();

describe('Parsing test suite', () => {
  it('rowspan support in nested table', async () => {
    let html = `
      <body>
      <header></header>
  <main>
    <div>
      <div class="table r1-primary-header c1-primary-header compact">
        <div>
          <div>
            <table>
              <thead>
                <tr>
                  <th>CONTRACT</th>
                  <th>Contract code</th>
                  <th>Summary</th>
                  <th>When the contract month becomes the spot month…</th>
                  <th>…these contract months are TAS-eligible</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td rowspan="6">GOLD FUTURES/MICRO GOLD FUTURES/ E-MINI GOLD FUTURES/1-OUNCE GOLD FUTURES</td>
                  <td rowspan="6">GCT/MGT/QOT/1OT</td>
                  <td rowspan="6">
                    <p>TAS transactions are permitted in the first, second, third, fourth and fifth active contract
                      months.</p>
                    <p>The active contract months are February, April, June, August, October, and December.</p>
                  </td>
                  <td>February</td>
                  <td>April, June, August, October, December</td>
                </tr>
                <tr>
                  <td>April</td>
                  <td>June, August, October, December, February</td>
                </tr>
                <tr>
                  <td>June</td>
                  <td>August, October, December, February, April</td>
                </tr>
                <tr>
                  <td>August</td>
                  <td>October. December, February, April, June</td>
                </tr>
                <tr>
                  <td>October</td>
                  <td>December, February, April, June, August</td>
                </tr>
                <tr>
                  <td>December</td>
                  <td>February, April, June, August October</td>
                </tr>
                <tr>
                  <td rowspan="5">SILVER FUTURES/MICRO SILVER FUTURES</td>
                  <td rowspan="5">SIT/MST</td>
                  <td rowspan="5">
                    <p>TAS transactions are permitted in the first, second, third, fourth, and fifth active contract
                      months.</p>
                    <p>The active contract months are March, May, July, September, and December.</p>
                  </td>
                  <td>March</td>
                  <td>May, July, September, December, March</td>
                </tr>
                <tr>
                  <td>May</td>
                  <td>July, September, December, March, May</td>
                </tr>
                <tr>
                  <td>July</td>
                  <td>September, December, March, May, July</td>
                </tr>
                <tr>
                  <td>September</td>
                  <td>December, March, May, July, September</td>
                </tr>
                <tr>
                  <td>December</td>
                  <td>March, May, July, September, December</td>
                </tr>
                <tr>
                  <td rowspan="4">PLATINUM FUTURES</td>
                  <td rowspan="4">PLT</td>
                  <td rowspan="4">
                    <p>TAS transactions are permitted in the first and second active contract months.</p>
                    <p>The active contract months are January, April, July, and October.</p>
                  </td>
                  <td>January</td>
                  <td>April, July</td>
                </tr>
                <tr>
                  <td>April</td>
                  <td>July, October</td>
                </tr>
                <tr>
                  <td>July</td>
                  <td>October, January</td>
                </tr>
                <tr>
                  <td>October</td>
                  <td>January, April</td>
                </tr>
                <tr>
                  <td rowspan="4">PALLADIUM FUTURES</td>
                  <td rowspan="4">PAT</td>
                  <td rowspan="4">
                    <p>TAS transactions are permitted in the first and second active contract months.</p>
                    <p>The active contract months are March, June, September, and December.</p>
                  </td>
                  <td>June</td>
                  <td>September, December</td>
                </tr>
                <tr>
                  <td>September</td>
                  <td>December, March</td>
                </tr>
                <tr>
                  <td>December</td>
                  <td>March, June</td>
                </tr>
                <tr>
                  <td>March</td>
                  <td>June, September</td>
                </tr>
                <tr>
                  <td rowspan="5">COPPER FUTURES/MICRO COPPER FUTURES</td>
                  <td rowspan="5">HGT/MHT</td>
                  <td rowspan="5">
                    <p>TAS transactions are permitted in the first, second, third, fourth, and fifth active contract
                      months.</p>
                    <p>The active contract months are March, May, July, September, and December.</p>
                    <p><strong>For Copper futures, TAS is also eligible in the spot month, known as TAS zero or TAS flat
                        (Code: HG0). Spot month TAS trades are only permitted at the settlement price.</strong></p>
                  </td>
                  <td>March</td>
                  <td>May, July, September, December, March</td>
                </tr>
                <tr>
                  <td>May</td>
                  <td>July, September, December, March, May</td>
                </tr>
                <tr>
                  <td>July</td>
                  <td>September, December, March, May, July</td>
                </tr>
                <tr>
                  <td>September</td>
                  <td>December, March, May, July, September</td>
                </tr>
                <tr>
                  <td>December</td>
                  <td>March, May, July, September, December</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>

      `;

    html = collapseWhitespace(html);
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    const expected = readFileSync('./test/mocks/expected-table.html', 'utf-8');
    assert.equal(collapseWhitespace(result), collapseWhitespace(expected));
  });

  it('handles lists with diff edits', async () => {
  let html = `
    <body>
      <header></header>
      <main>
        <div>
          <h1>List Test</h1>
          <ul>
            <da-diff-deleted data-mdast="ignore">
              <li>Item 3</li>
            </da-diff-deleted>
            <li da-diff-added="">
              <p>Item 3 - Modified</p>
              <p>Blah blah blah</p>
            </li>
            <li>No change here</li>
            <da-diff-deleted data-mdast="ignore">
              <li>Item 4</li>
            </da-diff-deleted>
            <li da-diff-added="">Item 5 - New</li>
          </ul>
          <p>Some text after the list</p>
        </div>
      </main>
      <footer></footer>
    </body>`;
  html = collapseWhitespace(html);
  const yDoc = new Y.Doc();
  aem2doc(html, yDoc);
  const result = doc2aem(yDoc);
  assert.equal(collapseWhitespace(result), collapseWhitespace(html));
  });

});
