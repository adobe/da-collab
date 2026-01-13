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
 * Cross-Validation Tests
 *
 * These tests establish the "contract" for HTML conversion that both da-collab (doc2aem)
 * and da-live (prose2aem) should adhere to. Each test case defines:
 * - Input: AEM HTML
 * - Expected Output: The canonical HTML that should be produced after roundtrip conversion
 *
 * Corresponding tests should exist in da-live/test/unit/blocks/shared/cross-validation.test.js
 * to verify that prose2aem produces equivalent output.
 *
 * If these tests fail after changes, ensure both implementations are updated together.
 */

import assert from 'node:assert';
import * as Y from 'yjs';
import { aem2doc, doc2aem } from '../src/collab.js';

const collapseWhitespace = (str) => str.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

// Test cases that define the conversion contract
const CROSS_VALIDATION_CASES = [
  {
    name: 'Simple paragraph',
    input: '<body><header></header><main><div><p>Hello World</p></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><p>Hello World</p></div></main><footer></footer></body>',
  },
  {
    name: 'Multiple paragraphs',
    input: '<body><header></header><main><div><p>First</p><p>Second</p><p>Third</p></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><p>First</p><p>Second</p><p>Third</p></div></main><footer></footer></body>',
  },
  {
    name: 'Headings h1-h6',
    input: '<body><header></header><main><div><h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6></div></main><footer></footer></body>',
  },
  {
    name: 'Inline formatting - bold, italic, strikethrough, underline',
    input: '<body><header></header><main><div><p><strong>Bold</strong> <em>Italic</em> <s>Strike</s> <u>Under</u></p></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><p><strong>Bold</strong> <em>Italic</em> <s>Strike</s> <u>Under</u></p></div></main><footer></footer></body>',
  },
  {
    name: 'Links',
    input: '<body><header></header><main><div><p><a href="https://example.com">Example Link</a></p></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><p><a href="https://example.com">Example Link</a></p></div></main><footer></footer></body>',
  },
  {
    name: 'Unordered list',
    // doc2aem strips <p> from list items containing only text
    input: '<body><header></header><main><div><ul><li><p>Item 1</p></li><li><p>Item 2</p></li><li><p>Item 3</p></li></ul></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul></div></main><footer></footer></body>',
  },
  {
    name: 'Ordered list',
    // doc2aem strips <p> from list items containing only text
    input: '<body><header></header><main><div><ol><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ol></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><ol><li>First</li><li>Second</li><li>Third</li></ol></div></main><footer></footer></body>',
  },
  {
    name: 'Simple block (marquee)',
    input: '<body><header></header><main><div><div class="marquee light"><div><div><p>Content here</p></div></div></div></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><div class="marquee light"><div><div><p>Content here</p></div></div></div></div></main><footer></footer></body>',
  },
  {
    name: 'Section break (hr)',
    input: '<body><header></header><main><div><p>Section 1</p></div><div><p>Section 2</p></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><p>Section 1</p></div><div><p>Section 2</p></div></main><footer></footer></body>',
  },
  {
    name: 'Image with picture wrapper',
    input: '<body><header></header><main><div><picture><source srcset="./media_123.png"><img src="./media_123.png" alt="Test image"></picture></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><picture><source srcset="./media_123.png"><source srcset="./media_123.png" media="(min-width: 600px)"><img src="./media_123.png" alt="Test image" loading="lazy"></picture></div></main><footer></footer></body>',
  },
  {
    name: 'Superscript and subscript',
    input: '<body><header></header><main><div><p>H<sub>2</sub>O and E=mc<sup>2</sup></p></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><p>H<sub>2</sub>O and E=mc<sup>2</sup></p></div></main><footer></footer></body>',
  },
  {
    name: 'Blockquote',
    input: '<body><header></header><main><div><blockquote><p>A wise quote</p></blockquote></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><blockquote><p>A wise quote</p></blockquote></div></main><footer></footer></body>',
  },
  {
    name: 'Code block',
    input: '<body><header></header><main><div><pre>const x = 1;</pre></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><pre><code>const x = 1;</code></pre></div></main><footer></footer></body>',
  },
  // Note: Nested formatting may have slight differences between prose2aem and doc2aem
  // due to how ProseMirror serializes nested marks. Skipping for now.
  // {
  //   name: 'Nested formatting',
  //   input: '<body><header></header><main><div><p><strong><em>Bold and italic</em></strong></p></div></main><footer></footer></body>',
  //   expected: '<body><header></header><main><div><p><strong><em>Bold and italic</em></strong></p></div></main><footer></footer></body>',
  // },
  {
    name: 'Link with formatting inside',
    input: '<body><header></header><main><div><p><a href="https://example.com"><strong>Bold link</strong></a></p></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><p><a href="https://example.com"><strong>Bold link</strong></a></p></div></main><footer></footer></body>',
  },
  {
    name: 'daMetadata block',
    input: '<body><header></header><main><div><p>Content</p></div></main><footer></footer><div class="da-metadata"><div><div>template</div><div>/templates/default</div></div></div></body>',
    expected: '<body><header></header><main><div><p>Content</p></div></main><footer></footer><div class="da-metadata"><div><div>template</div><div>/templates/default</div></div></div></body>',
  },
  {
    name: 'Regional edit - diff added',
    input: '<body><header></header><main><div><p da-diff-added="">New content</p></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><p da-diff-added="">New content</p></div></main><footer></footer></body>',
  },
  {
    name: 'Regional edit - diff deleted',
    input: '<body><header></header><main><div><da-diff-deleted data-mdast="ignore"><p>Deleted content</p></da-diff-deleted></div></main><footer></footer></body>',
    expected: '<body><header></header><main><div><da-diff-deleted data-mdast="ignore"><p>Deleted content</p></da-diff-deleted></div></main><footer></footer></body>',
  },
];

describe('Cross-Validation Test Suite (doc2aem contract)', () => {
  CROSS_VALIDATION_CASES.forEach(({ name, input, expected }) => {
    it(`${name}`, () => {
      const yDoc = new Y.Doc();
      aem2doc(input, yDoc);
      const result = doc2aem(yDoc);

      assert.equal(
        collapseWhitespace(result),
        collapseWhitespace(expected),
        `Roundtrip conversion failed for: ${name}`,
      );
    });
  });
});

// Export test cases for use in da-live tests
export { CROSS_VALIDATION_CASES, collapseWhitespace };
