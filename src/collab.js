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
import {
  prosemirrorToYXmlFragment, yDocToProsemirror,
} from 'y-prosemirror';
import { DOMParser, DOMSerializer } from 'prosemirror-model';
import { fromHtml } from 'hast-util-from-html';
import { matches } from 'hast-util-select';
import { getSchema } from './schema.js';

function convertSectionBreak(node) {
  if (!node) return;
  if (node.children) {
    node.children.forEach(convertSectionBreak);
  }
  if (node.tagName === 'p' && node.children && node.children.length === 1) {
    if (node.children[0].type === 'text' && node.children[0].value === '---') {
      // eslint-disable-next-line no-param-reassign
      node.children.length = 0;
      // eslint-disable-next-line no-param-reassign
      node.tagName = 'hr';
    }
  }
}

function divFilter(parent) {
  return parent.children.filter((child) => child.tagName === 'div');
}

function blockToTable(child, children) {
  children.push({
    type: 'element', tagName: 'p', children: [], properties: {},
  });
  const classes = Array.from(child.properties.className);
  const name = classes.shift();
  const blockName = classes.length > 0 ? `${name} (${classes.join(', ')})` : name;
  const rows = [...divFilter(child)];
  const maxCols = rows.reduce((colCount, row) => {
    const cols = divFilter(row);
    return cols.length > colCount ? cols.length : colCount;
  }, 0);

  const table = {
    type: 'element', tagName: 'table', children: [], properties: {},
  };

  table.properties.dataId = child.properties.dataId;
  table.properties['da-diff-added'] = child.properties['da-diff-added'];

  children.push(table);
  const headerRow = {
    type: 'element', tagName: 'tr', children: [], properties: {},
  };

  const td = {
    type: 'element', tagName: 'td', children: [{ type: 'text', value: blockName }], properties: { colSpan: maxCols },
  };

  headerRow.children.push(td);
  table.children.push(headerRow);
  rows.filter((row) => row.tagName === 'div').forEach((row) => {
    const tr = {
      type: 'element', tagName: 'tr', children: [], properties: {},
    };
    const cells = (row.children ? [...row.children] : [row]).filter((cell) => cell.type !== 'text' || (cell.value && cell.value.trim() !== '\n' && cell.value.trim() !== ''));
    cells.forEach((cell, idx) => {
      const tdi = {
        type: 'element', tagName: 'td', children: [], properties: {},
      };
      if (cells.length < maxCols && idx === cells.length - 1) {
        tdi.properties.colSpan = maxCols - idx;
      }
      tdi.children.push(cells[idx]);
      tr.children.push(tdi);
    });
    table.children.push(tr);
  });
  children.push({
    type: 'element', tagName: 'p', children: [], properties: {},
  });
}

/**
 * Recursively traverses a node tree and fixes image links by moving link attributes to img elements
 */
function fixImageLinks(node) {
  if (!node) return node;

  // Recursively process children first
  if (node.children) {
    // Process children and collect indices of <a> tags that wrap images
    const childrenToReplace = [];

    node.children.forEach((child, index) => {
      if (child.tagName === 'a' && child.children?.length > 0) {
        const {
          href, title,
          'da-diff-added': daDiffAdded,
        } = child.properties;
        let hasImages = false;

        const propsToAdd = {
          href,
          title,
          ...(daDiffAdded === '' ? { 'da-diff-added': daDiffAdded } : {}),
        };

        child.children.forEach((linkChild) => {
          if (linkChild.tagName === 'picture') {
            hasImages = true;
            linkChild.children.forEach((pictureChild) => {
              if (pictureChild.tagName === 'img') {
                // eslint-disable-next-line no-param-reassign
                pictureChild.properties = {
                  ...pictureChild.properties,
                  ...propsToAdd,
                };
              }
            });
          } else if (linkChild.tagName === 'img') {
            hasImages = true;
            // eslint-disable-next-line no-param-reassign
            linkChild.properties = {
              ...linkChild.properties,
              ...propsToAdd,
            };
          }
        });

        // If this link wraps images, mark it for replacement
        if (hasImages) {
          childrenToReplace.push({ index, children: child.children });
        }
      } else {
        fixImageLinks(child);
      }
    });

    // Replace <a> tags that wrap images with their children
    if (childrenToReplace.length > 0) {
      const newChildren = [];
      let replaceIndex = 0;

      node.children.forEach((child, index) => {
        if (replaceIndex < childrenToReplace.length
          && childrenToReplace[replaceIndex].index === index) {
          // Replace this <a> tag with its children
          newChildren.push(...childrenToReplace[replaceIndex].children);
          replaceIndex += 1;
        } else {
          newChildren.push(child);
        }
      });

      // eslint-disable-next-line no-param-reassign
      node.children = newChildren;
    }
  }

  return node;
}

