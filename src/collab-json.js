/*
 * Copyright 2026 Adobe. All rights reserved.
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

const MIN_DIMENSIONS = 20;
const SHEET_TEMPLATE = { minDimensions: [MIN_DIMENSIONS, MIN_DIMENSIONS], sheetName: 'data' };

function getSheetData(sheetData) {
  if (!sheetData?.length) return [[], []];
  const header = Object.keys(sheetData[0]).map((key) => key);
  const data = sheetData.reduce((acc, item) => {
    const values = Object.keys(item).map((key) => item[key]);
    acc.push(values);
    return acc;
  }, []);
  return [header, ...data];
}

function getSheet(json, sheetName) {
  const data = getSheetData(json.data);
  const templ = { ...SHEET_TEMPLATE };

  // Ensure data is padded to minDimensions
  const [minRows, minCols] = templ.minDimensions;

  // Pad rows
  while (data.length < minRows) {
    data.push([]);
  }

  // Pad columns in each row
  for (let i = 0; i < data.length; i += 1) {
    while (data[i].length < minCols) {
      data[i].push('');
    }
  }

  // Create columns array that matches the data width
  const numColumns = Math.max(minCols, data[0]?.length || 0);

  return {
    ...templ,
    sheetName,
    data,
    columns: new Array(numColumns).fill(null).map(() => ({ width: '50' })),
  };
}

export function getSheets(json) {
  const sheets = [];

  // Single sheet
  if (json[':type'] === 'sheet') {
    sheets.push(getSheet(json, json[':sheetname'] || 'data'));
  }

  // Multi sheet
  const names = json[':names'];
  if (names) {
    names.forEach((sheetName) => {
      sheets.push(getSheet(json[sheetName], sheetName));
    });
  }

  const privateSheets = json[':private'];
  if (privateSheets) {
    Object.keys(privateSheets).forEach((sheetName) => {
      sheets.push(getSheet(privateSheets[sheetName], sheetName));
    });
  }

  return sheets;
}

/**
 * Helper: Convert a row array to Y.XmlElement with cell children
 * @param {Array} row - Row array
 * @returns {Y.XmlElement} - Y.XmlElement 'row' with 'cell' children (value stored as attribute)
 */
function rowToY(row) {
  const yrow = new Y.XmlElement('row');
  row.forEach((cellValue, idx) => {
    const ycell = new Y.XmlElement('cell');
    ycell.setAttribute('value', String(cellValue || ''));
    yrow.insert(idx, [ycell]);
  });

  if (row.length < MIN_DIMENSIONS) {
    for (let i = row.length; i < MIN_DIMENSIONS; i += 1) {
      const ycell = new Y.XmlElement('cell');
      ycell.setAttribute('value', '');
      yrow.insert(i, [ycell]);
    }
  }

  return yrow;
}

/**
 * Convert a 2D data array to Y.XmlFragment structure (initial population only)
 * Internal helper function - only used for initial conversion in jSheetToY
 * @param {Array} data - 2D array of cell values
 * @param {Y.XmlFragment} ydata - Y.XmlFragment to populate
 */
function dataArrayToY(data, ydata) {
  // Clear existing data
  if (ydata.length > 0) {
    ydata.delete(0, ydata.length);
  }

  // Populate with new data
  if (data) {
    data.forEach((row, idx) => {
      const yrow = rowToY(row);
      ydata.insert(idx, [yrow]);
    });
  }

  if (data.length < MIN_DIMENSIONS) {
    for (let i = data.length; i < MIN_DIMENSIONS; i += 1) {
      const yrow = rowToY([]);
      ydata.insert(i, [yrow]);
    }
  }
}

/**
 * Convert jSpreadsheet sheet data to Yjs structure
 * @param {Array} sheets - Array of sheet objects from getSheets()
 * @returns {Object} - Object containing ydoc and ysheets array
 */
export function jSheetToY(sheets, ydoc) {
  const ysheets = ydoc.getArray('sheets');

  sheets.forEach((sheet) => {
    const ysheet = new Y.Map();

    // Set basic properties
    ysheet.set('sheetName', sheet.sheetName);

    // Set minDimensions - wrap in array to push as single element
    const yMinDimensions = new Y.Array();
    if (sheet.minDimensions) {
      yMinDimensions.push([sheet.minDimensions]);
    }
    ysheet.set('minDimensions', yMinDimensions);

    // Convert data array using helper function
    // Data should already be padded by getSheet
    const ydata = new Y.XmlFragment();
    dataArrayToY(sheet.data, ydata);
    ysheet.set('data', ydata);

    // Convert columns array to Y.Array of Y.Maps
    const ycolumns = new Y.Array();
    if (sheet.columns) {
      sheet.columns.forEach((col) => {
        const ycol = new Y.Map();
        Object.entries(col).forEach(([key, value]) => {
          ycol.set(key, value);
        });
        ycolumns.push([ycol]);
      });
    }
    ysheet.set('columns', ycolumns);

    ysheets.push([ysheet]);
  });

  return ysheets;
}

