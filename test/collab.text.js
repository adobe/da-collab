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
import { aem2doc, doc2aem } from '../src/collab.js';
import { HTMLRewriter } from '@worker-tools/html-rewriter/base64';

describe('collab test suite', () => {
    it('Test empty roundtrip', async () => {
        const html = `
<body>
  <header></header>
  <main><div></div></main>
  <footer></footer>
</body>
`;
      const yDoc = new Y.Doc();
      await aem2doc(html, yDoc, new HTMLRewriter());
      const result = doc2aem(yDoc);
      assert.equal(result, html);
    });
    it('Test simple roundtrip', async () => {
        const html = `
<body>
  <header></header>
  <main><div><p>Hi</p><p>Test</p><p>World</p><p> test</p></div></main>
  <footer></footer>
</body>
`;
      const yDoc = new Y.Doc();
      await aem2doc(html, yDoc, new HTMLRewriter());
      const result = doc2aem(yDoc);
      assert.equal(result, html);
    });
    it('Test more complex roundtrip', async () => {
        const html = `
        <body>
        <header></header>
        <main><div><p><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=750&amp;format=jpeg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" alt="Decorative double Helix" loading="lazy"></picture></p><h1>Congrats, you are ready to go! </h1><p>Your forked repo is setup as a helix project and you are ready to start developing.<br>The content you are looking at is served from this <a href="https://drive.google.com/drive/folders/1Gwwrujv0Z4TxJM8askdqQkHSD969dGK7">gdrive</a><br><br>Adjust the <code>fstab.yaml</code> to point to a folder either in your sharepoint or your gdrive that you shared with helix. See the full tutorial here:<br><br><a href="https://bit.ly/3aImqUL">https://www.hlx.live/tutorial</a></p><h2>This is another headline here for more content</h2><div class="columns"><div><div><p>Columns block</p><ul><li>One</li><li>Two</li><li>Three</li></ul><p><a href="/">Live</a></p></div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_17e9dd0aae03d62b8ebe2159b154d6824ef55732d.png?width=750&amp;format=png&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_17e9dd0aae03d62b8ebe2159b154d6824ef55732d.png?width=750&amp;format=png&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_17e9dd0aae03d62b8ebe2159b154d6824ef55732d.png?width=750&amp;format=png&amp;optimize=medium" alt="green double Helix" loading="lazy"></picture></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_143cf1a441962c90f082d4f7dba2aeefb07f4e821.png?width=750&amp;format=png&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_143cf1a441962c90f082d4f7dba2aeefb07f4e821.png?width=750&amp;format=png&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_143cf1a441962c90f082d4f7dba2aeefb07f4e821.png?width=750&amp;format=png&amp;optimize=medium" alt="Yellow Double Helix" loading="lazy"></picture></div><div><p>Or you can just view the preview</p><p><a href="/"><em>Preview</em></a></p></div></div></div></div><div><h2>Boilerplate Highlights?</h2><p>Find some of our favorite staff picks below:</p><div class="cards"><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_16582eee85490fbfe6b27c6a92724a81646c2e649.jpeg?width=750&amp;format=jpeg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_16582eee85490fbfe6b27c6a92724a81646c2e649.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_16582eee85490fbfe6b27c6a92724a81646c2e649.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" alt="A fast-moving Tunnel" loading="lazy"></picture></div><div><p><strong>Unmatched speed</strong></p><p>Helix is the fastest way to publish, create, and serve websites</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_17a5ca5faf60fa6486a1476fce82a3aa606000c81.jpeg?width=750&amp;format=jpeg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_17a5ca5faf60fa6486a1476fce82a3aa606000c81.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_17a5ca5faf60fa6486a1476fce82a3aa606000c81.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" alt="An iceberg" loading="lazy"></picture></div><div><p><strong>Content at scale</strong></p><p>Helix allows you to publish more content in shorter time with smaller teams</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_162cf9431ac2dfd17fe7bf4420525bbffb9d0ccfe.jpeg?width=750&amp;format=jpeg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_162cf9431ac2dfd17fe7bf4420525bbffb9d0ccfe.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_162cf9431ac2dfd17fe7bf4420525bbffb9d0ccfe.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" alt="Doors with light in the dark" loading="lazy"></picture></div><div><p><strong>Uncertainty eliminated</strong></p><p>Preview content at 100% fidelity, get predictable content velocity, and shorten project durations</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_136fdd3174ff44787179448cc2e0264af1b02ade9.jpeg?width=750&amp;format=jpeg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_136fdd3174ff44787179448cc2e0264af1b02ade9.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_136fdd3174ff44787179448cc2e0264af1b02ade9.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" alt="A group of people around a Table" loading="lazy"></picture></div><div><p><strong>Widen the talent pool</strong></p><p>Authors on Helix use Microsoft Word, Excel or Google Docs and need no training</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1cae8484004513f76c6bf5860375bc020d099a6d6.jpeg?width=750&amp;format=jpeg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1cae8484004513f76c6bf5860375bc020d099a6d6.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_1cae8484004513f76c6bf5860375bc020d099a6d6.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" alt="HTML code in a code editor" loading="lazy"></picture></div><div><p><strong>The low-code way to developer productivity</strong></p><p>Say goodbye to complex APIs spanning multiple languages. Anyone with a little bit of HTML, CSS, and JS can build a site on Project Helix.</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_11381226cb58caf1f0792ea27abebbc8569b00aeb.jpeg?width=750&amp;format=jpeg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_11381226cb58caf1f0792ea27abebbc8569b00aeb.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_11381226cb58caf1f0792ea27abebbc8569b00aeb.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" alt="A rocket and a headless suit" loading="lazy"></picture></div><div><p><strong>Headless is here</strong></p><p>Go directly from Microsoft Excel or Google Sheets to the web in mere seconds. Sanitize and collect form data at extreme scale with Project Helix Forms.</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_18fadeb136e84a2efe384b782e8aea6e92de4fc13.jpeg?width=750&amp;format=jpeg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_18fadeb136e84a2efe384b782e8aea6e92de4fc13.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_18fadeb136e84a2efe384b782e8aea6e92de4fc13.jpeg?width=750&amp;format=jpeg&amp;optimize=medium" alt="A dial with a hand on it" loading="lazy"></picture></div><div><p><strong>Peak performance</strong></p><p>Use Project Helix's serverless architecture to meet any traffic need. Use Project Helix's PageSpeed Insights Github action to evaluate every Pull-Request for Lighthouse Score.</p></div></div></div><p><br></p><div class="section-metadata"><div><div><p>Style</p></div><div><p>highlight</p></div></div></div></div><div><div class="metadata"><div><div><p>Title</p></div><div><p>Home | Helix Project Boilerplate</p></div></div><div><div><p>Image</p></div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=1200&amp;format=pjpg&amp;optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=1200&amp;format=pjpg&amp;optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=1200&amp;format=pjpg&amp;optimize=medium" loading="lazy"></picture></div></div><div><div><p>Description</p></div><div><p>Use this template repository as the starting point for new Helix projects.</p></div></div></div></div></main>
        <footer></footer>
      </body>
`;
      const yDoc = new Y.Doc();
      await aem2doc(html, yDoc, new HTMLRewriter());
      const result = doc2aem(yDoc);
      assert.equal(result, html);
    });

    it('Test more link roundtrip', async () => {
      const html = `
      <body>
      <header></header>
      <main><div><p>Your forked repo is setup as a helix project and you are ready to start developing.<br>The content you are looking at is served from this <a href="https://drive.google.com/drive/folders/1Gwwrujv0Z4TxJM8askdqQkHSD969dGK7">gdrive</a><br><br>Adjust the <code>fstab.yaml</code> to point to a folder either in your sharepoint or your gdrive that you shared with helix. See the full tutorial here:<br><br><a href="https://bit.ly/3aImqUL">https://www.hlx.live/tutorial</a></p></div></main>
      <footer></footer>
    </body>
`;
    const yDoc = new Y.Doc();
    await aem2doc(html, yDoc, new HTMLRewriter());
    const result = doc2aem(yDoc);
    assert.equal(result, html);
  });


});