function removeComments(node) {
  if (!node) return node;
  // eslint-disable-next-line no-param-reassign
  node.children = node.children?.filter((child) => child.type !== 'comment') || [];
  node.children.forEach(removeComments);
  return node;
}

export const EMPTY_DOC = '<body><header></header><main><div></div></main><footer></footer></body>';

function convertLocTags(html) {
  // TODO: Remove this once we no longer support old regional edits
  // eslint-disable-next-line no-param-reassign
  html = html.replaceAll('<da-loc-added', '<da-diff-added')
    .replaceAll('<da-loc-deleted', '<da-diff-deleted')
    .replaceAll('</da-loc-added', '</da-diff-added')
    .replaceAll('</da-loc-deleted', '</da-diff-deleted');
  return html;
}

/**
 * Wraps elements with da-diff-added attribute in a da-diff-added element
 * If the element is a block-group-start, it will wrap the entire block-group
 */
function processDaDiffAdded(main) {
  if (!main?.children) return;

  // Helper function to create wrapper element
  const createWrapper = (children) => ({
    type: 'element',
    tagName: 'da-diff-added',
    properties: {},
    children,
  });

  const hasDaDiffAdded = (child) => child.type === 'element'
    && child.properties?.['da-diff-added'] !== undefined;

  const isBlockGroupStart = (child) => child.tagName === 'div'
    && child.properties?.className?.includes('block-group-start');

  const isBlockGroupEnd = (child) => child.tagName === 'div'
    && child.properties?.className?.includes('block-group-end');

  const collectBlockGroup = (children, startIndex) => {
    const endIndex = children.findIndex(
      (child, index) => index > startIndex && isBlockGroupEnd(child),
    );

    return {
      elementsToWrap: children.slice(
        startIndex,
        endIndex === -1 ? children.length : endIndex + 1,
      ),
      endIndex: endIndex === -1 ? children.length - 1 : endIndex,
    };
  };

  main.children.forEach((divChild) => {
    if (divChild.tagName !== 'div' || !divChild.children) return;

    const children = [...divChild.children];
    const newChildren = [];

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];

      if (hasDaDiffAdded(child)) {
        if (isBlockGroupStart(child)) {
          const { elementsToWrap, endIndex } = collectBlockGroup(children, i);
          newChildren.push(createWrapper(elementsToWrap));
          i = endIndex; // Skip all the wrapped elements
        } else {
          newChildren.push(createWrapper([child]));
        }
      } else {
        newChildren.push(child);
      }
    }

    // eslint-disable-next-line no-param-reassign
    divChild.children = newChildren;
  });
}

const getMetadata = (metadataTree) => {
  const attrs = {};
  if (metadataTree?.children) {
    metadataTree.children.forEach((rowDiv) => {
      if (rowDiv.tagName === 'div') {
        const divChildren = rowDiv.children?.filter((child) => child.tagName === 'div') || [];
        if (divChildren.length === 2) {
          const key = divChildren[0].children?.[0]?.value;
          const value = divChildren[1].children?.[0]?.value || null;
          if (key) {
            attrs[key] = value;
          }
        }
      }
    });
  }
  return attrs;
};

