/**
 * test_d2t_s1_1.js — Node test suite for Doc2Table Step D2T-S1.1 (WBS 4.1.1, Benchmark B2.1)
 *
 * Verifies all Targets and Falsifiers from Oracle O1's card rev 2:
 *   1. Dropdown table selector with stable physical IDs & selection retention
 *   2. Filter: "List all" vs "Only Tables with data" (>= 2 rows AND >= 2 grid cols; no content test)
 *   3. Auto Header v3:
 *      - Rule 1: Top band (group title) -> headers 0-1, data from row 2 (#11, #33, #35, #37, #39, #41)
 *      - Rule 2: Label under header folded ("Pressure bar(g)" into cell 0), excluded from data (#3)
 *      - Rule 3: Other top rows header-like (#44, #52: headers 0-1; #14: header 0)
 *      - Rule 4: Body and no-header (exactly 40 of 50 tables get no header; e.g. #5, #8, #20, #24, #58, #92, #128)
 *      - Idempotency & independent manual edits
 *
 * Reads real inputs in place from "C:\CodeC\Doc to Table\Native Word.docx".
 * Never copies or commits Word files.
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
const AutoHeaderV3 = require('../prototype/js/auto-header-v3.js');
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

async function run() {
  console.log('===============================================================');
  console.log('  Doc2Table D2T-S1.1 Node Test Suite (Targets & Falsifiers)');
  console.log('===============================================================\n');

  const NATIVE_PATH = 'C:/CodeC/Doc to Table/Native Word.docx';
  const nativeBuf = fs.readFileSync(NATIVE_PATH);
  const nativeHash = '1c20755a09041870ce2e79f00d428ea96bb147e0595f6e096d53e134da3a8363';

  const parser = new DocxTableParser();
  const res = await parser.parse(nativeBuf, nativeHash);
  const exporter = new CsvExporter();

  // ─── Target 1: Stable Physical IDs & Selector Model ───
  console.log('[Target 1: Stable Physical IDs & Dimensions]');
  assert(res.tables.length === 140, 'Total physical table inventory is 140');

  // Verify physical indices are 1..140
  let indicesValid = true;
  for (let i = 0; i < 140; i++) {
    if (res.tables[i].physicalIndex !== i + 1) {
      indicesValid = false;
      break;
    }
  }
  assert(indicesValid, 'Physical table IDs are stable 1-based integers (1..140)');

  // Verify nested table identity
  const table3 = res.tables.find(t => t.physicalIndex === 3);
  assert(table3 && table3.isNested && table3.parentTableIndex === 2,
    'Table #3 retains nested identity (parentTableIndex = 2)');
  assert(table3 && table3.rowCount === 3 && table3.colCount === 8,
    'Table #3 retains dimensions 3 rows x 8 cols');

  // ─── Target 2: Filter (List all vs Only Tables with data) ───
  console.log('\n[Target 2: Table Filter Predicate (rowCount >= 2 && colCount >= 2)]');
  const allTables = res.tables;
  const dataFilteredTables = allTables.filter(t => t.rowCount >= 2 && t.colCount >= 2);

  assert(dataFilteredTables.length === 50,
    `Only Tables with data yields exactly 50 tables (actual: ${dataFilteredTables.length})`);

  // Falsifier check: Blank 2x2 stays; populated 1x2 or 2x1 does not
  // Table #8 has empty text cells but dimensions 20x2 -> stays in filter
  const table8 = dataFilteredTables.find(t => t.physicalIndex === 8);
  assert(table8 !== undefined, 'Table #8 (empty cells, 20x2) stays in filter (no content test)');

  // Table #1 has dimensions 1x2 -> excluded from filter
  const table1 = dataFilteredTables.find(t => t.physicalIndex === 1);
  assert(table1 === undefined, 'Table #1 (1x2) is excluded from filter (rowCount < 2)');

  // Nested eligible tables stay in filter without vanishing
  const nestedEligible = [3, 11, 33, 35, 37, 39, 41];
  let allNestedStay = true;
  for (const id of nestedEligible) {
    if (!dataFilteredTables.some(t => t.physicalIndex === id)) {
      allNestedStay = false;
      break;
    }
  }
  assert(allNestedStay, 'All eligible nested tables (#3, #11, #33, #35, #37, #39, #41) remain in filtered list');

  // Stable IDs are retained after filter (never renumbered to 1..50)
  assert(dataFilteredTables[0].physicalIndex === 3,
    `First table in data filter retains original physicalIndex #3 (not renumbered to 1)`);
  assert(dataFilteredTables[1].physicalIndex === 5,
    `Second table in data filter retains original physicalIndex #5 (not renumbered to 2)`);

  // Restoring full list restores all 140
  const restored = allTables.filter(t => true);
  assert(restored.length === 140, 'Restoring full list restores all 140 tables');

  // ─── Target 3: Auto v3 Rule 1 (Top Band) ───
  console.log('\n[Target 3: Auto v3 Rule 1 — Top Band / Group Title]');
  const rule1Expected = [11, 33, 35, 37, 39, 41];
  for (const id of rule1Expected) {
    const t = res.tables.find(x => x.physicalIndex === id);
    const suggestion = AutoHeaderV3.suggest(t);

    assert(suggestion.rule === 'Rule 1', `Table #${id} triggers Rule 1 (actual: ${suggestion.rule})`);
    assert(suggestion.headerRowCount === 2, `Table #${id} selects 2 header rows (rows 0-1)`);
    assert(suggestion.dataStartRow === 2, `Table #${id} starts data at row 2`);
    assert(suggestion.affectedRows.length === 2 && suggestion.affectedRows[0] === 0 && suggestion.affectedRows[1] === 1,
      `Table #${id} reports affected rows [0, 1]`);

    // Export CSV and verify data starts at row 2
    const { csv, provenance } = exporter.exportTable(t, suggestion.headerRowCount, suggestion.dataStartRow);
    const lines = csv.split('\r\n');
    assert(lines.length === (t.rowCount - 2) + 1,
      `Table #${id} CSV has exactly ${t.rowCount - 2} data rows plus 1 header row`);
  }

  // Falsifier: 2 placeholders must NOT trigger the band rule
  const fakeTable2Placeholders = {
    rowCount: 3,
    colCount: 4,
    grid: [
      [{ text: 'A', spanned: false }, { text: '', spanned: true }, { text: '', spanned: true }, { text: 'B', spanned: false }],
      [{ text: '1', spanned: false }, { text: '2', spanned: false }, { text: '3', spanned: false }, { text: '4', spanned: false }],
      [{ text: '5', spanned: false }, { text: '6', spanned: false }, { text: '7', spanned: false }, { text: '8', spanned: false }],
    ]
  };
  const fakeSugg = AutoHeaderV3.suggest(fakeTable2Placeholders);
  assert(fakeSugg.rule !== 'Rule 1', 'Two placeholders must NOT trigger Rule 1 (requires >= 3)');

  // Falsifier: Top band with no successor warns and does not invent rows
  const singleRowBand = {
    rowCount: 1,
    colCount: 5,
    grid: [
      [{ text: 'Title', spanned: false }, { text: '', spanned: true }, { text: '', spanned: true }, { text: '', spanned: true }, { text: '', spanned: true }]
    ]
  };
  const singleRowSugg = AutoHeaderV3.suggest(singleRowBand);
  assert(singleRowSugg.warning === true, 'Top band with no successor triggers warning');
  assert(singleRowSugg.rule === 'Cannot suggest', 'Top band with no successor returns "Cannot suggest"');

  // ─── Target 4: Auto v3 Rule 2 (Label under Header) ───
  console.log('\n[Target 4: Auto v3 Rule 2 — Label Row Folded into Header]');
  const t3 = res.tables.find(x => x.physicalIndex === 3);
  const sugg3 = AutoHeaderV3.suggest(t3);

  assert(sugg3.rule === 'Rule 2', `Table #3 triggers Rule 2 (actual: ${sugg3.rule})`);
  assert(sugg3.headerRowCount === 1, `Table #3 selects 1 header row (row 0)`);
  assert(sugg3.dataStartRow === 2, `Table #3 starts data at row 2 (row 1 excluded from data)`);
  assert(sugg3.labelRow === 1, `Table #3 identifies label row 1`);
  assert(sugg3.labelText === 'Pressure bar(g)', `Table #3 extracts label text "Pressure bar(g)"`);
  assert(sugg3.foldedLabel !== null, 'Table #3 generates foldedLabel metadata');

  // Export CSV with foldedLabel
  const options3 = { foldedLabel: sugg3.foldedLabel };
  const export3 = exporter.exportTable(t3, sugg3.headerRowCount, sugg3.dataStartRow, options3);
  const csv3Lines = export3.csv.split('\r\n');

  // Verify header row in CSV has folded label in cell 0
  assert(csv3Lines[0].startsWith('"Pressure bar(g)"') || csv3Lines[0].startsWith('Pressure bar(g)'),
    `Table #3 CSV header cell 0 contains "Pressure bar(g)" (line: ${csv3Lines[0].substring(0, 30)}...)`);

  // Verify data row 1 contains DN 15-1200
  assert(csv3Lines[1].startsWith('DN 15-1200'),
    `Table #3 first CSV data line starts with "DN 15-1200" (data from row 2)`);

  // Verify row 1 was NOT exported as a data record
  const labelAsData = csv3Lines.slice(1).some(l => l.includes('Pressure bar(g)'));
  assert(!labelAsData, 'Label row 1 is NOT exported as a data record');

  // Falsifiers: raw row 1 must not be mutated or removed from table.grid
  assert(t3.grid.length === 3, 'Raw table #3 grid still contains all 3 original rows');
  assert(t3.grid[1][0].text === 'Pressure bar(g)', 'Raw row 1 still contains original text "Pressure bar(g)"');

  // Companion provenance on folded cell retains BOTH destination AND label source
  const foldedProv = export3.provenance.find(p => p.isHeader && p.csvCol === 0);
  assert(foldedProv !== undefined, 'Found header provenance for folded cell 0');
  assert(foldedProv.sourceRowIndex === 0 && foldedProv.sourceCellIndex === 0,
    'Header provenance points to destination (Row 0, Cell 0)');
  assert(foldedProv.foldedFrom !== null && foldedProv.foldedFrom !== undefined,
    'Header provenance includes companion foldedFrom record');
  assert(foldedProv.foldedFrom.sourceRowIndex === 1 && foldedProv.foldedFrom.rawText === 'Pressure bar(g)',
    'Companion foldedFrom points to source Row 1, Cell 0 ("Pressure bar(g)")');
  assert(foldedProv.foldedFrom.sourceTableIndex === 3,
    'Companion foldedFrom points to source table #3');

  // Idempotency: repeated Auto does not duplicate label text
  const export3Again = exporter.exportTable(t3, sugg3.headerRowCount, sugg3.dataStartRow, options3);
  const csv3AgainLines = export3Again.csv.split('\r\n');
  assert(!csv3AgainLines[0].includes('Pressure bar(g) Pressure bar(g)'),
    'Repeated export does not duplicate label prefix (idempotent)');

  // ─── Target 5: Auto v3 Rule 3 (Other Header-like Rows) ───
  console.log('\n[Target 5: Auto v3 Rule 3 — Bold Text & Differing Cell Count]');
  // Table #14: differing source cell count (3 vs 4)
  const t14 = res.tables.find(x => x.physicalIndex === 14);
  const sugg14 = AutoHeaderV3.suggest(t14);
  assert(sugg14.rule === 'Rule 3', `Table #14 triggers Rule 3 (actual: ${sugg14.rule})`);
  assert(sugg14.headerRowCount === 1, 'Table #14 selects 1 header row (row 0)');
  assert(sugg14.dataStartRow === 1, 'Table #14 starts data at row 1');
  assert(sugg14.diagnostic.includes('cell-count'), `Table #14 diagnostic specifies cell-count signal: ${sugg14.diagnostic}`);

  // Table #44: consecutive bold header rows 0-1 including (DN)
  const t44 = res.tables.find(x => x.physicalIndex === 44);
  const sugg44 = AutoHeaderV3.suggest(t44);
  assert(sugg44.rule === 'Rule 3', `Table #44 triggers Rule 3 (actual: ${sugg44.rule})`);
  assert(sugg44.headerRowCount === 2, 'Table #44 selects 2 header rows (rows 0-1)');
  assert(sugg44.dataStartRow === 2, 'Table #44 starts data at row 2');
  assert(sugg44.diagnostic.includes('all-bold'), `Table #44 diagnostic specifies all-bold signal: ${sugg44.diagnostic}`);

  // Table #52: consecutive bold header rows 0-1 including (DN)
  const t52 = res.tables.find(x => x.physicalIndex === 52);
  const sugg52 = AutoHeaderV3.suggest(t52);
  assert(sugg52.rule === 'Rule 3', `Table #52 triggers Rule 3 (actual: ${sugg52.rule})`);
  assert(sugg52.headerRowCount === 2, 'Table #52 selects 2 header rows (rows 0-1)');
  assert(sugg52.dataStartRow === 2, 'Table #52 starts data at row 2');

  // Verify (DN) is retained in exported headers
  const export44 = exporter.exportTable(t44, sugg44.headerRowCount, sugg44.dataStartRow);
  assert(export44.csv.includes('(DN)'), 'Table #44 exported headers retain "(DN)"');

  // Falsifier: An empty row qualifies solely by vacuous all-bold must be FALSE
  const fakeEmptyRow = {
    rowCount: 2,
    colCount: 3,
    grid: [
      [{ text: '', isBold: false }, { text: '', isBold: false }, { text: '', isBold: false }],
      [{ text: 'data', isBold: false }, { text: '1', isBold: false }, { text: '2', isBold: false }],
    ]
  };
  const emptyRowStats = AutoHeaderV3.getRowStats(fakeEmptyRow, 0);
  assert(emptyRowStats.allBold === false,
    'Empty row (no non-empty text) evaluates allBold as false (not vacuously true)');

  // ─── Target 6: Auto v3 Rule 4 (Body and No-Header) ───
  console.log('\n[Target 6: Auto v3 Rule 4 — Stop at First Body-Like Row]');
  const noHeaderNamed = [5, 8, 20, 24, 58, 92, 128];
  for (const id of noHeaderNamed) {
    const t = res.tables.find(x => x.physicalIndex === id);
    const sugg = AutoHeaderV3.suggest(t);
    assert(sugg.rule === 'Rule 4', `Table #${id} triggers Rule 4 (actual: ${sugg.rule})`);
    assert(sugg.headerRowCount === 0, `Table #${id} selects 0 header rows`);
    assert(sugg.dataStartRow === 0, `Table #${id} starts data at row 0 (retains row 0 as data)`);

    // Verify row 0 is retained in CSV export
    const exp = exporter.exportTable(t, sugg.headerRowCount, sugg.dataStartRow);
    const lines = exp.csv.split('\r\n');
    assert(lines.length === t.rowCount + 1,
      `Table #${id} CSV includes all ${t.rowCount} data rows plus synthetic header`);
  }

  // Count exactly how many of the 50 eligible tables get Rule 4
  const allEligibleSugg = dataFilteredTables.map(t => ({
    id: t.physicalIndex,
    sugg: AutoHeaderV3.suggest(t)
  }));
  const rule4Count = allEligibleSugg.filter(x => x.sugg.rule === 'Rule 4').length;
  assert(rule4Count === 40,
    `Exactly 40 of 50 eligible tables get Rule 4 (actual: ${rule4Count})`);

  // Total eligible breakdown
  const rule1Count = allEligibleSugg.filter(x => x.sugg.rule === 'Rule 1').length;
  const rule2Count = allEligibleSugg.filter(x => x.sugg.rule === 'Rule 2').length;
  const rule3Count = allEligibleSugg.filter(x => x.sugg.rule === 'Rule 3').length;
  assert(rule1Count === 6, `Rule 1 fires on exactly 6 tables (actual: ${rule1Count})`);
  assert(rule2Count === 1, `Rule 2 fires on exactly 1 table (actual: ${rule2Count})`);
  assert(rule3Count === 3, `Rule 3 fires on exactly 3 tables (actual: ${rule3Count})`);
  assert(rule1Count + rule2Count + rule3Count + rule4Count === 50,
    `Total sum of rule assignments across all 50 eligible tables is 50`);

  // ─── Target 7: Boundary & Manual Control Independence ───
  console.log('\n[Target 7: Boundary & Independent Manual Controls]');
  // Manual edit does not mutate or lock table
  const manualExportH0 = exporter.exportTable(t3, 0, 0); // User chose 0 headers, data from 0
  assert(manualExportH0.csv.split('\r\n').length === t3.rowCount + 1,
    'Manual selection of 0 headers exports all rows independently');

  const manualExportH2 = exporter.exportTable(t3, 2, 2); // User chose 2 headers, data from 2
  assert(manualExportH2.csv.split('\r\n').length === (t3.rowCount - 2) + 1,
    'Manual selection of 2 headers exports data from row 2 independently');

  // Final summary
  console.log('\n===============================================================');
  console.log(`  S1.1 Test Summary: ${passedTests}/${totalTests} tests passed (${failedTests} failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
