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
  it('table data-id support', async () => {
    let html = `
      <body>
        <header></header>
        <main>
          <div>
            <div class="hello" data-id="96789">
              <div>
                <div><p>Row 1 - Column 1</p></div>
                <div><p>Row 1 - Column 2</p></div>
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
    assert.equal(collapseWhitespace(result), html);
  });

  it('DIV block respects colspan', async () => {
    let html = `
      <body>
        <header></header>
        <main>
          <div>
            <div class="hello">
              <div>
                <div><p>Row 1 - Column 1</p></div>
                <div><p>Row 1 - Column 2</p></div>
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
    assert.equal(collapseWhitespace(result), html);
  });


  it('Text parsing produces error', async () => {
    const html = `
<body>
  <header></header>
  <main><div><p>I'll start again</p><ul><li><p>And here some more text</p><ol><li>And some more</li></ol></li></ul></div></main>
  <footer></footer>
</body>
`;
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    console.log(result);
    assert.equal(result, html);
  })

  it('Test linked image', async () => {
    const html = `
<body>
  <header></header>
  <main><div><img src="http://www.foo.com/myimg.jpg" href="https://i.am.link" title="Img Title" data-id="myImgId"></a></div></main>
  <footer></footer>
</body>
`;
    const expectedResult = `
<body>
  <header></header>
  <main><div><a href="https://i.am.link" title="Img Title"><picture><source srcset="http://www.foo.com/myimg.jpg"><source srcset="http://www.foo.com/myimg.jpg" media="(min-width: 600px)"><img src="http://www.foo.com/myimg.jpg" data-id="myImgId"></picture></a></div></main>
  <footer></footer>
</body>
`;
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    assert.equal(result, expectedResult);
  });

  it('Test empty roundtrip', async () => {
        const html = `
<body>
  <header></header>
  <main><div></div></main>
  <footer></footer>
</body>
`;
      const yDoc = new Y.Doc();
      aem2doc(html, yDoc);
      const result = doc2aem(yDoc);
      assert.equal(result, html);
    });

    it('Test simple roundtrip', async () => {
        const html = `
<body>
  <header></header>
  <main><div><p>Hi</p><p>Test</p><p>World</p><p>test</p></div></main>
  <footer></footer>
</body>
`;
      const yDoc = new Y.Doc();
      aem2doc(html, yDoc);
      const result = doc2aem(yDoc);
      assert.equal(result, html);
    });

    it('Test more complex roundtrip', async () => {
        const html = `
<body>
  <header></header>
  <main><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=750&format=jpeg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=750&format=jpeg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=750&format=jpeg&optimize=medium" alt="Decorative double Helix" loading="lazy"></picture><h1>Congrats, you are ready to go!</h1><p>Your forked repo is setup as a helix project and you are ready to start developing.<br>The content you are looking at is served from this <a href="https://drive.google.com/drive/folders/1Gwwrujv0Z4TxJM8askdqQkHSD969dGK7">gdrive</a><br><br>Adjust the <code>fstab.yaml</code> to point to a folder either in your sharepoint or your gdrive that you shared with helix. See the full tutorial here:<br><br><a href="https://bit.ly/3aImqUL">https://www.hlx.live/tutorial</a></p><h2>This is another headline here for more content</h2><div class="columns"><div><div><p>Columns block</p><ul><li>One</li><li>Two</li><li>Three</li></ul><p><a href="/">Live</a></p></div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_17e9dd0aae03d62b8ebe2159b154d6824ef55732d.png?width=750&format=png&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_17e9dd0aae03d62b8ebe2159b154d6824ef55732d.png?width=750&format=png&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_17e9dd0aae03d62b8ebe2159b154d6824ef55732d.png?width=750&format=png&optimize=medium" alt="green double Helix" loading="lazy"></picture></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_143cf1a441962c90f082d4f7dba2aeefb07f4e821.png?width=750&format=png&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_143cf1a441962c90f082d4f7dba2aeefb07f4e821.png?width=750&format=png&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_143cf1a441962c90f082d4f7dba2aeefb07f4e821.png?width=750&format=png&optimize=medium" alt="Yellow Double Helix" loading="lazy"></picture></div><div><p>Or you can just view the preview</p><p><a href="/"><em>Preview</em></a></p></div></div></div></div><div><h2>Boilerplate Highlights?</h2><p>Find some of our favorite staff picks below:</p><div class="cards"><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_16582eee85490fbfe6b27c6a92724a81646c2e649.jpeg?width=750&format=jpeg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_16582eee85490fbfe6b27c6a92724a81646c2e649.jpeg?width=750&format=jpeg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_16582eee85490fbfe6b27c6a92724a81646c2e649.jpeg?width=750&format=jpeg&optimize=medium" alt="A fast-moving Tunnel" loading="lazy"></picture></div><div><p><strong>Unmatched speed</strong></p><p>Helix is the fastest way to publish, create, and serve websites</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_17a5ca5faf60fa6486a1476fce82a3aa606000c81.jpeg?width=750&format=jpeg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_17a5ca5faf60fa6486a1476fce82a3aa606000c81.jpeg?width=750&format=jpeg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_17a5ca5faf60fa6486a1476fce82a3aa606000c81.jpeg?width=750&format=jpeg&optimize=medium" alt="An iceberg" loading="lazy"></picture></div><div><p><strong>Content at scale</strong></p><p>Helix allows you to publish more content in shorter time with smaller teams</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_162cf9431ac2dfd17fe7bf4420525bbffb9d0ccfe.jpeg?width=750&format=jpeg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_162cf9431ac2dfd17fe7bf4420525bbffb9d0ccfe.jpeg?width=750&format=jpeg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_162cf9431ac2dfd17fe7bf4420525bbffb9d0ccfe.jpeg?width=750&format=jpeg&optimize=medium" alt="Doors with light in the dark" loading="lazy"></picture></div><div><p><strong>Uncertainty eliminated</strong></p><p>Preview content at 100% fidelity, get predictable content velocity, and shorten project durations</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_136fdd3174ff44787179448cc2e0264af1b02ade9.jpeg?width=750&format=jpeg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_136fdd3174ff44787179448cc2e0264af1b02ade9.jpeg?width=750&format=jpeg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_136fdd3174ff44787179448cc2e0264af1b02ade9.jpeg?width=750&format=jpeg&optimize=medium" alt="A group of people around a Table" loading="lazy"></picture></div><div><p><strong>Widen the talent pool</strong></p><p>Authors on Helix use Microsoft Word, Excel or Google Docs and need no training</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1cae8484004513f76c6bf5860375bc020d099a6d6.jpeg?width=750&format=jpeg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1cae8484004513f76c6bf5860375bc020d099a6d6.jpeg?width=750&format=jpeg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_1cae8484004513f76c6bf5860375bc020d099a6d6.jpeg?width=750&format=jpeg&optimize=medium" alt="HTML code in a code editor" loading="lazy"></picture></div><div><p><strong>The low-code way to developer productivity</strong></p><p>Say goodbye to complex APIs spanning multiple languages. Anyone with a little bit of HTML, CSS, and JS can build a site on Project Helix.</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_11381226cb58caf1f0792ea27abebbc8569b00aeb.jpeg?width=750&format=jpeg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_11381226cb58caf1f0792ea27abebbc8569b00aeb.jpeg?width=750&format=jpeg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_11381226cb58caf1f0792ea27abebbc8569b00aeb.jpeg?width=750&format=jpeg&optimize=medium" alt="A rocket and a headless suit" loading="lazy"></picture></div><div><p><strong>Headless is here</strong></p><p>Go directly from Microsoft Excel or Google Sheets to the web in mere seconds. Sanitize and collect form data at extreme scale with Project Helix Forms.</p></div></div><div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_18fadeb136e84a2efe384b782e8aea6e92de4fc13.jpeg?width=750&format=jpeg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_18fadeb136e84a2efe384b782e8aea6e92de4fc13.jpeg?width=750&format=jpeg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_18fadeb136e84a2efe384b782e8aea6e92de4fc13.jpeg?width=750&format=jpeg&optimize=medium" alt="A dial with a hand on it" loading="lazy"></picture></div><div><p><strong>Peak performance</strong></p><p>Use Project Helix's serverless architecture to meet any traffic need. Use Project Helix's PageSpeed Insights Github action to evaluate every Pull-Request for Lighthouse Score.</p></div></div></div><p><br></p><div class="section-metadata"><div><div><p>Style</p></div><div><p>highlight</p></div></div></div></div><div><div class="metadata"><div><div><p>Title</p></div><div><p>Home | Helix Project Boilerplate</p></div></div><div><div><p>Image</p></div><div><picture><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=1200&format=pjpg&optimize=medium"><source srcset="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=1200&format=pjpg&optimize=medium" media="(min-width: 600px)"><img src="https://main--aem-block-collection--adobe.hlx.live/media_1dc0a2d290d791a050feb1e159746f52db392775a.jpeg?width=1200&format=pjpg&optimize=medium" loading="lazy"></picture></div></div><div><div><p>Description</p></div><div><p>Use this template repository as the starting point for new Helix projects.</p></div></div></div></div></main>
  <footer></footer>
</body>
`;
      const yDoc = new Y.Doc();
      aem2doc(html, yDoc);
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
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    assert.equal(result, html);
  });

  it('Test nested marks roundtrip', async () => {
    const html = `
<body>
  <header></header>
  <main><div><p>Your forked repo is setup as a helix project and you are ready to start developing.<br>The content you are looking at is served <strong>from </strong><em><strong>this</strong></em> <a href="https://drive.google.com/drive/folders/1Gwwrujv0Z4TxJM8askdqQkHSD969dGK7">gdrive</a><br><br>Adjust the <code>fstab.yaml</code> to point to a folder either in your sharepoint or your gdrive that you shared with helix. See the full tutorial here:<br><br><a href="https://bit.ly/3aImqUL">https://www.hlx.live/tutorial</a></p></div></main>
  <footer></footer>
</body>
`;
  const yDoc = new Y.Doc();
  aem2doc(html, yDoc);
  const result = doc2aem(yDoc);
  assert.equal(result, html);
});
it('Test simple block roundtrip', async () => {
  const html = `
<body>
  <header></header>
  <main><div><div class="foo"><div><div><h1>bar</h1></div><div><h2>bar2</h2></div></div></div></div></main>
  <footer></footer>
</body>
`;
const yDoc = new Y.Doc();
aem2doc(html, yDoc);
const result = doc2aem(yDoc);
assert.equal(result, html);
});
it('Test complex block roundtrip', async () => {
  const html =`
<body>
  <header></header>
  <main><div><picture><source srcset="./media_133f71a3e1a71c230536dd8e163189cd5c6269173.png?width=750&format=png&optimize=medium"><source srcset="./media_133f71a3e1a71c230536dd8e163189cd5c6269173.png?width=750&format=png&optimize=medium" media="(min-width: 600px)"><img src="./media_133f71a3e1a71c230536dd8e163189cd5c6269173.png?width=750&format=png&optimize=medium" alt="Wheatley Vodka" loading="lazy"></picture><h1>The truth is in the taste</h1><h2>10 times distilled for<br>ultra-smoothness</h2><p><a href="/about-wheatley">Learn About Wheatley Vodka</a></p><h3>10 times distilled and tripled filtered for an ultra-smooth taste.</h3></div><div><div class="callout"><div><div><h2>An award-winning vodka from the world's most award-winning distillery.</h2></div></div><div><div><picture><source srcset="./media_12c307c8546ea3d44f485807a7ce703751cf23d4c.png?width=750&format=png&optimize=medium"><source srcset="./media_12c307c8546ea3d44f485807a7ce703751cf23d4c.png?width=750&format=png&optimize=medium" media="(min-width: 600px)"><img src="./media_12c307c8546ea3d44f485807a7ce703751cf23d4c.png?width=750&format=png&optimize=medium" alt="" loading="lazy"></picture></div><div><picture><source srcset="./media_1ac96e8af760937793baa1fa6c49de457f8552813.png?width=750&format=png&optimize=medium"><source srcset="./media_1ac96e8af760937793baa1fa6c49de457f8552813.png?width=750&format=png&optimize=medium" media="(min-width: 600px)"><img src="./media_1ac96e8af760937793baa1fa6c49de457f8552813.png?width=750&format=png&optimize=medium" alt="" loading="lazy"></picture></div></div></div></div><div><div class="columns"><div><div><picture><source srcset="./media_117154c8890aced2855ddf92c698df8789757ebf4.png?width=750&format=png&optimize=medium"><source srcset="./media_117154c8890aced2855ddf92c698df8789757ebf4.png?width=750&format=png&optimize=medium" media="(min-width: 600px)"><img src="./media_117154c8890aced2855ddf92c698df8789757ebf4.png?width=750&format=png&optimize=medium" alt="Wheatley Vodka" loading="lazy"></picture></div><div><h2>Buffalo Trace Distillery - 200 years of distilling experience</h2><p>When you set out to craft a vodka from scratch, 200 years of distilling experience comes in handy. Harlen Wheatley is the Master Distiller at Buffalo Trace Distillery, America's oldest continually-operated distillery—and the world's most decorated. It all comes down to a vodka that's deliberately crafted using centuries of spirit-making knowledge.</p><p><a href="/locator">Find Wheatley Near You</a></p></div></div></div><div class="section-metadata"><div><div><p>style</p></div><div><p>reverse</p></div></div><div><div><p>background-image</p></div><div><picture><source srcset="./media_126e3f942f3105fc9f0a3e18d3d91f91fe9e32d9c.png?width=750&format=png&optimize=medium"><source srcset="./media_126e3f942f3105fc9f0a3e18d3d91f91fe9e32d9c.png?width=750&format=png&optimize=medium" media="(min-width: 600px)"><img src="./media_126e3f942f3105fc9f0a3e18d3d91f91fe9e32d9c.png?width=750&format=png&optimize=medium" alt="" loading="lazy"></picture></div></div></div></div><div><div class="featured plain"><div><div><ul><li><a href="/cocktails/cucumber-collins">Cucumber Collins</a></li><li><a href="/cocktails/wheatley-vodka-club">Wheatley Vodka Club</a></li><li><a href="/cocktails/la-luna-rossa">La Luna Rossa</a></li><li><a href="/cocktails/flatiron-flip">Flatiron Flip</a></li><li><a href="/cocktails/romapolitan">Romapolitan</a></li><li><a href="/cocktails">All Cocktails</a></li></ul></div></div></div></div><div><div class="buy"></div></div><div><h2>Follow us on Instagram</h2><p><a href="https://curator.io">Powered by Curator.io</a></p></div><div><picture><source srcset="./media_180bc2eb557a14b99d41d0e539946e44c45b9630e.png?width=750&format=png&optimize=medium"><source srcset="./media_180bc2eb557a14b99d41d0e539946e44c45b9630e.png?width=750&format=png&optimize=medium" media="(min-width: 600px)"><img src="./media_180bc2eb557a14b99d41d0e539946e44c45b9630e.png?width=750&format=png&optimize=medium" alt="" loading="lazy"></picture></div></main>
  <footer></footer>
</body>
`;
const yDoc = new Y.Doc();
aem2doc(html, yDoc);
const result = doc2aem(yDoc);
console.log(result);
assert.equal(result, html);
});
it('Test linebreak roundtrip', async () => {
  const html =`
<body>
  <header></header>
  <main><div><p>Is this broken?</p></div></main>
  <footer></footer>
</body>
`;
const yDoc = new Y.Doc();
aem2doc(html, yDoc);
const result = doc2aem(yDoc);
console.log(result);
assert.equal(result, html);
});

  it('Test regional edits', async () => {
    const html = `
<body>
  <header></header>
  <main><div><da-loc-deleted><h1>Deleted H1 Here</h1></da-loc-deleted><da-loc-added><h1>Added H1 Here</h1></da-loc-added></div></main>
  <footer></footer>
</body>
`;
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    console.log(result);
    assert.equal(result, html);
  });

  it('Test regional edit table parsing', async () => {
    const html = readFileSync('./test/mocks/regional-edit-1.html', 'utf-8');
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    assert.equal(collapseWhitespace(result.trim()), collapseWhitespace(html.trim()));
  });

  it('Test data ids', async () => {
    let html = `
      <body>
        <header></header>
        <main>
          <div>
            <p>Paragraph with no data id</p>
            <p data-id="p-id">Paragraph with data id</p>
          </div>
          <div>
            <h1 data-id="h1-id">H1</h1>
            <h2 data-id="h2-id">H2</h2>
            <h3 data-id="h3-id">H3</h3>
            <h4 data-id="h4-id">H4</h4>
            <h5 data-id="h5-id">H5</h5>
            <h6 data-id="h6-id">H6</h6>
          </div>
          <div>
            <h1>H1 with no data id</h1>
            <h2>H2 with no data id</h2>
            <h3>H3 with no data id</h3>
            <h4>H4 with no data id</h4>
            <h5>H5 with no data id</h5>
            <h6>H6 with no data id</h6>
          </div>
          <div>
            <ol data-id="ol-1">
              <li>Item 1</li>
            </ol>
            <ol>
              <li>Item 1</li>
              <li>Item 2</li>
            </ol>
          </div>
          <div>
            <ul data-id="ul-1">
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
          </div>
          <div>
            <pre data-id="mycode"><code>const hello = 'world';</code></pre>
            <pre><code>const hello = 'no id';</code></pre>
          </div>
          <div>
            <blockquote data-id="bq-id">
              <p>Words can be like X-rays, if you use them properly—they'll go through anything. You read and you're pierced.</p>
              <p>—Aldous Huxley, Brave New World</p>
            </blockquote>
          </div>
          <div>
            <blockquote>
              <p>No ID Here.</p>
              <p>—Shantanu, Adobe</p>
            </blockquote>
          </div>
        </main>
        <footer></footer>
      </body>
      `;
    html = collapseWhitespace(html);
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = collapseWhitespace(doc2aem(yDoc));
    assert.equal(result, html);
  });

  it('Test superscript and subscript', async () => {
    const html = `
<body>
  <header></header>
  <main><div><p>Hello <sup>Karl</sup></p><p>And here is <sub>subscript</sub></p><p>Done</p></div></main>
  <footer></footer>
</body>
`;
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    console.log(result);
    assert.equal(result, html);
  });

  it('Test section break conversion', () => {
    const htmlIn = `
<body>
  <header></header>
  <main><div><p>ABC</p><p>---</p><p>DEF</p></div></main>
  <footer></footer>
</body>
`;
    const htmlOut = `
<body>
  <header></header>
  <main><div><p>ABC</p></div><div><p>DEF</p></div></main>
  <footer></footer>
</body>
`;
    const yDoc = new Y.Doc();
    aem2doc(htmlIn, yDoc);
    const result = doc2aem(yDoc);
    console.log(result);
    assert.equal(result, htmlOut,
      'The horizontal line should have been converted to a section break');
  });

  it('Test table with empty header', () => {
    const values = {
      // no values
    }
    const p = {
      children: [values]
    }
    const tr = {
      children: [p]
    }
    const td = {
      children: [tr]
    }
    const tbody = {
      children: [td]
    }
    const table = {
      children: [tbody]
    }

    const fragment = {
      children: []
    }
    tableToBlock(table, fragment);
    assert.equal(1, fragment.children.length);
    const divEl = fragment.children[0];
    assert.equal('div', divEl.type);
    assert.equal('', divEl.attributes.class);
  });

  it('Test table with non-empty header', () => {
    const values = {
      text: 'myblock'
    }
    const p = {
      children: [values]
    }
    const tr = {
      children: [p]
    }
    const td = {
      children: [tr]
    }
    const tbody = {
      children: [td]
    }
    const table = {
      children: [tbody]
    }

    const fragment = {
      children: []
    }
    tableToBlock(table, fragment);
    assert.equal(1, fragment.children.length);
    const divEl = fragment.children[0];
    assert.equal('div', divEl.type);
    assert.equal('myblock', divEl.attributes.class);
  });

  it('image links', async () => {
    let html = `
      <body>
        <header></header>
        <main>
          <div>
            <div class="cards video-hover-card">
        <div>
          <div><a href="https://www.google.com">
              <picture>
                <source
                  srcset="https://publish-p107857-e1299068.adobeaemcloud.com/content/dam/jmp/images/design/home/jmp-anthem-thumbnail.png">
                <source
                  srcset="https://publish-p107857-e1299068.adobeaemcloud.com/content/dam/jmp/images/design/home/jmp-anthem-thumbnail.png"
                  media="(min-width: 600px)"><img
                  src="https://publish-p107857-e1299068.adobeaemcloud.com/content/dam/jmp/images/design/home/jmp-anthem-thumbnail.png">
              </picture>
            </a></div>
          <div>
            <h4>Wo Ihre Entdeckungsreise beginnt</h4>
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
    assert.equal(collapseWhitespace(result), html);
  });

  it('image links 2', async () => {
    let html = `
<body>
  <header></header>
  <main>
    <div>
      <a href="https://www.adobe.com" title="Go Home">
        <picture>
          <source srcset="https://content.da.live/aemsites/da-block-collection/drafts/ccc/dock.jpg">
          <source srcset="https://content.da.live/aemsites/da-block-collection/drafts/ccc/dock.jpg"
            media="(min-width: 600px)"><img
            src="https://content.da.live/aemsites/da-block-collection/drafts/ccc/dock.jpg">
        </picture>
      </a>
    </div>
  </main>
  <footer></footer>
</body>`;

    html = collapseWhitespace(html);
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    assert.equal(collapseWhitespace(result), html);
  });

  it('picture inside a table', async () => {
    let html = `
<body>
  <header></header>
  <main>
    <div>
      <div class="columns">
        <div>
          <div>
            <a href="https://adobe.com/blah/blah" title="dock">
              <picture>
                <source srcset="https://content.da.live/aemsites/da-block-collection/drafts/ccc/dock.jpg">
                <source srcset="https://content.da.live/aemsites/da-block-collection/drafts/ccc/dock.jpg" media="(min-width: 600px)">
                <img src="https://content.da.live/aemsites/da-block-collection/drafts/ccc/dock.jpg">
              </picture>
            </a>
          </div>
        </div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>`;

    html = collapseWhitespace(html);
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    assert.equal(collapseWhitespace(result), html);
  });

  it('handles mixed content with image links', async () => {
    const html = `
<body>
  <header></header>
  <main><div>
    <h1>Title</h1>
    <p>Text before</p>
    <a href="https://example.com" title="Mixed">
      <picture>
        <source srcset="https://example.com/image.jpg">
        <source srcset="https://example.com/image.jpg" media="(min-width: 600px)">
        <img src="https://example.com/image.jpg" alt="Mixed">
      </picture>
    </a>
    <p>Text after</p>
  </div></main>
  <footer></footer>
</body>`;
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    assert.equal(collapseWhitespace(result), collapseWhitespace(html));
  });

  it('handles image links in regional edits', async () => {
    const html = `
<body>
  <header></header>
  <main><div>
    <da-loc-deleted>
      <a href="https://old.example.com" title="Old">
        <picture>
          <source srcset="https://old.example.com/image.jpg">
          <source srcset="https://old.example.com/image.jpg" media="(min-width: 600px)">
          <img src="https://old.example.com/image.jpg" alt="Old">
        </picture>
      </a>
    </da-loc-deleted>
    <da-loc-added>
      <a href="https://new.example.com" title="New">
        <picture>
          <source srcset="https://new.example.com/image.jpg">
          <source srcset="https://new.example.com/image.jpg" media="(min-width: 600px)">
          <img src="https://new.example.com/image.jpg" alt="New">
        </picture>
      </a>
    </da-loc-added>
  </div></main>
  <footer></footer>
</body>`;
    const yDoc = new Y.Doc();
    aem2doc(html, yDoc);
    const result = doc2aem(yDoc);
    assert.equal(collapseWhitespace(result), collapseWhitespace(html));
  });
});