export function aem2doc(html, ydoc) {
  if (!html) {
    // eslint-disable-next-line no-param-reassign
    html = EMPTY_DOC;
  }
  if (html.includes('<da-loc-added') || html.includes('<da-loc-deleted')) {
    // eslint-disable-next-line no-param-reassign
    html = convertLocTags(html);
  }

  const tree = fromHtml(html, { fragment: true });
  const daMetadataEl = tree.children.find(
    (child) => child.tagName === 'div' && child.properties?.className?.includes('da-metadata'),
  );
  const daMetadata = getMetadata(daMetadataEl);

  const main = tree.children.find((child) => child.tagName === 'main');
  if (main) {
    if (html.includes('da-diff-added')) {
      processDaDiffAdded(main);
    }
    fixImageLinks(main);
    removeComments(main);
    (main.children || []).forEach((parent) => {
      if (parent.tagName === 'div' && parent.children) {
        const children = [];
        let modified = false;
        parent.children.forEach((child) => {
          if (child.tagName === 'div' && child.properties.className?.length > 0) {
            modified = true;
            blockToTable(child, children);
          } else if (['da-diff-deleted', 'da-diff-added'].includes(child.tagName)) {
            modified = true;
            const locChildren = [];
            child.children.forEach((locChild) => {
              if (locChild.tagName === 'div' && locChild.properties.className?.length > 0) {
                blockToTable(locChild, locChildren);
              } else {
                locChildren.push(locChild);
              }
            });
            // eslint-disable-next-line no-param-reassign
            parent.children = children;

            // eslint-disable-next-line no-param-reassign
            child.children = locChildren;
            children.push(child);
          } else {
            children.push(child);
          }
        });
        if (modified) {
          // eslint-disable-next-line no-param-reassign
          parent.children = children;
        }
      }
    });

    convertSectionBreak(main);
    let count = 0;

    const getEl = (tagName) => ({
      type: 'element', tagName, children: [], properties: {},
    });

    main.children = main.children.flatMap((node) => {
      const result = [];
      if (node.tagName === 'div') {
        if (count > 0) {
          result.push(getEl('p'));
          result.push(getEl('hr'));
          result.push(getEl('p'));
          result.push(...node.children);
        } else {
          result.push(node);
        }
        count += 1;
      } else {
        result.push(node);
      }
      return result;
    });
  }

  const handler2 = {
    get(target, prop) {
      const source = target;
      if (prop === 'firstChild') {
        if (target.children.length === 0) return null;
        for (let i = 0; i < target.children.length - 1; i += 1) {
          source.children[i].nextSibling = new Proxy(target.children[i + 1], handler2);
          if (i > 0) {
            source.children[i].previousSibling = new Proxy(target.children[i - 1], handler2);
          } else {
            source.children[i].previousSibling = new Proxy(
              target.children[target.children.length - 1],
              handler2,
            );
          }
        }
        return new Proxy(target.children[0], handler2);
      }
      if (prop === 'nodeType') {
        return target.type === 'text' ? 3 : 1;
      }
      if (prop === 'nodeValue') {
        return target.value;
      }

      if (prop === 'nextSibling') {
        return target.nextSibling;
      }

      if (prop === 'previousSibling') {
        return target.previousSibling;
      }

      if (prop === 'nodeName') {
        return target.tagName?.toUpperCase();
      }

      if (prop === 'matches') {
        return (selector) => matches(selector, target);
      }

      if (prop === 'getAttribute') {
        return (name) => {
          // when `tree` is created using `fromHtml` in hast-util-from-html
          // that then calls fromParse5 in hast-util-from-parse5
          // which converts the `colspan`/`rowspan` attribute to `colSpan`/`rowSpan`
          if (name === 'colspan') {
            // eslint-disable-next-line no-param-reassign
            name = 'colSpan';
          }
          if (name === 'rowspan') {
            // eslint-disable-next-line no-param-reassign
            name = 'rowSpan';
          }
          return target.properties ? target.properties[name] : undefined;
        };
      }
      /* c8 ignore start */
      // impossible to generate a test scenario for this
      if (prop === 'hasAttribute') {
        return (name) => target.properties && target.properties[name];
      }

      if (prop === 'style') {
        return {};
      }
      return Reflect.get(target, prop);
      /* c8 ignore end */
    },
  };

  const schema = getSchema();
  const json = DOMParser.fromSchema(schema).parse(new Proxy(main || tree, handler2));

  // Store da attributes in yMap since y-prosemirror doesn't preserve doc-level attrs
  const mdMap = ydoc.getMap('daMetadata');
  Object.entries(daMetadata).forEach(([key, value]) => {
    if (value !== null) {
      mdMap.set(key, value);
    } else {
      mdMap.delete(key);
    }
  });

  prosemirrorToYXmlFragment(json, ydoc.getXmlFragment('prosemirror'));
}

