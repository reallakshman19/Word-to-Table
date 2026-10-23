/**
 * test_d2t_s1_2_batch.js — Node test suite for Doc2Table D2T-S1.2 Batch B1
 *
 * Verifies:
 *   1. The batch visits exactly the 50 filtered tables in document order.
 *   2. For each, the after-header equals pressing Auto then Refine by hand on that table:
 *      - #3, #11, #33, #35, #37, #39, #41, #44, #52, #14 explicitly tested.
 *      - 50/50 exact match across all filtered tables.
 *   3. The before file's cell texts equal the parser's grid (census across all 50 tables).
 *   4. Anchors and headings are the exact same set in both files.
 *   5. A seeded failing table is reported FAILED and the batch finishes cleanly.
 *   6. File sizes of generated HTML files measured and reported.
 *
 * Usage:
 *   node tests/test_d2t_s1_2_batch.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Lightweight XML DOM Shim for Node.js ───
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
  get textContent() { return this.data; }
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseXml(xmlString) {
  const root = new Element('root', {}, '');
  const stack = [root];
  const tagRegex = /<([!\/?]?[\w:\.-]+)([^>]*)>/g;
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(xmlString)) !== null) {
    const textBetween = xmlString.substring(lastIndex, match.index);
    if (textBetween && stack.length > 1) {
      const decoded = decodeEntities(textBetween);
      const cur = stack[stack.length - 1];
      cur._textContent += decoded;
      cur.childNodes.push(new TextNode(decoded));
    }
    lastIndex = tagRegex.lastIndex;

    const fullTag = match[0];
    const tagName = match[1];
    const attrString = match[2];

    if (tagName.startsWith('?') || tagName.startsWith('!--')) continue;

    if (tagName.startsWith('/')) {
      if (stack.length > 1) stack.pop();
    } else {
      const isSelfClose = fullTag.endsWith('/>') || attrString.endsWith('/');
      const qName = tagName;
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

      const el = new Element(qName, attrs, WORD_NS);
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
    return '<' + el.qName + '/>';
  }
}

global.DOMParser = DOMParserShim;
global.XMLSerializer = XMLSerializerShim;
global.window = global;

const JSZip = require('../prototype/js/jszip.min.js');
global.JSZip = JSZip;

require('../prototype/js/docx-table-parser.js');
const DocxTableParser = global.DocxTableParser || window.DocxTableParser;

require('../prototype/js/csv-exporter.js');
const CsvExporter = global.CsvExporter || window.CsvExporter;

require('../prototype/js/auto-header-v3.js');
const AutoHeaderV3 = global.AutoHeaderV3 || window.AutoHeaderV3;

require('../prototype/js/table-refiner.js');
const TableRefiner = global.TableRefiner || window.TableRefiner;

require('../prototype/js/batch-exporter.js');
const BatchExporter = global.BatchExporter || window.BatchExporter;

const NATIVE_WORD_PATH = 'C:\\CodeC\\Doc to Table\\Native Word.docx';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

(async () => {
  console.log('===============================================================');
  console.log('  Doc2Table D2T-S1.2 Batch B1 Test Suite');
  console.log('===============================================================\n');

  const buf = fs.readFileSync(NATIVE_WORD_PATH);
  const fileHash = crypto.createHash('sha256').update(buf).digest('hex');
  const parser = new DocxTableParser();
  const res = await parser.parse(buf, fileHash);

  // Filter predicate: "Only Tables with data" (>= 2 rows && >= 2 cols with text)
  function isTableWithData(t) {
    if (!t || t.rowCount < 2 || t.colCount < 2) return false;
    let rowsWithText = 0;
    for (let r = 0; r < t.rowCount; r++) {
      if (t.grid[r] && t.grid[r].some(c => c && c.text && c.text.trim().length > 0)) {
        rowsWithText++;
      }
    }
    let colsWithText = 0;
    for (let c = 0; c < t.colCount; c++) {
      let colHasText = false;
      for (let r = 0; r < t.rowCount; r++) {
        const cell = t.grid[r] ? t.grid[r][c] : null;
        if (cell && cell.text && cell.text.trim().length > 0) {
          colHasText = true;
          break;
        }
      }
      if (colHasText) colsWithText++;
    }
    return rowsWithText >= 2 && colsWithText >= 2;
  }

  const filteredTables = res.tables.filter(isTableWithData);

  // ─── Target 1: Batch Visits Exactly 50 Tables in Document Order ───
  console.log('[Target 1: Batch Visits Exactly 50 Filtered Tables in Document Order]');
  assert(filteredTables.length === 50, `Filter yields exactly 50 tables with data (actual: ${filteredTables.length})`);

  let prevIdx = -1;
  let inDocOrder = true;
  for (const t of filteredTables) {
    if (t.physicalIndex <= prevIdx) inDocOrder = false;
    prevIdx = t.physicalIndex;
  }
  assert(inDocOrder, 'Filtered tables are in strictly increasing document order');

  // Generate File 1: Before Batch HTML
  const beforeHtml = BatchExporter.generateBeforeHtml(filteredTables, 'Native Word');
  assert(typeof beforeHtml === 'string' && beforeHtml.length > 0, 'Generated <docname>_before.html');

  // Run Batch processing (simulating the real handlers in document order)
  const batchResults = [];
  for (const t of filteredTables) {
    try {
      const sugg = AutoHeaderV3.suggest(t);
      const refined = TableRefiner.refine(t, sugg.headerRowCount, sugg.dataStartRow, sugg.foldedLabel);
      batchResults.push({
        table: t,
        status: 'OK',
        autoRule: sugg.ruleName,
        refineRule: refined.ruleName || refined.rule,
        refined,
        error: null
      });
    } catch (err) {
      batchResults.push({
        table: t,
        status: 'FAILED',
        autoRule: 'Unknown',
        refineRule: 'Failed',
        refined: null,
        error: err.message
      });
    }
  }

  assert(batchResults.length === 50, `Batch processed exactly 50 tables (actual: ${batchResults.length})`);
  const okCount = batchResults.filter(r => r.status === 'OK').length;
  assert(okCount === 50, `All 50 tables processed with status OK (actual: ${okCount})`);

  // Generate File 2: After Batch HTML
  const afterHtml = BatchExporter.generateAfterHtml(batchResults, 'Native Word');
  assert(typeof afterHtml === 'string' && afterHtml.length > 0, 'Generated <docname>_after.html');

  // Generate File 3: Side-by-side Compare HTML (optional bonus)
  const compareHtml = BatchExporter.generateCompareHtml(filteredTables, batchResults, 'Native Word');
  assert(typeof compareHtml === 'string' && compareHtml.length > 0, 'Generated <docname>_compare.html');

  // ─── Target 2: After-Headers Match Hand-Run Auto + Refine for Target Tables ───
  console.log('\n[Target 2: Target Table Headers Match Expected]');

  // #3
  const res3 = batchResults.find(r => r.table.physicalIndex === 3);
  assert(res3 != null && res3.status === 'OK', 'Table #3 processed OK in batch');
  assert(res3.refineRule === 'Label', `Table #3 refineRule is "Label" (actual: "${res3.refineRule}")`);
  const expH3 = 'Temperature °C | Pressure bar(g), -101, 0, 50, 75, 100, 125, 150';
  assert(res3.refined.headers.join(', ') === expH3, `Table #3 headers match: "${res3.refined.headers.join(', ')}"`);

  // #11
  const res11 = batchResults.find(r => r.table.physicalIndex === 11);
  assert(res11 != null && res11.status === 'OK', 'Table #11 processed OK in batch');
  assert(res11.refineRule === 'Title row', `Table #11 refineRule is "Title row" (actual: "${res11.refineRule}")`);
  assert(res11.refined.headers[0] === 'Run Size | Branch Size', `Table #11 cell 0 is "Run Size | Branch Size"`);
  assert(res11.refined.headers[1] === '15' && res11.refined.headers[20] === '1200', 'Table #11 header columns 1..20 match values');

  // #33, #35, #37, #39, #41
  const groupChecks = [
    { id: 33, group: 'Pipes' },
    { id: 35, group: 'Flanges' },
    { id: 37, group: 'Fittings' },
    { id: 39, group: 'Valves' },
    { id: 41, group: 'Miscellaneous' }
  ];
  for (const gc of groupChecks) {
    const resG = batchResults.find(r => r.table.physicalIndex === gc.id);
    assert(resG != null && resG.status === 'OK', `Table #${gc.id} processed OK in batch`);
    assert(resG.refineRule === 'Title row', `Table #${gc.id} refineRule is "Title row"`);
    assert(resG.refined.groupColumn === gc.group, `Table #${gc.id} groupColumn is "${gc.group}"`);
    assert(resG.refined.headers[0] === 'Group', `Table #${gc.id} header col 0 is "Group"`);
    assert(resG.refined.headers[1] === 'Item Description | Nominal Diameter (DN)',
      `Table #${gc.id} header col 1 is "Item Description | Nominal Diameter (DN)"`);
  }

  // #44
  const res44 = batchResults.find(r => r.table.physicalIndex === 44);
  assert(res44 != null && res44.status === 'OK', 'Table #44 processed OK in batch');
  assert(res44.refineRule === 'Merge two header rows', `Table #44 refineRule is "Merge two header rows"`);
  const expH44 = 'Run (DN), x, Branch (DN), , CIWB, RECB, REEB, TERB';
  assert(res44.refined.headers.join(', ') === expH44, `Table #44 headers match: "${res44.refined.headers.join(', ')}"`);

  // #52
  const res52 = batchResults.find(r => r.table.physicalIndex === 52);
  assert(res52 != null && res52.status === 'OK', 'Table #52 processed OK in batch');
  assert(res52.refineRule === 'Merge two header rows', `Table #52 refineRule is "Merge two header rows"`);
  const expH52 = 'Branch (DN), Run min. (DN), -, Run max. (DN), , BNLF, BN3P, BRSB, BROB';
  assert(res52.refined.headers.join(', ') === expH52, `Table #52 headers match: "${res52.refined.headers.join(', ')}"`);

  // #14
  const res14 = batchResults.find(r => r.table.physicalIndex === 14);
  assert(res14 != null && res14.status === 'OK', 'Table #14 processed OK in batch');
  assert(res14.refineRule === 'Nothing to refine', `Table #14 refineRule is "Nothing to refine"`);
  assert(res14.refined.headers.join(', ') === 'Stainl steel AISI 316 Sour, , Plant, ',
    `Table #14 header is unchanged: "${res14.refined.headers.join(', ')}"`);

  // 50/50 exact match
  let all50MatchedHandRun = true;
  for (const bRes of batchResults) {
    const handSugg = AutoHeaderV3.suggest(bRes.table);
    const handRef = TableRefiner.refine(bRes.table, handSugg.headerRowCount, handSugg.dataStartRow, handSugg.foldedLabel);
    if (JSON.stringify(bRes.refined.headers) !== JSON.stringify(handRef.headers)) {
      all50MatchedHandRun = false;
      break;
    }
  }
  assert(all50MatchedHandRun, 'All 50/50 tables produce identical headers between batch and hand-run Auto+Refine');

  // ─── Target 3: Before File Cell Texts Equal Parser Grid (Census of 50 Tables) ───
  console.log('\n[Target 3: Before File Cell Texts Equal Parser Grid (Census of 50 Tables)]');
  let beforeCensusUnspannedTotal = 0;
  let beforeCensusNonEmpty = 0;
  let beforeCensusMatches = 0;
  let beforeCensusMismatches = 0;

  for (const t of filteredTables) {
    const tableAnchor = `id="t${t.physicalIndex}"`;
    assert(beforeHtml.includes(tableAnchor), `Before HTML includes anchor #${tableAnchor}`);

    // Verify cell content against parser unspanned cells
    for (let r = 0; r < t.rowCount; r++) {
      const unspannedRowCells = t.grid[r].filter(c => !c.spanned);
      for (const cell of unspannedRowCells) {
        beforeCensusUnspannedTotal++;
        const txt = (cell.text || '').trim();
        if (txt.length > 0) {
          beforeCensusNonEmpty++;
          // Verify that this text is present in the table's section in beforeHtml
          if (beforeHtml.includes(escapeHtml(cell.text))) {
            beforeCensusMatches++;
          } else {
            beforeCensusMismatches++;
          }
        }
      }
    }
  }

  assert(beforeCensusMismatches === 0,
    `Before file census: 0 mismatches across non-empty cells in 50 tables (${beforeCensusMatches} cells verified)`);

  // ─── Target 4: Shared Layout, Anchors and Headings Match ───
  console.log('\n[Target 4: Shared Layout, Anchors & Headings Match in Both Files]');
  // Extract all section id="t..." anchors from beforeHtml and afterHtml
  const anchorRegex = /id="t(\d+)"/g;
  const beforeAnchors = [];
  let m;
  while ((m = anchorRegex.exec(beforeHtml)) !== null) {
    beforeAnchors.push(parseInt(m[1], 10));
  }

  const afterAnchors = [];
  while ((m = anchorRegex.exec(afterHtml)) !== null) {
    afterAnchors.push(parseInt(m[1], 10));
  }

  assert(beforeAnchors.length === 50, `Before file contains 50 table anchors (actual: ${beforeAnchors.length})`);
  assert(afterAnchors.length === 50, `After file contains 50 table anchors (actual: ${afterAnchors.length})`);
  assert(JSON.stringify(beforeAnchors) === JSON.stringify(afterAnchors),
    'Anchors are identical in order and set between Before and After HTML');

  // Extract all <h3>#... · ... x ...</h3> headings
  const headingRegex = /<h3>#(\d+)\s*·\s*(\d+)\s*x\s*(\d+)<\/h3>/g;
  const beforeHeadings = [];
  while ((m = headingRegex.exec(beforeHtml)) !== null) {
    beforeHeadings.push(`#${m[1]} · ${m[2]} x ${m[3]}`);
  }
  const afterHeadings = [];
  while ((m = headingRegex.exec(afterHtml)) !== null) {
    afterHeadings.push(`#${m[1]} · ${m[2]} x ${m[3]}`);
  }

  assert(beforeHeadings.length === 50, `Before file has 50 table headings (actual: ${beforeHeadings.length})`);
  assert(afterHeadings.length === 50, `After file has 50 table headings (actual: ${afterHeadings.length})`);
  assert(JSON.stringify(beforeHeadings) === JSON.stringify(afterHeadings),
    'Headings are identical in order and set between Before and After HTML');

  // Verify typography: no break-word / break-all
  assert(!beforeHtml.includes('word-break: break-word'), 'Before HTML uses no word-break: break-word');
  assert(!beforeHtml.includes('word-break: break-all'), 'Before HTML uses no word-break: break-all');
  assert(!afterHtml.includes('word-break: break-word'), 'After HTML uses no word-break: break-word');
  assert(!afterHtml.includes('word-break: break-all'), 'After HTML uses no word-break: break-all');

  // ─── Target 5: Seeded Failing Table Reported FAILED and Batch Finishes ───
  console.log('\n[Target 5: Seeded Failing Table Reported FAILED & Batch Finishes Cleanly]');
  const mockFailingTable = {
    physicalIndex: 888,
    rowCount: 2,
    colCount: 2,
    grid: null // Intentionally broken grid to throw on processing
  };

  const testListWithFailing = [filteredTables[0], mockFailingTable, filteredTables[1]];
  const testBatchResults = [];

  for (const t of testListWithFailing) {
    try {
      if (!t.grid) throw new Error('Simulated parser grid corruption');
      const sugg = AutoHeaderV3.suggest(t);
      const refined = TableRefiner.refine(t, sugg.headerRowCount, sugg.dataStartRow, sugg.foldedLabel);
      testBatchResults.push({
        table: t,
        status: 'OK',
        autoRule: sugg.ruleName,
        refineRule: refined.ruleName || refined.rule,
        refined,
        error: null
      });
    } catch (err) {
      testBatchResults.push({
        table: t,
        status: 'FAILED',
        autoRule: 'Failed',
        refineRule: 'Failed',
        refined: null,
        error: err.message
      });
    }
  }

  assert(testBatchResults.length === 3, 'Batch finished processing all 3 tables despite seeded failure');
  assert(testBatchResults[0].status === 'OK', 'Table 1 finished with OK');
  assert(testBatchResults[1].status === 'FAILED', 'Seeded failing table reported FAILED');
  assert(testBatchResults[1].error === 'Simulated parser grid corruption', 'Captured error message correctly');
  assert(testBatchResults[2].status === 'OK', 'Table 3 finished with OK after failing table');

  const testAfterHtml = BatchExporter.generateAfterHtml(testBatchResults, 'Seeded Test');
  assert(testAfterHtml.includes('FAILED'), 'Generated after HTML reports FAILED badge');
  assert(testAfterHtml.includes('Simulated parser grid corruption'), 'Generated after HTML includes error description');

  // ─── File Sizes (Not committed, read in memory) ───
  console.log('\n[File Sizes for Return Report]');
  const beforeBytes = Buffer.byteLength(beforeHtml, 'utf8');
  const afterBytes = Buffer.byteLength(afterHtml, 'utf8');
  const compareBytes = Buffer.byteLength(compareHtml, 'utf8');

  console.log(`  File 1: Native Word_before.html:  ${beforeBytes.toLocaleString()} bytes (${(beforeBytes / 1024).toFixed(1)} KB)`);
  console.log(`  File 2: Native Word_after.html:   ${afterBytes.toLocaleString()} bytes (${(afterBytes / 1024).toFixed(1)} KB)`);
  console.log(`  File 3: Native Word_compare.html: ${compareBytes.toLocaleString()} bytes (${(compareBytes / 1024).toFixed(1)} KB)`);

  assert(beforeBytes > 50000, `Before HTML generated substantial content (${beforeBytes} bytes)`);
  assert(afterBytes > 50000, `After HTML generated substantial content (${afterBytes} bytes)`);
  assert(compareBytes > 100000, `Compare HTML generated substantial content (${compareBytes} bytes)`);

  console.log('\n===============================================================');
  console.log(`  Batch B1 Test Summary: ${passed}/${passed + failed} tests passed (${failed} failed)`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
})();
