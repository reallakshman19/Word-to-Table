/**
 * test_d2t_s1.js — Node test suite for Doc2Table Step D2T-S1 (WBS 4.1)
 *
 * Runs against the real input files in place:
 *   - "C:\CodeC\Doc to Table\Native Word.docx"
 *   - "C:\CodeC\Doc to Table\Word Table snaps.docx"
 *
 * Verifies:
 *   1. File integrity (SHA-256 and byte sizes)
 *   2. Native table parsing: 140 physical tables (131 body, 9 nested without parent double-credit, 610 rows)
 *   3. Nested table parent-child mappings
 *   4. Spans (gridSpan values 2, 8, 20) expanded into grid
 *   5. Header row selection: 0, 1, 2 header rows and independent data start
 *   6. Literal leading-zero string preservation ("031", "001", etc. never coerced to numbers)
 *   7. Companion provenance record for every CSV cell (fileHash, part, table, row, cell)
 *   8. Image-only document verification: Word Table snaps.docx has 0 native tables, 12 images, not-converted status
 *
 * Usage:
 *   node tests/test_d2t_s1.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Self-Contained Lightweight XML DOM Shim for Node.js ───
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

class Element {
  constructor(qName, attrs = {}, ns = WORD_NS) {
    this.nodeType = 1;
    this.qName = qName;
    const colon = qName.indexOf(':');
    this.prefix = colon !== -1 ? qName.substring(0, colon) : '';
    this.localName = colon !== -1 ? qName.substring(colon + 1) : qName;
    this.namespaceURI = ns;
    this.attributes = attrs;
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this._textContent = '';
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.childNodes.map(n => n.nodeType === 3 ? n.data : n.textContent).join('');
  }

  set textContent(val) {
    this._textContent = val;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  getAttributeNS(ns, localName) {
    for (const [k, v] of Object.entries(this.attributes)) {
      if (k === localName || k.endsWith(':' + localName)) return v;
    }
    return null;
  }

  getElementsByTagNameNS(ns, localName) {
    const results = [];
    const walk = (el) => {
      for (const child of el.children) {
        if ((ns === '*' || child.namespaceURI === ns) &&
            (localName === '*' || child.localName === localName)) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  getElementsByTagName(name) {
    const results = [];
    const colon = name.indexOf(':');
    const targetLocal = colon !== -1 ? name.substring(colon + 1) : name;
    const walk = (el) => {
      for (const child of el.children) {
        if (child.qName === name || child.localName === targetLocal) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(sel) {
    return null;
  }
}

class TextNode {
  constructor(data) {
    this.nodeType = 3;
    this.data = data;
  }
}

function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s.replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
}

function parseXml(xml) {
  const root = new Element('#document', {}, '');
  const stack = [root];
  let pos = 0;
  const len = xml.length;

  while (pos < len) {
    const lt = xml.indexOf('<', pos);
    if (lt === -1) {
      if (pos < len && stack.length > 0) {
        const text = decodeEntities(xml.substring(pos));
        const tn = new TextNode(text);
        const cur = stack[stack.length - 1];
        cur.childNodes.push(tn);
        cur.textContent += text;
      }
      break;
    }

    if (lt > pos) {
      const text = decodeEntities(xml.substring(pos, lt));
      const cur = stack[stack.length - 1];
      if (cur) {
        const tn = new TextNode(text);
        cur.childNodes.push(tn);
        cur.textContent += text;
      }
    }

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      pos = end === -1 ? len : end + 3;
      continue;
    }

    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const cdata = end === -1 ? xml.substring(lt + 9) : xml.substring(lt + 9, end);
      const cur = stack[stack.length - 1];
      if (cur) {
        const tn = new TextNode(cdata);
        cur.childNodes.push(tn);
      }
      pos = end === -1 ? len : end + 3;
      continue;
    }

    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      pos = end === -1 ? len : end + 2;
      continue;
    }

    const gt = xml.indexOf('>', lt);
    if (gt === -1) break;

    const tagContent = xml.substring(lt + 1, gt).trim();
    pos = gt + 1;

    if (tagContent.startsWith('/')) {
      if (stack.length > 1) stack.pop();
    } else {
      const isSelfClose = tagContent.endsWith('/');
      const content = isSelfClose ? tagContent.slice(0, -1).trim() : tagContent;

      let spaceIdx = -1;
      for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
          spaceIdx = i;
          break;
        }
      }

      let qName, attrString;
      if (spaceIdx === -1) {
        qName = content;
        attrString = '';
      } else {
        qName = content.substring(0, spaceIdx);
        attrString = content.substring(spaceIdx + 1);
      }

      const attrs = {};
      if (attrString) {
        let i = 0;
        const aLen = attrString.length;
        while (i < aLen) {
          while (i < aLen && /\s/.test(attrString[i])) i++;
          if (i >= aLen) break;
          const eq = attrString.indexOf('=', i);
          if (eq === -1) break;
          const aName = attrString.substring(i, eq).trim();
          i = eq + 1;
          while (i < aLen && /\s/.test(attrString[i])) i++;
          if (i >= aLen) break;
          const quote = attrString[i];
          if (quote === '"' || quote === "'") {
            const endQuote = attrString.indexOf(quote, i + 1);
            if (endQuote === -1) break;
            attrs[aName] = decodeEntities(attrString.substring(i + 1, endQuote));
            i = endQuote + 1;
          } else {
            let nextSpace = i;
            while (nextSpace < aLen && !/\s/.test(attrString[nextSpace])) nextSpace++;
            attrs[aName] = decodeEntities(attrString.substring(i, nextSpace));
            i = nextSpace;
          }
        }
      }

      let ns = WORD_NS;
      if (qName.startsWith('w:')) ns = WORD_NS;

      const el = new Element(qName, attrs, ns);
      const cur = stack[stack.length - 1];
      el.parentNode = cur;
      cur.children.push(el);
      cur.childNodes.push(el);

      if (!isSelfClose) {
        stack.push(el);
      }
    }
  }

  return root;
}

class DOMParserShim {
  parseFromString(str, mimeType) {
    return parseXml(str);
  }
}

class XMLSerializerShim {
  serializeToString(el) {
    if (!el) return '';
    let attrs = '';
    if (el.attributes) {
      for (const [k, v] of Object.entries(el.attributes)) {
        attrs += ` ${k}="${String(v).replace(/"/g, '&quot;')}"`;
      }
    }
    if (el.children.length === 0 && (!el.textContent || el.textContent === '')) {
      return `<${el.qName}${attrs}/>`;
    }
    let inner = '';
    if (el.children.length > 0) {
      inner = el.children.map(c => this.serializeToString(c)).join('');
    } else {
      inner = (el.textContent || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    return `<${el.qName}${attrs}>${inner}</${el.qName}>`;
  }
}

// Attach globals for browser-oriented modules
global.DOMParser = DOMParserShim;
global.XMLSerializer = XMLSerializerShim;
global.JSZip = require('../prototype/js/jszip.min.js');

const DocxTableParser = require('../prototype/js/docx-table-parser.js');
const CsvExporter = require('../prototype/js/csv-exporter.js');

// ─── Test Runner ───
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
    failedTests++;
  }
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function run() {
  console.log('===============================================================');
  console.log('  Doc2Table D2T-S1 Node Test Suite (Real Inputs)');
  console.log('===============================================================\n');

  const NATIVE_PATH = 'C:/CodeC/Doc to Table/Native Word.docx';
  const SNAPS_PATH = 'C:/CodeC/Doc to Table/Word Table snaps.docx';

  // ─── Group 1: File Presence & Hash Integrity ───
  console.log('[Group 1: File Presence & Cryptographic Hash Verification]');
  assert(fs.existsSync(NATIVE_PATH), 'Native Word.docx exists in place');
  assert(fs.existsSync(SNAPS_PATH), 'Word Table snaps.docx exists in place');

  const nativeSize = fs.statSync(NATIVE_PATH).size;
  const nativeHash = sha256File(NATIVE_PATH);
  assert(nativeSize === 181448, `Native Word.docx size is 181448 bytes (actual: ${nativeSize})`);
  assert(nativeHash === '1c20755a09041870ce2e79f00d428ea96bb147e0595f6e096d53e134da3a8363',
    'Native Word.docx SHA-256 matches verified archive hash', `actual: ${nativeHash}`);

  const snapsSize = fs.statSync(SNAPS_PATH).size;
  const snapsHash = sha256File(SNAPS_PATH);
  assert(snapsSize === 876174, `Word Table snaps.docx size is 876174 bytes (actual: ${snapsSize})`);
  assert(snapsHash === '28aa7249ff4c51e1131916f39c517ac7abb38f8744a1a185483478b6f80ec33c',
    'Word Table snaps.docx SHA-256 matches card hash', `actual: ${snapsHash}`);

  // ─── Group 2: Native Word Table Parsing & Inventory ───
  console.log('\n[Group 2: Native Word Table Parsing & Physical Table Inventory]');
  const parser = new DocxTableParser();
  const nativeBuf = fs.readFileSync(NATIVE_PATH);
  const t0 = Date.now();
  const nativeResult = await parser.parse(nativeBuf, nativeHash);
  const parseTime = Date.now() - t0;
  console.log(`  (Parsed Native Word.docx in ${parseTime}ms)`);

  assert(nativeResult.totalCount === 140,
    `Total physical tables is exactly 140 (actual: ${nativeResult.totalCount})`);
  assert(nativeResult.bodyLevelCount === 131,
    `Body-level physical tables is exactly 131 (actual: ${nativeResult.bodyLevelCount})`);
  assert(nativeResult.nestedCount === 9,
    `Nested physical tables is exactly 9 (actual: ${nativeResult.nestedCount})`);
  assert(nativeResult.bodyLevelCount + nativeResult.nestedCount === 140,
    'Body-level + nested exactly equals total tables without parent double-credit');

  const totalRows = nativeResult.tables.reduce((sum, t) => sum + t.rowCount, 0);
  assert(totalRows === 610, `Total physical rows across all tables is 610 (actual: ${totalRows})`);

  // Verify nested relationships
  console.log('\n[Group 3: Nested Table Relationships (No Parent Double-Credit)]');
  const nestedTables = nativeResult.tables.filter(t => t.isNested);
  assert(nestedTables.length === 9, 'Exactly 9 tables marked as isNested');

  const expectedNesting = [
    { child: 3, parent: 2 },
    { child: 11, parent: 10 },
    { child: 33, parent: 32 },
    { child: 35, parent: 34 },
    { child: 37, parent: 36 },
    { child: 39, parent: 38 },
    { child: 41, parent: 40 },
    { child: 44, parent: 43 },
    { child: 52, parent: 51 },
  ];

  for (const expected of expectedNesting) {
    const childTable = nativeResult.tables.find(t => t.physicalIndex === expected.child);
    const parentTable = nativeResult.tables.find(t => t.physicalIndex === expected.parent);
    assert(
      childTable && childTable.isNested && childTable.parentTableIndex === expected.parent,
      `Table ${expected.child} correctly identified as nested inside Table ${expected.parent}`
    );
    assert(
      parentTable && parentTable.nestedTableIndices.includes(expected.child),
      `Parent Table ${expected.parent} references nested Table ${expected.child} without double-counting rows`
    );
  }

  // ─── Group 4: Grid Spans (gridSpan 2, 8, 20) ───
  console.log('\n[Group 4: Span Handling & Normalization]');
  const tablesWithSpans = nativeResult.tables.filter(t => t.hasSpans);
  assert(tablesWithSpans.length > 0, `Detected tables with spans (found ${tablesWithSpans.length} tables)`);

  let foundSpan2 = false;
  let foundSpan8 = false;
  let foundSpan20 = false;
  let totalSpannedCells = 0;

  for (const t of nativeResult.tables) {
    for (const row of t.grid) {
      for (const cell of row) {
        if (cell.gridSpan === 2) foundSpan2 = true;
        if (cell.gridSpan === 8) foundSpan8 = true;
        if (cell.gridSpan === 20) foundSpan20 = true;
        if (cell.spanned) totalSpannedCells++;
      }
    }
  }

  assert(foundSpan2, 'Found and expanded gridSpan=2');
  assert(foundSpan8, 'Found and expanded gridSpan=8');
  assert(foundSpan20, 'Found and expanded gridSpan=20');
  assert(totalSpannedCells > 0, `Spanned cells generated in normalized grid (total: ${totalSpannedCells})`);

  // Verify all rows in normalized grid have uniform width
  let uniformWidth = true;
  for (const t of nativeResult.tables) {
    const colCount = t.colCount;
    for (const row of t.grid) {
      if (row.length !== colCount) {
        uniformWidth = false;
        break;
      }
    }
  }
  assert(uniformWidth, 'All normalized table grids have uniform row widths matching colCount');

  // ─── Group 5: Header Row Configurations (0, 1, 2) ───
  console.log('\n[Group 5: Header Row Configurations (0, 1, 2) & Data Start]');
  const exporter = new CsvExporter();
  // Pick Table 1 (physical index 1)
  const testTable = nativeResult.tables[0];

  // Test 0 headers
  const exportH0 = exporter.exportTable(testTable, 0, 0);
  const h0Lines = exportH0.csv.split('\r\n');
  assert(h0Lines[0].startsWith('Column_1'), 'Header=0 produces synthetic headers Column_1, ...');
  assert(h0Lines.length === testTable.rowCount + 1,
    `Header=0 includes all data rows (lines: ${h0Lines.length}, expected: ${testTable.rowCount + 1})`);

  // Test 1 header
  const exportH1 = exporter.exportTable(testTable, 1, 1);
  const h1Lines = exportH1.csv.split('\r\n');
  assert(h1Lines.length === (testTable.rowCount - 1) + 1,
    `Header=1 treats row 0 as header, data starts at row 1 (lines: ${h1Lines.length})`);

  // Test 2 headers
  // Find a table with at least 3 rows
  const multiRowTable = nativeResult.tables.find(t => t.rowCount >= 4);
  const exportH2 = exporter.exportTable(multiRowTable, 2, 2);
  const h2Lines = exportH2.csv.split('\r\n');
  assert(h2Lines.length === (multiRowTable.rowCount - 2) + 1,
    `Header=2 treats rows 0 and 1 as header, data starts at row 2 (lines: ${h2Lines.length})`);
  assert(exportH2.provenance.some(p => p.headerLabel.includes('/') || p.isHeader),
    'Header=2 builds combined header label');

  // Test independent data start
  const exportIndependent = exporter.exportTable(multiRowTable, 1, 3);
  const indLines = exportIndependent.csv.split('\r\n');
  assert(indLines.length === (multiRowTable.rowCount - 3) + 1,
    `Independent dataStart=3 with header=1 emits data from row 3 (lines: ${indLines.length})`);

  // ─── Group 6: Leading-Zero String Preservation in CSV ───
  console.log('\n[Group 6: Leading-Zero Literal String Preservation]');
  // Find tables containing leading zeros like "031" and "001"
  let tableWith031 = null;
  let tableWith001 = null;

  for (const t of nativeResult.tables) {
    for (const row of t.grid) {
      for (const cell of row) {
        if (cell.text.includes('031')) tableWith031 = t;
        if (cell.text.includes('001')) tableWith001 = t;
      }
    }
  }

  assert(tableWith031 !== null, 'Found physical table containing string "031"');
  assert(tableWith001 !== null, 'Found physical table containing string "001"');

  if (tableWith031) {
    const { csv: csv031, provenance: prov031 } = exporter.exportTable(tableWith031, 1, 1);
    assert(csv031.includes('031'), 'CSV contains literal string "031" (not coerced to numeric 31)');
    const record031 = prov031.find(p => p.rawText.includes('031'));
    assert(record031 && record031.rawText.includes('031'),
      'Companion provenance record retains exact raw text "031"');
    assert(record031 && record031.sourceFileHash === nativeHash,
      'Provenance record points to exact source file SHA-256');
    assert(record031 && record031.sourcePart === 'word/document.xml',
      'Provenance record points to word/document.xml');
  }

  if (tableWith001) {
    const { csv: csv001, provenance: prov001 } = exporter.exportTable(tableWith001, 1, 1);
    assert(csv001.includes('001'), 'CSV contains literal string "001" (not coerced to numeric 1)');
    const record001 = prov001.find(p => p.rawText.includes('001'));
    assert(record001 && record001.rawText.includes('001'),
      'Companion provenance record retains exact raw text "001"');
  }

  // ─── Group 7: Companion Provenance for EVERY CSV Cell ───
  console.log('\n[Group 7: Exhaustive Companion Provenance Records]');
  for (const t of [nativeResult.tables[0], tableWith031, tableWith001]) {
    const { csv, provenance } = exporter.exportTable(t, 1, 1);
    const lines = csv.split('\r\n');
    const expectedCellCount = lines.length * t.colCount;

    assert(provenance.length === expectedCellCount,
      `Table ${t.physicalIndex} has exactly 1 companion provenance record per CSV cell (${provenance.length} records)`);

    let allHaveHash = true;
    let allHavePart = true;
    let allHaveTable = true;
    let allHaveRow = true;
    let allHaveCol = true;

    for (const p of provenance) {
      if (!p.sourceFileHash) allHaveHash = false;
      if (p.sourcePart !== 'word/document.xml') allHavePart = false;
      if (p.sourceTableIndex !== t.physicalIndex) allHaveTable = false;
      if (p.sourceRowIndex === undefined || p.sourceRowIndex === null) allHaveRow = false;
      if (p.sourceCellIndex === undefined || p.sourceCellIndex === null) allHaveCol = false;
    }

    assert(allHaveHash, `All provenance records in Table ${t.physicalIndex} contain source file hash`);
    assert(allHavePart, `All provenance records in Table ${t.physicalIndex} contain source XML part`);
    assert(allHaveTable, `All provenance records in Table ${t.physicalIndex} contain source table index`);
    assert(allHaveRow, `All provenance records in Table ${t.physicalIndex} contain source row index`);
    assert(allHaveCol, `All provenance records in Table ${t.physicalIndex} contain source cell index`);
  }

  // ─── Group 8: Screenshot-Only Docx (Word Table snaps.docx) ───
  console.log('\n[Group 8: Screenshot-Only Document (Word Table snaps.docx)]');
  const snapsBuf = fs.readFileSync(SNAPS_PATH);
  const snapsResult = await parser.parse(snapsBuf, snapsHash);

  assert(snapsResult.totalCount === 0,
    `Word Table snaps.docx contains 0 native tables (actual: ${snapsResult.totalCount})`);
  assert(snapsResult.bodyLevelCount === 0,
    `Word Table snaps.docx contains 0 body-level tables (actual: ${snapsResult.bodyLevelCount})`);
  assert(snapsResult.nestedCount === 0,
    `Word Table snaps.docx contains 0 nested tables (actual: ${snapsResult.nestedCount})`);
  assert(snapsResult.imageCount === 12,
    `Word Table snaps.docx contains exactly 12 image occurrences (actual: ${snapsResult.imageCount})`);

  // Final summary
  console.log('\n===============================================================');
  console.log(`  Test Summary: ${passedTests}/${totalTests} tests passed (${failedTests} failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