const getAttrString = (attributes) => Object.entries(attributes).map(([key, value]) => ` ${key}="${value}"`).join('');

function tohtml(node) {
  const { attributes } = node;
  let attrString = getAttrString(attributes);
  if (!node.children || node.children.length === 0) {
    if (node.type === 'text') {
      return node.text;
    }
    if (node.type === 'p') return '';
    if (node.type === 'img') {
      if (!attributes.loading) {
        attrString += ' loading="lazy"';
      }
      const { href, src, title } = attributes;
      if (attributes.href) {
        // hoist link attributes back to <a>
        delete attributes.href;
        delete attributes.title;

        const daDiffAddedStr = attributes['da-diff-added'] === '' ? ' da-diff-added=""' : '';
        delete attributes['da-diff-added'];

        attrString = getAttrString(attributes);
        const titleStr = title ? ` title="${title}"` : '';
        return `<a href="${href}"${titleStr}${daDiffAddedStr}><picture><source srcset="${src}"><source srcset="${src}" media="(min-width: 600px)"><img${attrString}></picture></a>`;
      }
      return `<picture><source srcset="${src}"><source srcset="${src}" media="(min-width: 600px)"><img${attrString}></picture>`;
    }

    const result = node.type !== 'br' ? `<${node.type}${attrString}></${node.type}>` : `<${node.type}>`;

    return result;
  }
  let { children } = node;
  if (node.type === 'li' && children.length === 1 && children[0].type === 'p') {
    children = children[0].children;
  }
  // Unwrap paragraphs that contain only images (single or multiple)
  // Filter out empty text nodes and check if remaining content is only images
  if (node.type === 'p' && children.length > 0) {
    const nonEmptyChildren = children.filter((child) => {
      if (child.type !== 'text') return true;
      return child.text?.trim().length > 0;
    });

    // If we only have images after filtering, unwrap them
    if (nonEmptyChildren.every((child) => child.type === 'img')) {
      return children.map((child) => tohtml(child)).join('');
    }
  }
  return `<${node.type}${attrString}>${children.map((child) => tohtml(child)).join('')}</${node.type}>`;
}

function toBlockCSSClassNames(text) {
  if (!text) return [];
  const names = [];
  const idx = text.lastIndexOf('(');
  if (idx >= 0) {
    names.push(text.substring(0, idx));
    names.push(...text.substring(idx + 1).split(','));
  } else {
    names.push(text);
  }

  return names.map((name) => name
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, ''))
    .filter((name) => !!name);
}