/**
 * Convert Y.XmlFragment structure back to 2D data array
 * Internal helper function - only used in yToJSheet
 * @param {Y.XmlFragment} ydata - Y.XmlFragment containing row elements
 * @returns {Array} - 2D array of cell values
 */
function yToDataArray(ydata) {
  const data = [];
  if (ydata) {
    ydata.forEach((yrow) => {
      // Each yrow is a Y.XmlElement 'row' containing Y.XmlElement 'cell' children
      const row = [];
      yrow.forEach((ycell) => {
        // Get cell value from attribute
        const cellValue = ycell.getAttribute('value') || '';
        row.push(cellValue);
      });
      data.push(row);
    });
  }
  return data;
}

function formatSheetData(jData) {
  const data = jData.reduce((acc, row, idx) => {
    if (idx > 0) { // Skip header row
      const rowObj = {};
      row.forEach((value, rowIdx) => {
        if (jData[0][rowIdx]) { // jData[0] is header row
          rowObj[jData[0][rowIdx]] = value;
        }
      });
      acc.push(rowObj);
    }
    return acc;
  }, []);

  // Remove trailing empty rows
  while (data.length > 1 && !Object.values(data.slice(-1)[0]).some(Boolean)) {
    data.pop();
  }

  return data;
}

function yToJSheet(ysheets) {
  const sheets = [];

  ysheets.forEach((ysheet) => {
    const sheet = {};

    // Get basic properties
    sheet.sheetName = ysheet.get('sheetName');

    // Get minDimensions - it was wrapped in array, so unwrap it
    const yMinDimensions = ysheet.get('minDimensions');
    if (yMinDimensions && yMinDimensions.length > 0) {
      // eslint-disable-next-line prefer-destructuring
      sheet.minDimensions = yMinDimensions.toArray()[0];
    }

    // Convert Y.XmlFragment data back to regular arrays using helper function
    const ydata = ysheet.get('data');
    sheet.data = yToDataArray(ydata);

    // Convert Y.Array columns back to regular array of objects
    const ycolumns = ysheet.get('columns');
    sheet.columns = [];
    if (ycolumns) {
      ycolumns.forEach((ycol) => {
        const col = {};
        ycol.forEach((value, key) => {
          col[key] = value;
        });
        sheet.columns.push(col);
      });
    }

    sheets.push(sheet);
  });

  return sheets;
}

const EMPTY_JSON = [{ ...SHEET_TEMPLATE }];

export function json2doc(json, ydoc) {
  const jsonToConvert = Object.keys(json ?? {}).length === 0 ? EMPTY_JSON : json;
  const sheets = getSheets(jsonToConvert);
  const ySheets = jSheetToY(sheets, ydoc);
  return ySheets;
}

export function doc2json(yDoc) {
  const ysheets = yDoc.getArray('sheets');
  const sheets = yToJSheet(ysheets);

  const getSheetProps = (sheet) => {
    const data = formatSheetData(sheet.data);
    return {
      total: data.length,
      limit: data.length,
      offset: 0,
      data,
      ':colWidths': sheet.columns.map((col) => col.width),
    };
  };

  const { publicSheets, privateSheets } = sheets.reduce((acc, sheet) => {
    if (sheet.sheetName.startsWith('private-')) {
      acc.privateSheets[sheet.sheetName] = getSheetProps(sheet);
    } else {
      acc.publicSheets[sheet.sheetName] = getSheetProps(sheet);
    }
    return acc;
  }, { publicSheets: {}, privateSheets: {} });

  const publicNames = Object.keys(publicSheets);
  const privateNames = Object.keys(privateSheets);

  let json = {};
  if (publicNames.length > 1) {
    json = publicSheets;
    json[':names'] = publicNames;
    json[':version'] = 3;
    json[':type'] = 'multi-sheet';
  } else if (publicNames.length === 1) {
    const sheetName = publicNames[0];
    json = publicSheets[sheetName];
    json[':sheetname'] = sheetName;
    json[':type'] = 'sheet';
  }

  if (privateNames.length > 0) {
    json[':private'] = privateSheets;
  }
  return JSON.stringify(json);
}
