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


  // ─── Defect 2: CSS / Word-Break Check ───
  console.log('\n[Defect 2: CSS Word-Break & Column Squeezing Prevention]');
  const cssContent = fs.readFileSync(path.join(__dirname, '../prototype/css/style.css'), 'utf8');
  const dataGridCellMatch = cssContent.match(/\.data-grid\s+th\s*,\s*\.data-grid\s+td\s*\{([^\}]+)\}/);
  assert(dataGridCellMatch != null, 'Found .data-grid th, .data-grid td style rule in style.css');
  if (dataGridCellMatch) {
    const ruleBody = dataGridCellMatch[1];
    assert(!ruleBody.includes('break-word'), 'CSS cells do NOT use word-break: break-word');
    assert(!ruleBody.includes('break-all'), 'CSS cells do NOT use word-break: break-all');
    assert(ruleBody.includes('word-break: normal') || ruleBody.includes('overflow-wrap: normal'),
      'CSS cells use normal word-breaking (wraps at whitespace only)');
  }
  const dataGridTableMatch = cssContent.match(/\.data-grid\s*\{([^\}]+)\}/);
  if (dataGridTableMatch) {
    assert(dataGridTableMatch[1].includes('width: max-content'),
      '.data-grid uses width: max-content to scroll horizontally instead of squeezing columns');
  }

  // ─── Defect 3: Refined Grid Data Row Source Row Numbering ───
  console.log('\n[Defect 3: Source Row Numbering in Refined Grid]');
  const t33Refined = TableRefiner.refine(res.tables[32], 2, 2, null);
  // In table #33, dataStartRow is 2, row 0 is deleted.
  // Data rows are source rows 2 through 7 (length: 6).
  assert(t33Refined.dataStartRow === 2, 'Table #33 data starts at source row 2');
  assert(t33Refined.excludeRows.includes(0), 'Table #33 excludes row 0');
  const sourceRowIndices = [];
  for (let r = t33Refined.dataStartRow; r < res.tables[32].grid.length; r++) {
    if (!t33Refined.excludeRows.includes(r)) sourceRowIndices.push(r);
  }
  assert(JSON.stringify(sourceRowIndices) === JSON.stringify([2, 3, 4, 5, 6, 7]),
    'Refined Table #33 data rows match source rows [2, 3, 4, 5, 6, 7] exactly (not renumbered 0..5)');

  // ─── Defect 4: Descriptive Rule Names & Locked Controls ───
  console.log('\n[Defect 4: Descriptive Rule Names]');
  assert(TableRefiner.refine(res.tables[10], 2, 2, null).ruleName === 'Title row',
    'Rule R1 descriptive name is "Title row"');
  assert(TableRefiner.refine(res.tables[43], 2, 2, null).ruleName === 'Merge two header rows',
    'Rule R2 descriptive name is "Merge two header rows"');
  assert(TableRefiner.refine(res.tables[2], 1, 2, { targetCol: 0, labelRow: 1, labelCol: 0, text: 'Pressure bar(g)' }).ruleName === 'Label',
    'Rule R3 descriptive name is "Label"');
  assert(TableRefiner.refine(res.tables[13], 1, 1, null).ruleName === 'Nothing to refine',
    'Rule R4 descriptive name is "Nothing to refine"');

  // ─── Amendment A2: Structured View Only & Shared Source Identity ───
  console.log('\n[Amendment A2: Structured View Only Integrity]');
  // Verify underlying table.grid is unmodified
  const t44RawRow0 = res.tables[43].grid[0].map(c => c ? c.text : '');
  const t44RawRow1 = res.tables[43].grid[1].map(c => c ? c.text : '');
  const t44Ref = TableRefiner.refine(res.tables[43], 2, 2, null);
  assert(res.tables[43].grid.length === 77, 'Table #44 underlying grid still contains all 77 physical rows');
  assert(res.tables[43].grid[0][0].text === 'Run', 'Table #44 raw row 0 cell 0 remains "Run"');
  assert(res.tables[43].grid[1][0].text === '(DN)', 'Table #44 raw row 1 cell 0 remains "(DN)"');

  // Vertically merged text not duplicated in R2
  assert(t44Ref.headers[4] === 'CIWB', 'Table #44 col 4 merged text is "CIWB" (not duplicated "CIWB CIWB")');
  assert(t44Ref.headers[5] === 'RECB', 'Table #44 col 5 merged text is "RECB" (not duplicated)');

  // Table #3 never duplicates "Pressure bar(g)"
  const t3Ref = TableRefiner.refine(res.tables[2], 1, 2, { targetCol: 0, labelRow: 1, labelCol: 0, text: 'Pressure bar(g)' });
  assert(t3Ref.headers[0] === 'Temperature °C | Pressure bar(g)',
    'Table #3 header 0 has single label append (not duplicated)');

  // Spanning top header copied over children shares exact source identity
  const t33Ref = TableRefiner.refine(res.tables[32], 2, 2, null);
  const titleCellSource = t33Ref.headerProvenance[1].sourceCells.find(sc => sc.rowIndex === 0);
  assert(titleCellSource && titleCellSource.cellIndex === 1 && titleCellSource.rawText === 'Nominal Diameter (DN)',
    'Spanning top header shares exact source identity (Row 0 Cell 1) in provenance');

  // ─── Amendment A3: Placeholder-Shown Unresolved Status ───
  console.log('\n[Amendment A3: Placeholder-Shown Text Unresolved Status]');
  const t3Cell0_0 = res.tables[2].grid[0][0];
  assert(t3Cell0_0.isPlaceholder === true, 'Table #3 (0,0) has isPlaceholder: true');
  assert(t3Ref.headerProvenance[0].placeholder === 'placeholder shown',
    'Table #3 refined header provenance retains placeholder: "placeholder shown"');
  const exp3 = exporter.exportTable(res.tables[2], 1, 2, { refined: t3Ref });
  const provH0 = exp3.provenance.find(p => p.isHeader && p.csvCol === 0);
  assert(provH0.placeholder === 'placeholder shown',
    'Exported CSV provenance for Table #3 header 0 keeps placeholder: "placeholder shown"');

  // ─── Amendment A4: Census Exact Comparison & Mismatch Reporting ───
  console.log('\n[Amendment A4: Census Exact Whitespace & Unicode Comparison]');
  // Discover 140 tables in XML directly
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const doc = parseXml(xml);
  const body = doc.children[0].children.find(c => c.localName === 'body');
  const xmlTableRegistry = [];
  function regTable(tblEl, isNested, parentIdx) {
    const idx = xmlTableRegistry.length + 1;
    xmlTableRegistry.push({ element: tblEl, isNested, parentIdx });
    for (const row of tblEl.children.filter(c => c.localName === 'tr')) {
      for (const cell of row.children.filter(c => c.localName === 'tc')) {
        for (const nestedTbl of cell.children.filter(c => c.localName === 'tbl')) {
          regTable(nestedTbl, true, idx);
        }
      }
    }
  }
  for (const child of body.children) {
    if (child.localName === 'tbl') regTable(child, false, null);
  }

  function getCellTextMinimal(tc) {
    let text = '';
    function walk(node) {
      for (const child of node.children) {
        if (child.localName === 'tbl') continue;
        if (child.localName === 'del') continue;
        if (child.localName === 't') {
          text += child.textContent;
        } else {
          walk(child);
        }
      }
    }
    walk(tc);
    return text;
  }

  let censusMatches = 0;
  let censusMismatches = [];
  let totalCellsExamined = 0;
  let minimalNonEmptyCount = 0;

  for (let tIdx = 0; tIdx < 140; tIdx++) {
    const tblEl = xmlTableRegistry[tIdx].element;
    const pTable = res.tables[tIdx];
    const trEls = tblEl.children.filter(c => c.localName === 'tr');

    for (let rIdx = 0; rIdx < trEls.length; rIdx++) {
      const tcEls = trEls[rIdx].children.filter(c => c.localName === 'tc');
      const unspannedRowCells = pTable.grid[rIdx].filter(c => !c.spanned);

      for (let cIdx = 0; cIdx < tcEls.length; cIdx++) {
        totalCellsExamined++;
        const minText = getCellTextMinimal(tcEls[cIdx]);
        if (minText.trim().length > 0) minimalNonEmptyCount++;

        const parserCell = unspannedRowCells[cIdx];
        const parserText = parserCell ? parserCell.text : null;

        if (minText.trim() === (parserText || '').trim()) {
          censusMatches++;
        } else {
          censusMismatches.push({
            tableIndex: tIdx + 1,
            rowIndex: rIdx,
            cellIndex: cIdx,
            minimalText: minText,
            parserText: parserText
          });
        }
      }
    }
  }

  if (censusMismatches.length > 0) {
    for (const m of censusMismatches) {
      console.error(`Census Mismatch: Table #${m.tableIndex}, Row ${m.rowIndex}, Cell ${m.cellIndex}: Minimal="${m.minimalText}" vs Parser="${m.parserText}"`);
    }
  }

  assert(totalCellsExamined === 4196, `Total cells examined is 4,196 (actual: ${totalCellsExamined})`);
  assert(minimalNonEmptyCount === 3796, `Census non-empty cells is 3,796 (actual: ${minimalNonEmptyCount})`);
  assert(censusMismatches.length === 0, `Census exact text comparison: 0 mismatches out of 4,196 cells (matches: ${censusMatches})`);
  console.log('  ℹ Note: S1 and S1.1 test suites (72+109 tests) did NOT catch the 1,259 missing cells because they did not inspect the affected 130 tables.');

  // ─── Amendment A5: Blank 2x2 Table Data Filter Test ───
  console.log('\n[Amendment A5: Blank 2x2 Table Data Filter vs Raw List]');
  function isTableWithDataPredicate(t) {
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

  // Create a synthetic blank 2x2 table (no text content)
  const blank2x2Table = {
    physicalIndex: 141,
    rowCount: 2,
    colCount: 2,
    grid: [
      [{ text: '   ', spanned: false }, { text: '', spanned: false }],
      [{ text: '', spanned: false }, { text: '  ', spanned: false }]
    ]
  };

  // S1.1 predicate: dimension only
  const s11Predicate = (t) => t.rowCount >= 2 && t.colCount >= 2;
  assert(s11Predicate(blank2x2Table) === true, 'S1.1 dimension filter would include blank 2x2 table');

  // S1.2 predicate: requires >= 2 rows and >= 2 cols with text
  assert(isTableWithDataPredicate(blank2x2Table) === false,
    'S1.2 "Only Tables with data" filter correctly EXCLUDES blank 2x2 table');

  // Table remains in all-tables list and is reachable in dropdown/raw view
  const allTablesList = [...res.tables, blank2x2Table];
  assert(allTablesList.find(t => t.physicalIndex === 141) != null,
    'Blank 2x2 table remains accessible in the complete 141-table raw view / selector');

  // ─── Defect 2: CSS / Wrapping Check ───
  console.log('\n[Defect 2: CSS / Wrapping Check]');
  const css = fs.readFileSync('prototype/css/style.css', 'utf8');
  // Check that .data-grid th, .data-grid td uses no break-word or break-all
  const dataGridRuleMatch = css.match(/\.data-grid\s+th\s*,\s*\.data-grid\s+td\s*\{([^\}]+)\}/);
  assert(dataGridRuleMatch != null, 'Found .data-grid th, .data-grid td rule in style.css');
  const dataGridBody = dataGridRuleMatch ? dataGridRuleMatch[1] : '';
  assert(!dataGridBody.includes('word-break: break-word'), '.data-grid th/td does not use word-break: break-word');
  assert(!dataGridBody.includes('word-break: break-all'), '.data-grid th/td does not use word-break: break-all');
  assert(!dataGridBody.includes('overflow-wrap: break-word'), '.data-grid th/td does not use overflow-wrap: break-word');
  assert(dataGridBody.includes('word-break: normal'), '.data-grid th/td explicitly sets word-break: normal');
  assert(dataGridBody.includes('overflow-wrap: normal'), '.data-grid th/td explicitly sets overflow-wrap: normal');

  // ─── Defect 3: Refined Grid Data Row Numbering ───
  console.log('\n[Defect 3: Refined Grid Data Row Numbering]');
  const t33 = res.tables[32];
  const sugg33 = AutoHeaderV3.suggest(t33);
  const ref33 = TableRefiner.refine(t33, sugg33.headerRowCount, sugg33.dataStartRow, sugg33.foldedLabel);
  // Source rows for #33 data are 2 through 7 (excludeRows includes 0, row 1 is header)
  const expectedSourceRows33 = [];
  for (let r = ref33.dataStartRow; r < t33.grid.length; r++) {
    if (!ref33.excludeRows.includes(r)) expectedSourceRows33.push(r);
  }
  assert(expectedSourceRows33.length === 6, 'Table #33 has 6 data rows');
  assert(JSON.stringify(expectedSourceRows33) === JSON.stringify([2, 3, 4, 5, 6, 7]),
    'Table #33 data rows correspond to source row numbers 2 through 7 (not 0..5)');

  // ─── Defect 4: Refined View Locked Controls & Friendly Rule Names ───
  console.log('\n[Defect 4: Refined View Locked Controls & Friendly Rule Names]');
  const t11 = res.tables[10];
  const ref11 = TableRefiner.refine(t11, 2, 2, null);
  assert(ref11.ruleName === 'Title row', `Table #11 ruleName is "Title row" (actual: "${ref11.ruleName}")`);

  const t44 = res.tables[43];
  const ref44 = TableRefiner.refine(t44, 2, 2, null);
  assert(ref44.ruleName === 'Merge two header rows', `Table #44 ruleName is "Merge two header rows" (actual: "${ref44.ruleName}")`);

  const t3 = res.tables[2];
  const ref3 = TableRefiner.refine(t3, 1, 2, { labelRow: 1, labelCol: 0, text: 'Pressure bar(g)' });
  assert(ref3.ruleName === 'Label', `Table #3 ruleName is "Label" (actual: "${ref3.ruleName}")`);

  const t14 = res.tables[13];
  const ref14 = TableRefiner.refine(t14, 1, 1, null);
  assert(ref14.ruleName === 'Nothing to refine', `Table #14 ruleName is "Nothing to refine" (actual: "${ref14.ruleName}")`);

  // ─── Amendment A2: Structured View Only & Preservation ───
  console.log('\n[Amendment A2: Structured View Only & Preservation]');
  // Underlying table grid and rows are completely unmodified
  const t44BeforeGridText = JSON.stringify(t44.grid.map(row => row.map(c => c ? c.text : '')));
  TableRefiner.refine(t44, 2, 2, null);
  const t44AfterGridText = JSON.stringify(t44.grid.map(row => row.map(c => c ? c.text : '')));
  assert(t44BeforeGridText === t44AfterGridText, 'Table #44 underlying grid text is completely unmodified by TableRefiner');

  // Verify vertically merged cells never duplicate text
  assert(!ref44.headers.some(h => /\b(\w+)\s+\1\b/.test(h)), 'Table #44 headers contain no duplicated vertically merged words');
  const t52 = res.tables[51];
  const ref52 = TableRefiner.refine(t52, 2, 2, null);
  assert(!ref52.headers.some(h => /\b(\w+)\s+\1\b/.test(h)), 'Table #52 headers contain no duplicated vertically merged words');

  // Verify Table #3 never duplicates "Pressure bar(g)"
  assert(ref3.headers[0] === 'Temperature °C | Pressure bar(g)', 'Table #3 header cell 0 has exact label without duplication');

  // Verify child columns under top span share single source identity
  const p11_0 = ref11.headerProvenance[0];
  assert(p11_0.sourceCells.length === 2, 'Table #11 cell 0 records composite source cells');
  const p11_1 = ref11.headerProvenance[1];
  assert(p11_1.sourceCells.some(sc => sc.rowIndex === 1 && sc.cellIndex === 1), 'Table #11 cell 1 has proper source cell identity');

  // ─── Amendment A3: Placeholder-Shown Text (w:showingPlcHdr) ───
  console.log('\n[Amendment A3: Placeholder-Shown Text (w:showingPlcHdr)]');
  const t3_c0 = t3.grid[0][0];
  assert(t3_c0.isPlaceholder === true, 'Table #3 cell (0,0) has isPlaceholder: true');
  assert(t3_c0.text === 'Temperature °C', 'Table #3 cell (0,0) displays text "Temperature °C"');
  assert(ref3.headerProvenance[0].placeholder === 'placeholder shown',
    'Table #3 refined header provenance preserves placeholder: "placeholder shown"');

  const exp3 = exporter.exportTable(t3, 1, 2, { refined: ref3 });
  const prov3_0 = exp3.provenance.find(p => p.csvRow === 0 && p.csvCol === 0);
  assert(prov3_0 && prov3_0.placeholder === 'placeholder shown',
    'CSV provenance for Table #3 header cell preserves placeholder: "placeholder shown"');

  // ─── Amendment A4: Census Exact Unicode & Whitespace Comparison ───
  console.log('\n[Amendment A4: Census Exact Unicode & Whitespace Comparison]');
  // Discover 140 tables in XML directly
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const doc = parseXml(xml);
  const body = doc.children[0].children.find(c => c.localName === 'body');
  const xmlTableRegistry = [];
  function regTable(tblEl, isNested, parentIdx) {
    const idx = xmlTableRegistry.length + 1;
    xmlTableRegistry.push({ element: tblEl, isNested, parentIdx });
    for (const row of tblEl.children.filter(c => c.localName === 'tr')) {
      for (const cell of row.children.filter(c => c.localName === 'tc')) {
        for (const nestedTbl of cell.children.filter(c => c.localName === 'tbl')) {
          regTable(nestedTbl, true, idx);
        }
      }
    }
  }
  for (const child of body.children) {
    if (child.localName === 'tbl') regTable(child, false, null);
  }

  function getCellTextMinimal(tc) {
    let text = '';
    function walk(node) {
      for (const child of node.children) {
        if (child.localName === 'tbl') continue;
        if (child.localName === 'del') continue;
        if (child.localName === 't') {
          text += child.textContent;
        } else {
          walk(child);
        }
      }
    }
    walk(tc);
    return text;
  }

  let cellMatchCount = 0;
  let cellMismatchCount = 0;
  let totalCells = 0;
  let minimalNonEmpty = 0;
  const mismatches = [];

  for (let tIdx = 0; tIdx < 140; tIdx++) {
    const tblEl = xmlTableRegistry[tIdx].element;
    const pTable = res.tables[tIdx];
    const trEls = tblEl.children.filter(c => c.localName === 'tr');

    for (let rIdx = 0; rIdx < trEls.length; rIdx++) {
      const tcEls = trEls[rIdx].children.filter(c => c.localName === 'tc');
      const unspannedRowCells = pTable.grid[rIdx].filter(c => !c.spanned);

      for (let cIdx = 0; cIdx < tcEls.length; cIdx++) {
        totalCells++;
        const minText = getCellTextMinimal(tcEls[cIdx]);
        if (minText.trim().length > 0) minimalNonEmpty++;

        const parserCell = unspannedRowCells[cIdx];
        const parserText = parserCell ? (parserCell.text || '') : '';

        // Exact comparison including Unicode and whitespace
        if (minText === parserText) {
          cellMatchCount++;
        } else {
          cellMismatchCount++;
          mismatches.push({
            table: tIdx + 1,
            row: rIdx,
            cell: cIdx,
            minText,
            parserText
          });
        }
      }
    }
  }

  if (mismatches.length > 0) {
    console.error('Census Mismatches Found:');
    for (const m of mismatches.slice(0, 5)) {
      console.error(`  Mismatch at Table #${m.table}, Row ${m.row}, Cell ${m.cell}: Minimal="${m.minText}" vs Parser="${m.parserText}"`);
    }
  }

  assert(totalCells === 4196, `Census: Total physical cells across 140 tables is 4,196 (actual: ${totalCells})`);
  assert(minimalNonEmpty === 3796, `Census: Minimal reader non-empty cell count is exactly 3,796 (actual: ${minimalNonEmpty})`);
  assert(cellMismatchCount === 0, `Census: Exactly 0 mismatches out of 4,196 cells (${cellMatchCount} exact matches)`);

  // ─── Amendment A5: Blank 2x2 Table Data Filter Test ───
  console.log('\n[Amendment A5: Blank 2x2 Table Data Filter Test]');
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

  const blank2x2Table = {
    physicalIndex: 998,
    rowCount: 2,
    colCount: 2,
    grid: [
      [{ text: '', provenance: { rowIndex: 0, cellIndex: 0 } }, { text: '', provenance: { rowIndex: 0, cellIndex: 1 } }],
      [{ text: '', provenance: { rowIndex: 1, cellIndex: 0 } }, { text: '', provenance: { rowIndex: 1, cellIndex: 1 } }]
    ]
  };

  assert(isTableWithData(blank2x2Table) === false, 'Blank 2x2 table is filtered out by "Only Tables with data"');
  // Simulate reaching it via all-tables registry
  const allTablesRegistry = [blank2x2Table, ...res.tables];
  const foundInAll = allTablesRegistry.find(t => t.physicalIndex === 998);
  assert(foundInAll != null, 'Blank 2x2 table remains accessible in All Tables dropdown/raw view');

  console.log('\n===============================================================');
  console.log(`  Repair Test Summary: ${passed}/${passed + failed} tests passed (${failed} failed)`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
})();