export function tableToBlock(child, fragment) {
  const rows = child.children[0].children;
  const nameRow = rows.shift();
  const className = toBlockCSSClassNames(nameRow.children[0].children[0].children[0]?.text).join(' ');
  const block = { type: 'div', attributes: { class: className }, children: [] };
  const { dataId, daDiffAdded } = child.attributes || {};
  if (dataId) block.attributes['data-id'] = dataId;
  if (daDiffAdded === '') block.attributes['da-diff-added'] = '';
  fragment.children.push(block);
  rows.forEach((row) => {
    const div = { type: 'div', attributes: {}, children: [] };
    block.children.push(div);
    row.children.forEach((col) => {
      div.children.push({ type: 'div', attributes: {}, children: col.children });
    });
  });
}

export function doc2aem(ydoc) {
  const schema = getSchema();
  let json = yDocToProsemirror(schema, ydoc);

  // Restore da attributes from yMap since y-prosemirror doesn't preserve doc-level attrs
  const mdMap = ydoc.getMap('daMetadata');
  const daMetadata = {};
  mdMap.forEach((value, key) => {
    daMetadata[key] = value;
  });
  json = json.type.create({ ...json.attrs, ...daMetadata }, json.content);

  const fragment = { type: 'div', children: [], attributes: {} };
  const handler3 = {
    get(target, prop) {
      const source = target;
      if (prop === 'createDocumentFragment') {
        return () => new Proxy(fragment, handler3);
      }
      if (prop === 'appendChild') {
        return (node) => target.children.push(node);
      }
      if (prop === 'createElement') {
        return (type) => new Proxy({ type, children: [], attributes: [] }, handler3);
      }
      if (prop === 'createTextNode') {
        return (content) => new Proxy({ type: 'text', text: content, attributes: {} }, handler3);
      }
      if (prop === 'setAttribute') {
        return (name, value) => {
          source.attributes[name] = value;
        };
      }
      return Reflect.get(target, prop);
    },
  };

  DOMSerializer.fromSchema(schema)
    .serializeFragment(json.content, { document: new Proxy({}, handler3) });

  // convert table to blocks
  const { children } = fragment;
  fragment.children = [];
  children.forEach((child) => {
    if (child.type === 'table') {
      tableToBlock(child, fragment);
    } else if (child.type === 'da-diff-deleted'
      // da-loc-* temporary code to support old regional edits
      || child.type === 'da-loc-deleted' || child.type === 'da-loc-added') {
      // eslint-disable-next-line no-param-reassign
      delete child.attributes.contenteditable;
      const locChildren = child.children;
      // eslint-disable-next-line no-param-reassign
      child.children = [];
      locChildren.forEach((locChild) => {
        if (locChild.type === 'table') {
          tableToBlock(locChild, child);
        } else {
          child.children.push(locChild);
        }
      });
      fragment.children.push(child);
    } else if (child.type === 'da-diff-added') {
      // unwrap the content inside of da-diff-added
      const locChildren = child.children;
      locChildren.forEach((locChild) => {
        if (locChild.type === 'table') {
          tableToBlock(locChild, fragment);
        } else {
          fragment.children.push(locChild);
        }
      });
    } else {
      fragment.children.push(child);
    }
  });

  // convert sections
  const section = { type: 'div', attributes: {}, children: [] };
  const sections = [...fragment.children].reduce((acc, child) => {
    if (child.type === 'hr') {
      acc.push({ type: 'div', attributes: {}, children: [] });
    } else {
      acc[acc.length - 1].children.push(child);
    }
    return acc;
  }, [section]);

  const text = sections.map((s) => tohtml(s)).join('');

  let daHTML = '';
  if (Object.keys(daMetadata).length > 0) {
    const daRows = Object.entries(daMetadata)
      .map(([key, value]) => `<div><div>${key}</div><div>${value}</div></div>`)
      .join('');
    daHTML = `\n  <div class="da-metadata">${daRows}</div>`;
  }

  return `
<body>
  <header></header>
  <main>${text}</main>
  <footer></footer>${daHTML}
</body>
`;
}
