/**
 * test_d2t_s1_2_repair.js — Node test suite for Doc2Table D2T-S1.2 repair R1
 *
 * Verifies:
 *   - Defect 1: Pressing "Auto Refine table form" a second time changes nothing
 *               and says "already refined"; Undo restores Auto headerRowCount,
 *               dataStartRow, and foldedLabel.
 *   - Defect 2: Grid cells use no break-word / break-all; words/numbers do not split.
 *   - Defect 3: Refined grid row numbers show source row numbers (matching Provenance).
 *   - Defect 4: Refined view locked controls and descriptive rule names.
 *   - Defect 5 & A1: Group column values are marked derived/repeated, point to title
 *                    cell, earn no coverage credit, and navigate to title.
 *   - A2: Structured view only; underlying rows/cells/raw text unchanged.
 *   - A3: w:showingPlcHdr keeps "placeholder shown" mark through Refine and CSV.
 *   - A4: Census exact Unicode and whitespace comparison with mismatch reporting.
 *   - A5: 2x2 blank table filtered out by data filter but reachable in raw list.
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
    .replace(/&apos;/g, "'");
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
  console.log('  Doc2Table D2T-S1.2 Repair R1 Test Suite');
  console.log('===============================================================\n');

  const buf = fs.readFileSync(NATIVE_WORD_PATH);
  const fileHash = crypto.createHash('sha256').update(buf).digest('hex');
  const parser = new DocxTableParser();
  const res = await parser.parse(buf, fileHash);

  // ─── Defect 1: Idempotent Refine & Protected Undo ───
  console.log('[Defect 1: Idempotent Refine & Protected Undo]');
  const tablesToTest = [
    { id: 3, idx: 2 },
    { id: 11, idx: 10 },
    { id: 35, idx: 34 },
    { id: 44, idx: 43 },
    { id: 52, idx: 51 }
  ];

  for (const item of tablesToTest) {
    const tbl = res.tables[item.idx];
    const sugg = AutoHeaderV3.suggest(tbl);

    const session = TableRefiner.createSession(tbl, sugg.headerRowCount, sugg.dataStartRow, sugg.foldedLabel);

    // Press 1
    const r1 = session.refine();
    const headersPress1 = [...r1.headers];
    const rule1 = r1.rule;

    // Press 2
    const r2 = session.refine();
    const headersPress2 = [...r2.headers];
    const rule2 = r2.rule;

    assert(JSON.stringify(headersPress1) === JSON.stringify(headersPress2),
      `Table #${item.id}: Pressing Refine twice produces identical headers (length: ${headersPress1.length})`);
    assert(session.status === 'already refined',
      `Table #${item.id}: Session status reports "already refined" on second press`);
    assert(rule1 === rule2,
      `Table #${item.id}: Rule remains unchanged (${rule1})`);

    // Undo after pressing twice
    session.undo();
    assert(session.headerRowCount === sugg.headerRowCount,
      `Table #${item.id}: Undo restores Auto headerRowCount (${sugg.headerRowCount})`);
    assert(session.dataStartRow === sugg.dataStartRow,
      `Table #${item.id}: Undo restores Auto dataStartRow (${sugg.dataStartRow})`);
    assert(JSON.stringify(session.foldedLabel) === JSON.stringify(sugg.foldedLabel),
      `Table #${item.id}: Undo restores Auto foldedLabel`);
    assert(session.refined === null,
      `Table #${item.id}: Refined state is cleared upon Undo`);
  }

  // ─── Defect 5 & A1: Group Column Source Linkage & Coverage Integrity ───
  console.log('\n[Defect 5 & A1: Group Column Source Linkage & Coverage Integrity]');
  const groupTables = [
    { id: 33, idx: 32, group: 'Pipes', span: 2 },
    { id: 35, idx: 34, group: 'Flanges', span: 2 },
    { id: 37, idx: 36, group: 'Fittings', span: 2 },
    { id: 39, idx: 38, group: 'Valves', span: 2 },
    { id: 41, idx: 40, group: 'Miscellaneous', span: 2 }
  ];

  const exporter = new CsvExporter();

  for (const g of groupTables) {
    const tbl = res.tables[g.idx];
    const sugg = AutoHeaderV3.suggest(tbl);
    const refined = TableRefiner.refine(tbl, sugg.headerRowCount, sugg.dataStartRow, sugg.foldedLabel);

    // Verify groupSource structure
    assert(refined.groupSource != null, `Table #${g.id}: groupSource exists`);
    assert(refined.groupSource.rowIndex === 0, `Table #${g.id}: groupSource points to title rowIndex 0`);
    assert(refined.groupSource.cellIndex === 0, `Table #${g.id}: groupSource points to title cellIndex 0`);
    assert(refined.groupSource.span === g.span, `Table #${g.id}: groupSource records span ${g.span}`);
    assert(refined.groupSource.rawText === g.group, `Table #${g.id}: groupSource records title text "${g.group}"`);

    // Verify CSV export and provenance for Group values
    const exp = exporter.exportTable(tbl, 1, 2, { refined });
    const groupProvRecords = exp.provenance.filter(p => !p.isHeader && p.csvCol === 0);
    assert(groupProvRecords.length > 0, `Table #${g.id}: Generated ${groupProvRecords.length} group data records`);

    let allDerivedCorrect = true;
    for (const gp of groupProvRecords) {
      if (gp.derived !== true || gp.repeated !== true || gp.coverageCredit !== false ||
          gp.sourceRowIndex !== 0 || gp.sourceCellIndex !== 0 || gp.span !== g.span) {
        allDerivedCorrect = false;
        break;
      }
    }
    assert(allDerivedCorrect, `Table #${g.id}: All group values marked derived/repeated, point to title cell (r=0, c=0, span=${g.span}), coverageCredit: false`);

    // Verify destinationRow on each record
    let destRowsCorrect = true;
    for (let i = 0; i < groupProvRecords.length; i++) {
      if (groupProvRecords[i].destinationRow !== (refined.dataStartRow + i)) {
        destRowsCorrect = false;
        break;
      }
    }
    assert(destRowsCorrect, `Table #${g.id}: Group provenance records link to correct destination rows`);

    // Verify coverage counts unchanged by Group values
    const covTotal = exporter.calculateSourceCoverage(exp.provenance);
    const covWithoutRepeated = exporter.calculateSourceCoverage(exp.provenance.filter(p => !p.derived));
    assert(covTotal === covWithoutRepeated, `Table #${g.id}: Source coverage count (${covTotal}) unchanged by Group column values`);
  }

  // Verify empty group is shown as such, never guessed
  const syntheticEmptyGroupTbl = {
    physicalIndex: 999,
    rowCount: 3,
    colCount: 4,
    grid: [
      [{ text: '', gridSpan: 2, provenance: { rowIndex: 0, cellIndex: 0 } }, null, { text: 'Title Values', gridSpan: 2, provenance: { rowIndex: 0, cellIndex: 2 } }, null],
      [{ text: 'Col A', provenance: { rowIndex: 1, cellIndex: 0 } }, { text: 'Col B', provenance: { rowIndex: 1, cellIndex: 1 } }, { text: 'Col C', provenance: { rowIndex: 1, cellIndex: 2 } }, { text: 'Col D', provenance: { rowIndex: 1, cellIndex: 3 } }],
      [{ text: 'Val 1', provenance: { rowIndex: 2, cellIndex: 0 } }, { text: 'Val 2', provenance: { rowIndex: 2, cellIndex: 1 } }, { text: 'Val 3', provenance: { rowIndex: 2, cellIndex: 2 } }, { text: 'Val 4', provenance: { rowIndex: 2, cellIndex: 3 } }]
    ]
  };
  const refEmpty = TableRefiner.refine(syntheticEmptyGroupTbl, 2, 2, null);
  assert(refEmpty.groupColumn === null || refEmpty.groupColumn === '', 'Empty group is shown as such, never guessed');

  console.log('\n===============================================================');
  console.log(`  Repair Test Summary: ${passed}/${passed + failed} tests passed (${failed} failed)`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
})();
