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

  if (child.properties.dataId) {
    table.properties.dataId = child.properties.dataId;
  }

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
    node.children.forEach((child) => {
      if (child.tagName === 'a' && child.children?.length > 0) {
        const { href, title } = child.properties;

        child.children.forEach((linkChild) => {
          if (linkChild.tagName === 'picture') {
            linkChild.children.forEach((pictureChild) => {
              if (pictureChild.tagName === 'img') {
                // eslint-disable-next-line no-param-reassign
                pictureChild.properties = {
                  ...pictureChild.properties,
                  href,
                  title,
                };
              }
            });
          } else if (linkChild.tagName === 'img') {
            // eslint-disable-next-line no-param-reassign
            linkChild.properties = {
              ...linkChild.properties,
              href,
              title,
            };
          }
        });
      } else {
        fixImageLinks(child);
      }
    });
  }

  return node;
}

export function aem2doc(html, ydoc) {
  const tree = fromHtml(html, { fragment: true });
  const main = tree.children.find((child) => child.tagName === 'main');
  fixImageLinks(main);
  (main.children || []).forEach((parent) => {
    if (parent.tagName === 'div' && parent.children) {
      const children = [];
      let modified = false;
      parent.children.forEach((child) => {
        if (child.tagName === 'div' && child.properties.className?.length > 0) {
          modified = true;
          blockToTable(child, children);
        } else if (child.tagName === 'da-loc-deleted' || child.tagName === 'da-loc-added') {
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
  main.children = main.children.flatMap((node) => {
    const result = [];
    if (node.tagName === 'div') {
      if (count > 0) {
        result.push({
          type: 'element', tagName: 'p', children: [], properties: {},
        });
        result.push({
          type: 'element', tagName: 'hr', children: [], properties: {},
        });
        result.push({
          type: 'element', tagName: 'p', children: [], properties: {},
        });
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
          if (name === 'colspan') {
            // when `tree` is created using `fromHtml` in hast-util-from-html
            // that then calls fromParse5 in hast-util-from-parse5
            // which converts the `colspan` attribute to `colSpan`
            // eslint-disable-next-line no-param-reassign
            name = 'colSpan';
          }
          return target.properties ? target.properties[name] : undefined;
        };
      }

      if (prop === 'hasAttribute') {
        return (name) => target.properties && target.properties[name];
      }

      if (prop === 'style') {
        return {};
      }

      return Reflect.get(target, prop);
    },
  };

  const json = DOMParser.fromSchema(getSchema()).parse(new Proxy(main, handler2));
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
    if (node.type === 'img' && !attributes.loading) {
      attrString += ' loading="lazy"';
    }
    if (node.type === 'img') {
      const { href, src, title } = attributes;
      if (attributes.href) {
        delete attributes.href;
        delete attributes.title;
        attrString = getAttrString(attributes);
        const titleStr = title ? ` title="${title}"` : '';
        return `<a href="${href}"${titleStr}><picture><source srcset="${src}"><source srcset="${src}" media="(min-width: 600px)"><img${attrString}></picture></a>`;
      }
      return `<picture><source srcset="${src}"><source srcset="${src}" media="(min-width: 600px)"><img${attrString}></picture>`;
    }

    const result = node.type !== 'br' ? `<${node.type}${attrString}></${node.type}>` : `<${node.type}>`;

    return result;
  }
  let { children } = node;
  if (node.type === 'li') {
    if (children.length === 1) {
      if (children[0].type === 'p') {
        children = children[0].children;
      }
    }
  }
  if (node.type === 'p') {
    if (children.length === 1) {
      if (children[0].type === 'img') {
        return children.map((child) => tohtml(child)).join('');
      }
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
  const dataId = child?.attributes?.dataId;
  if (dataId) block.attributes['data-id'] = dataId;
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
  const json = yDocToProsemirror(schema, ydoc);

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
    } else if (child.type === 'da-loc-deleted' || child.type === 'da-loc-added') {
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
  return `
<body>
  <header></header>
  <main>${text}</main>
  <footer></footer>
</body>
`;
}
