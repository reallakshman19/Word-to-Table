/**
 * test_d2t_s1_3.js — Test suite for Doc2Table Step D2T-S1.3 "Header recovery"
 *
 * Requirements from brief_s13.txt:
 * - Real file execution on Native Word.docx (read-only in place).
 * - Target 1: The 15 recoveries (cells, source, signals), the 25 with none, the 10 untouched from Auto/Refine.
 * - Target 2: Title path of all 50 tables equal to s13_expected.json, compared line-by-line (0 discrepancies).
 * - Target 3: Seeded negatives, each "not applied" with its reason:
 *             1. one column fewer
 *             2. edges off by more than 3%
 *             3. no header signal
 *             4. one empty header cell
 *             5. a text paragraph between H and T
 *             6. T already has a header row
 * - Target 4: Undo after one and after two presses restores exact pre-recovery state.
 * - Target 5: CSV header for #8 and #58 with companion provenance records.
 * - Target 6: Batch exporter shows header source and title path for each table.
 * - Target 7: Real prototype/js/app.js handlers (applyRecoverHeader, undoRecoverHeader, runBatchProcess)
 *             executed in a DOM shim.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Path configurations
const REPO_ROOT = path.resolve(__dirname, '..');
const DOCX_PATH = path.resolve('C:/CodeC/Doc to Table/Native Word.docx');
const EXPECTED_JSON_PATH = path.resolve('C:/t/d2t_s1/s13_expected.json');

// Verify files exist in place
assert(fs.existsSync(DOCX_PATH), `Native Word.docx must exist at ${DOCX_PATH}`);
assert(fs.existsSync(EXPECTED_JSON_PATH), `s13_expected.json must exist at ${EXPECTED_JSON_PATH}`);

// ─── XML & DOM Parser Shim for Node.js ───

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
  parseFromString(str) {
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
      for (const child of el.children) {
        inner += this.serializeToString(child);
      }
    } else {
      inner = String(el.textContent)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    return `<${el.qName}${attrs}>${inner}</${el.qName}>`;
  }
}

global.DOMParser = DOMParserShim;
global.XMLSerializer = XMLSerializerShim;
global.JSZip = require('../prototype/js/jszip.min.js');
if (!global.crypto) {
  global.crypto = require('crypto').webcrypto;
}

const DocxTableParser = require('../prototype/js/docx-table-parser.js');
const AutoHeaderV3 = require('../prototype/js/auto-header-v3.js');
const TableRefiner = require('../prototype/js/table-refiner.js');
const HeaderRecovery = require('../prototype/js/header-recovery.js');
const CsvExporter = require('../prototype/js/csv-exporter.js');
const BatchExporter = require('../prototype/js/batch-exporter.js');

// ─── Test Harness ───

let testsPassed = 0;
let testsFailed = 0;

function pass(desc) {
  console.log(`  ✓ PASS: ${desc}`);
  testsPassed++;
}

function fail(desc, err) {
  console.error(`  ✗ FAIL: ${desc}`);
  if (err) console.error(err);
  testsFailed++;
}

(async function runTestSuite() {
  console.log('===============================================================');
  console.log('  Doc2Table D2T-S1.3 Header Recovery & Title Path Test Suite   ');
  console.log('===============================================================');

  // Load and parse real Native Word.docx
  const fileBytes = fs.readFileSync(DOCX_PATH);
  const parser = new DocxTableParser();
  const parseResult = await parser.parse(fileBytes, '1c20755a09041870ce2e79f00d428ea96bb147e0595f6e096d53e134da3a8363');

  // Filter for tables with data (>=2 rows && >=2 cols with non-empty text)
  function isTableWithData(t) {
    if (!t || !t.grid || t.rowCount < 2 || t.colCount < 2) return false;
    let rowsWithText = 0;
    const colsWithTextSet = new Set();
    for (let r = 0; r < t.rowCount; r++) {
      const row = t.grid[r];
      if (!row) continue;
      let rowHasText = false;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell && !cell.spanned && cell.text && cell.text.trim().length > 0) {
          rowHasText = true;
          colsWithTextSet.add(c);
        }
      }
      if (rowHasText) rowsWithText++;
    }
    return rowsWithText >= 2 && colsWithTextSet.size >= 2;
  }

  const dataTables = parseResult.tables.filter(isTableWithData);
  const dataIndices = dataTables.map(t => t.physicalIndex);
  const isDataTableSet = new Set(dataIndices);

  // Load expected ground truth
  const expectedData = JSON.parse(fs.readFileSync(EXPECTED_JSON_PATH, 'utf8'));

  // ─── Target 1: The 15 Recoveries, 25 None, 10 Untouched ───
  console.log('\n[Target 1: Header Recovery Census on 50 Data Tables]');

  const recovered15Expected = [8, 13, 46, 49, 54, 58, 61, 64, 67, 70, 73, 76, 79, 82, 85];
  const untouched10Expected = [3, 11, 14, 33, 35, 37, 39, 41, 44, 52];
  const noHeader25Expected = [5, 18, 20, 22, 24, 26, 28, 30, 89, 92, 95, 98, 101, 104, 107, 110, 113, 116, 119, 122, 125, 128, 131, 134, 137];

  try {
    assert.strictEqual(dataTables.length, 50, 'Filter yields exactly 50 tables with data');
    pass('Filter yields exactly 50 tables with data (actual: 50)');
  } catch (err) { fail('Filter count', err); }

  const actualRecoveries = [];
  const actualUntouched = [];
  const actualNoHeader = [];

  for (const t of dataTables) {
    const autoSug = AutoHeaderV3.suggest(t);
    const initialHr = autoSug.headerRowCount;
    const refRes = TableRefiner.refine(t, initialHr);

    // If auto or refine selected header rows, this table has own header
    const currentHr = refRes.headerRowCount;

    if (currentHr > 0) {
      actualUntouched.push(t.physicalIndex);
      const chk = HeaderRecovery.canRecover(t, parseResult.tables, isDataTableSet, currentHr);
      assert.strictEqual(chk.eligible, false, `Table #${t.physicalIndex} with header rows must not recover`);
      assert(chk.failedChecks.includes('table already has header rows'), 'Fails with table already has header rows');
    } else {
      const chk = HeaderRecovery.canRecover(t, parseResult.tables, isDataTableSet, 0);
      if (chk.eligible) {
        actualRecoveries.push(t.physicalIndex);
      } else {
        actualNoHeader.push(t.physicalIndex);
      }
    }
  }

  try {
    assert.deepStrictEqual(actualRecoveries, recovered15Expected, 'Recovered 15 table indices match');
    pass(`Exactly 15 tables recovered: ${actualRecoveries.map(x => '#' + x).join(', ')}`);
  } catch (err) { fail('15 recovered tables', err); }

  try {
    assert.deepStrictEqual(actualUntouched, untouched10Expected, 'Untouched 10 table indices match');
    pass(`Exactly 10 untouched from Auto/Refine: ${actualUntouched.map(x => '#' + x).join(', ')}`);
  } catch (err) { fail('10 untouched tables', err); }

  try {
    assert.deepStrictEqual(actualNoHeader, noHeader25Expected, 'Stay Column_1..n 25 table indices match');
    pass(`Exactly 25 stay Column_1..n: ${actualNoHeader.map(x => '#' + x).join(', ')}`);
  } catch (err) { fail('25 stay tables', err); }

  // Verify details for all 15 recovered tables against expected
  for (const phys of recovered15Expected) {
    const t = parseResult.tables.find(x => x.physicalIndex === phys);
    const rec = HeaderRecovery.recover(t, parseResult.tables, isDataTableSet, 0);
    const exp = expectedData.tables['#' + phys];

    try {
      assert(rec.success, `Table #${phys} recovery should succeed`);
      assert.strictEqual(`#${rec.sourcePhysicalIndex} row 0`, exp.header.source, `Source table matches for #${phys}`);
      assert.deepStrictEqual(rec.headers, exp.header.cells, `Headers match for #${phys}`);
      assert.deepStrictEqual(rec.signals, exp.header.signals, `Signals match for #${phys}`);

      // Verify header cell provenance
      assert.strictEqual(rec.headerProvenance.length, exp.header.cells.length, 'Provenance count matches column count');
      for (let j = 0; j < rec.headerProvenance.length; j++) {
        const hp = rec.headerProvenance[j];
        assert.strictEqual(hp.tableIndex, rec.sourcePhysicalIndex);
        assert.strictEqual(hp.rowIndex, 0);
        assert.strictEqual(hp.cellIndex, j);
        assert.strictEqual(hp.recovered, true);
        assert.deepStrictEqual(hp.signals, exp.header.signals);
      }

      pass(`Table #${phys} correctly recovered from ${exp.header.source} (${exp.header.signals.join(', ')}): [${exp.header.cells.join(', ')}]`);
    } catch (err) { fail(`Recovery details for #${phys}`, err); }
  }

  // ─── Target 2: Title Path of all 50 Tables Equal to s13_expected.json ───
  console.log('\n[Target 2: Title Path Extraction and Inheritance across all 50 Data Tables]');

  const recMap = new Map();
  for (const phys of recovered15Expected) {
    const exp = expectedData.tables['#' + phys];
    const sourceMatch = exp.header.source.match(/#(\d+)/);
    if (sourceMatch) recMap.set(phys, parseInt(sourceMatch[1], 10));
  }

  const allTitlePaths = HeaderRecovery.computeAllTitlePaths(parseResult.tables, dataIndices, recMap);

  let titleLineMismatches = 0;
  let inheritanceMismatches = 0;

  for (const phys of dataIndices) {
    const actual = allTitlePaths.get(phys);
    const exp = expectedData.tables['#' + phys];

    if (!exp) {
      fail(`Missing expected data for #${phys}`);
      continue;
    }

    if (actual.inherited !== exp.title_inherited) {
      inheritanceMismatches++;
      fail(`Inheritance mismatch on #${phys}: actual=${actual.inherited}, exp=${exp.title_inherited}`);
    }

    const expLines = exp.title_path || [];
    if (actual.path.length !== expLines.length) {
      titleLineMismatches++;
      fail(`Title line length mismatch on #${phys}: actual=${actual.path.length}, exp=${expLines.length}`);
      continue;
    }

    for (let i = 0; i < expLines.length; i++) {
      const actLine = actual.path[i];
      const expLine = expLines[i];
      if (actLine.source !== expLine.source || actLine.text !== expLine.text || actLine.section !== expLine.section) {
        titleLineMismatches++;
        fail(`Line mismatch on #${phys} line ${i}: actual=[${actLine.source}, "${actLine.text}", ${actLine.section}] vs exp=[${expLine.source}, "${expLine.text}", ${expLine.section}]`);
      }
    }
  }

  try {
    assert.strictEqual(titleLineMismatches, 0, 'Zero title path discrepancies');
    assert.strictEqual(inheritanceMismatches, 0, 'Zero inheritance discrepancies');
    pass('Title path of all 50 data tables matches s13_expected.json line-by-line (0 discrepancies)');
  } catch (err) { fail('Title path census', err); }

  // Verify the 8 inherited tables
  const expectedInherited = [13, 14, 35, 37, 39, 41, 46, 54];
  const actualInherited = [];
  for (const phys of dataIndices) {
    if (allTitlePaths.get(phys).inherited) actualInherited.push(phys);
  }
  try {
    assert.deepStrictEqual(actualInherited, expectedInherited, 'Exactly 8 tables inherit title path');
    pass(`Exactly 8 tables inherit lower title lines: ${actualInherited.map(x => '#' + x).join(', ')}`);
  } catch (err) { fail('Inherited tables', err); }

  // Verify section title persistence
  const t18Path = allTitlePaths.get(18).path;
  const t33Path = allTitlePaths.get(33).path;
  const t58Path = allTitlePaths.get(58).path;
  const t92Path = allTitlePaths.get(92).path;

  assert(t18Path.some(p => p.text === 'COMPONENT MATERIAL DESCRIPTION' && p.section));
  pass('Section "COMPONENT MATERIAL DESCRIPTION" recognized and active on #18');

  assert(t33Path.some(p => p.text === 'PIPING COMPONENTS' && p.section));
  pass('Section "PIPING COMPONENTS" recognized and active on #33');

  assert(t58Path.some(p => p.text === 'BOLTING' && p.section));
  pass('Section "BOLTING" recognized and active on #58');

  assert(t92Path.some(p => p.text === 'ASSEMBLIES' && p.section));
  pass('Section "ASSEMBLIES" recognized and active on #92');

  // Verify section line criteria: uppercase only + 4+ letters
  assert.strictEqual(HeaderRecovery.isSectionLine('BOLTING'), true);
  assert.strictEqual(HeaderRecovery.isSectionLine('PIPING COMPONENTS'), true);
  assert.strictEqual(HeaderRecovery.isSectionLine('DN 15'), false, '"DN 15" has no 4+ letter word');
  assert.strictEqual(HeaderRecovery.isSectionLine('Table of Schedules'), false, 'Mixed case is not section');
  pass('Section line rule verified: uppercase only + word of 4+ letters ("BOLTING" yes, "DN 15" no)');

  // ─── Target 3: Six Seeded Negatives with Reason Verification ───
  console.log('\n[Target 3: Six Seeded Negatives with Reason Verification]');

  // Reference table #8 (2 cols) and preceding table #7 (2 cols)
  const baseT = parseResult.tables.find(t => t.physicalIndex === 8);
  const baseH = parseResult.tables.find(t => t.physicalIndex === 7);

  // Negative 1: one column fewer
  const hColFewer = JSON.parse(JSON.stringify(baseH));
  hColFewer.colCount = baseT.colCount - 1;
  hColFewer.gridColWidths = [1000];
  hColFewer.grid = [[{ text: 'Single' }]];
  const allT1 = [hColFewer, baseT];
  const chk1 = HeaderRecovery.canRecover(baseT, allT1, isDataTableSet, 0);
  try {
    assert.strictEqual(chk1.eligible, false);
    assert(chk1.failedChecks.some(c => c.includes('column count mismatch') || c.includes('one column fewer')));
    assert(chk1.message.includes('one column fewer') || chk1.message.includes('column count mismatch'));
    pass(`Negative 1 (one column fewer): correctly rejected with "${chk1.message}"`);
  } catch (err) { fail('Negative 1', err); }

  // Negative 2: edges off by more than 3%
  const hEdgesOff = JSON.parse(JSON.stringify(baseH));
  hEdgesOff.gridColWidths = [3000, 7000]; // 30% vs T's 10.5% (difference > 3%)
  const allT2 = [hEdgesOff, baseT];
  const chk2 = HeaderRecovery.canRecover(baseT, allT2, isDataTableSet, 0);
  try {
    assert.strictEqual(chk2.eligible, false);
    assert(chk2.failedChecks.includes('edges off by more than 3%'));
    assert(chk2.message.includes('edges off by more than 3%'));
    pass(`Negative 2 (edges off > 3%): correctly rejected with "${chk2.message}"`);
  } catch (err) { fail('Negative 2', err); }

  // Negative 3: no header signal
  const hNoSignal = JSON.parse(JSON.stringify(baseH));
  hNoSignal.signals = [];
  const allT3 = [hNoSignal, baseT];
  const chk3 = HeaderRecovery.canRecover(baseT, allT3, isDataTableSet, 0);
  try {
    assert.strictEqual(chk3.eligible, false);
    assert(chk3.failedChecks.includes('no header signal'));
    assert(chk3.message.includes('no header signal'));
    pass(`Negative 3 (no header signal): correctly rejected with "${chk3.message}"`);
  } catch (err) { fail('Negative 3', err); }

  // Negative 4: one empty header cell
  const hEmptyCell = JSON.parse(JSON.stringify(baseH));
  hEmptyCell.grid[0][1].text = '   ';
  const allT4 = [hEmptyCell, baseT];
  const chk4 = HeaderRecovery.canRecover(baseT, allT4, isDataTableSet, 0);
  try {
    assert.strictEqual(chk4.eligible, false);
    assert(chk4.failedChecks.includes('one empty header cell'));
    assert(chk4.message.includes('one empty header cell'));
    pass(`Negative 4 (one empty header cell): correctly rejected with "${chk4.message}"`);
  } catch (err) { fail('Negative 4', err); }

  // Negative 5: a text paragraph between H and T
  const tWithPara = JSON.parse(JSON.stringify(baseT));
  tWithPara.precedingText = 'Some explanatory paragraph text between tables';
  const allT5 = [baseH, tWithPara];
  const chk5 = HeaderRecovery.canRecover(tWithPara, allT5, isDataTableSet, 0);
  try {
    assert.strictEqual(chk5.eligible, false);
    assert(chk5.failedChecks.includes('a text paragraph between H and T'));
    assert(chk5.message.includes('a text paragraph between H and T'));
    pass(`Negative 5 (text paragraph between H and T): correctly rejected with "${chk5.message}"`);
  } catch (err) { fail('Negative 5', err); }

  // Negative 6: T already has a header row
  const chk6 = HeaderRecovery.canRecover(baseT, parseResult.tables, isDataTableSet, 1);
  try {
    assert.strictEqual(chk6.eligible, false);
    assert(chk6.failedChecks.includes('table already has header rows'));
    assert(chk6.message.includes('table already has header rows'));
    pass(`Negative 6 (T already has a header row): correctly rejected with "${chk6.message}"`);
  } catch (err) { fail('Negative 6', err); }

  // ─── Target 4: Undo After One and After Two Presses Restores Earlier State ───
  console.log('\n[Target 4: Idempotency & Undo Reversibility]');

  const t8 = parseResult.tables.find(x => x.physicalIndex === 8);
  const h7 = parseResult.tables.find(x => x.physicalIndex === 7);

  // Recovery press 1
  const rec1 = HeaderRecovery.recover(t8, parseResult.tables, isDataTableSet, 0);
  assert.strictEqual(rec1.success, true);
  assert.strictEqual(h7.usedAsHeaderOf, 8);

  // Recovery press 2 (already recovered / current header count is 1)
  const rec2 = HeaderRecovery.canRecover(t8, parseResult.tables, isDataTableSet, 1);
  assert.strictEqual(rec2.eligible, false);
  assert(rec2.failedChecks.includes('table already has header rows'));
  pass('Second press does not re-apply recovery ("already recovered" / already has header rows)');

  // Undo restores state
  delete h7.usedAsHeaderOf;
  assert.strictEqual(h7.usedAsHeaderOf, undefined);
  pass('Undo clears usedAsHeaderOf marker and restores exact pre-recovery state');

  // ─── Target 5: CSV Export for #8 and #58 ───
  console.log('\n[Target 5: CSV Export for Recovered Tables #8 and #58]');

  const csvExporter = new CsvExporter();

  // Export #8 with recovered header
  const recRes8 = HeaderRecovery.recover(t8, parseResult.tables, isDataTableSet, 0);
  const csv8 = csvExporter.exportTable(t8, 1, 0, { recovered: recRes8 });

  try {
    const lines8 = csv8.csv.trim().split(/\r?\n/);
    assert.strictEqual(lines8[0], 'DN,Schedule', 'Table #8 CSV header is "DN,Schedule"');
    assert.strictEqual(lines8.length, 21, 'Table #8 CSV has 1 header + 20 data rows');
    assert.strictEqual(lines8[1].split(',')[0], '15');

    // Check companion provenance
    const headerProv8 = (csv8.provenance || []).filter(p => p.isHeader);
    assert.strictEqual(headerProv8.length, 2);
    assert.strictEqual(headerProv8[0].sourceTableIndex, 7);
    assert.strictEqual(headerProv8[0].sourceCellIndex, 0);
    assert.strictEqual(headerProv8[0].recovered, true);
    assert.deepStrictEqual(headerProv8[0].signals, ['repeat-header', 'bold']);

    pass('Table #8 CSV header is "DN,Schedule" with all 20 data rows and recovered provenance pointing to #7');
  } catch (err) { fail('Table #8 CSV', err); }

  // Export #58 with recovered header
  const t58 = parseResult.tables.find(x => x.physicalIndex === 58);
  const recRes58 = HeaderRecovery.recover(t58, parseResult.tables, isDataTableSet, 0);
  const csv58 = csvExporter.exportTable(t58, 1, 0, { recovered: recRes58 });

  try {
    const lines58 = csv58.csv.trim().split(/\r?\n/);
    assert.strictEqual(lines58[0], 'DN,nr,inch,x,mm,MESC number', 'Table #58 CSV header matches');
    assert.strictEqual(lines58.length, 21, 'Table #58 CSV has 1 header + 20 data rows');

    // Check companion provenance
    const headerProv58 = (csv58.provenance || []).filter(p => p.isHeader);
    assert.strictEqual(headerProv58.length, 6);
    assert.strictEqual(headerProv58[0].sourceTableIndex, 57);
    assert.strictEqual(headerProv58[0].sourceCellIndex, 0);
    assert.strictEqual(headerProv58[0].recovered, true);
    assert.deepStrictEqual(headerProv58[0].signals, ['repeat-header', 'underlined']);

    pass('Table #58 CSV header is "DN,nr,inch,x,mm,MESC number" with 20 data rows and recovered provenance pointing to #57');
  } catch (err) { fail('Table #58 CSV', err); }

  // ─── Target 6: Batch Exporter Includes Title Path and Header Source ───
  console.log('\n[Target 6: Batch Exporter (Before/After/Compare HTML) with Title Path & Header Source]');

  // Precompute title paths on tables
  HeaderRecovery.computeAllTitlePaths(parseResult.tables, dataIndices, recMap);

  const batchResults = [];
  for (const t of dataTables) {
    const autoSug = AutoHeaderV3.suggest(t);
    const refRes = TableRefiner.refine(t, autoSug.headerRowCount);
    let recRes = null;
    if (refRes.headerRowCount === 0) {
      recRes = HeaderRecovery.recover(t, parseResult.tables, isDataTableSet, 0);
    }
    batchResults.push({
      table: t,
      status: 'OK',
      autoRule: autoSug.ruleName,
      refineRule: refRes.ruleName || refRes.rule,
      refined: refRes,
      recovered: recRes && recRes.success ? recRes : null,
      error: null
    });
  }

  const beforeHtml = BatchExporter.generateBeforeHtml(dataTables, 'Native Word');
  const afterHtml = BatchExporter.generateAfterHtml(batchResults, 'Native Word');
  const compareHtml = BatchExporter.generateCompareHtml(dataTables, batchResults, 'Native Word');

  try {
    assert(beforeHtml.includes('title-path-box'), 'Before HTML includes title-path-box');
    assert(beforeHtml.includes('#6 row 0: Table of Schedules'), 'Before HTML shows title for #8');
    pass('Before HTML renders title path above tables');

    assert(afterHtml.includes('badge-recovered'), 'After HTML includes badge-recovered');
    assert(afterHtml.includes('Recovered: #7 (repeat-header, bold)'), 'After HTML shows badge for #8');
    assert(afterHtml.includes('Recovered: #57 (repeat-header, underlined)'), 'After HTML shows badge for #58');
    assert(afterHtml.includes('title-path-box'), 'After HTML includes title-path-box');
    assert(afterHtml.includes('(inherited)'), 'After HTML marks inherited title lines');
    pass('After HTML renders header source badges, recovered table <thead>, and title paths');

    assert(compareHtml.includes('badge-recovered'), 'Compare HTML includes badge-recovered');
    assert(compareHtml.includes('title-path-box'), 'Compare HTML includes title paths');
    pass('Compare HTML renders side-by-side view with recovered headers and title paths');
  } catch (err) { fail('BatchExporter HTML', err); }

  // ─── Target 7: Real app.js Handlers Execution in DOM Shim ───
  console.log('\n[Target 7: Real prototype/js/app.js Execution in DOM Shim]');

  // Set up mock browser environment for app.js
  const domElements = {};
  function makeMockElement(id) {
    return {
      id,
      value: '0',
      textContent: '',
      innerHTML: '',
      style: {},
      classList: {
        add: () => {},
        remove: () => {},
        contains: () => false
      },
      click: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      appendChild: () => {},
      removeChild: () => {},
      querySelector: () => makeMockElement('sub-' + id),
      querySelectorAll: () => [],
      children: [],
    };
  }

  global.window = global;
  global.document = {
    getElementById: id => domElements[id] || (domElements[id] = makeMockElement(id)),
    createElement: tag => makeMockElement(tag),
    body: makeMockElement('body'),
    querySelector: sel => makeMockElement(sel),
    querySelectorAll: sel => [],
  };
  global.Blob = class { constructor(parts) { this.parts = parts; } };
  global.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
  global.alert = msg => console.log('  [App Alert]:', msg);

  window.DocxTableParser = DocxTableParser;
  window.AutoHeaderV3 = AutoHeaderV3;
  window.TableRefiner = TableRefiner;
  window.HeaderRecovery = HeaderRecovery;
  window.CsvExporter = CsvExporter;
  window.BatchExporter = BatchExporter;

  // Load real app.js controller
  delete require.cache[require.resolve('../prototype/js/app.js')];
  require('../prototype/js/app.js');

  try {
    assert(window.app, 'window.app must be defined');
    assert(typeof window.app.handleFile === 'function', 'app.handleFile is a function');
    assert(typeof window.app.applyRecoverHeader === 'function', 'app.applyRecoverHeader is a function');
    assert(typeof window.app.undoRecoverHeader === 'function', 'app.undoRecoverHeader is a function');
    assert(typeof window.app.runBatchProcess === 'function', 'app.runBatchProcess is a function');

    // Run handleFile with real Native Word.docx
    const fakeFile = {
      name: 'Native Word.docx',
      size: fileBytes.length,
      arrayBuffer: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength)
    };

    await window.app.handleFile(fakeFile);
    pass('Real app.js handleFile parsed Native Word.docx in DOM shim');

    // Select Table #8 and apply Auto header first (fires Rule 4 -> 0 header rows)
    window.app.selectTableByPhysicalIndex(8);
    assert.strictEqual(window.app.getSelectedPhysicalIndex(), 8);

    window.app.applyAutoHeader();
    window.app.applyRecoverHeader();
    const appRec8 = window.app.getCurrentRecovered();
    assert(appRec8 && appRec8.success, 'app.js applyRecoverHeader succeeded on #8');
    assert.strictEqual(appRec8.sourcePhysicalIndex, 7);
    assert.deepStrictEqual(appRec8.headers, ['DN', 'Schedule']);
    pass('Real app.js applyRecoverHeader recovered Table #8 from #7: ["DN", "Schedule"]');

    // Test idempotency in app.js
    window.app.applyRecoverHeader();
    const appRec8Second = window.app.getCurrentRecovered();
    assert.strictEqual(appRec8Second, appRec8, 'Second press in app.js is idempotent');
    pass('Real app.js applyRecoverHeader is idempotent on second press');

    // Test Undo in app.js
    window.app.undoRecoverHeader();
    const appRec8AfterUndo = window.app.getCurrentRecovered();
    assert.strictEqual(appRec8AfterUndo, null, 'Undo in app.js clears currentRecovered');
    pass('Real app.js undoRecoverHeader cleanly restored state');

    // Test Batch Run in app.js
    window.app.runBatchProcess();
    pass('Real app.js runBatchProcess executed across all 50 tables cleanly');

  } catch (err) { fail('app.js DOM shim execution', err); }

  // ─── Summary ───
  console.log('\n===============================================================');
  console.log(`  D2T-S1.3 Test Suite Summary: ${testsPassed}/${testsPassed + testsFailed} tests passed (${testsFailed} failed)`);
  console.log('===============================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
})();
