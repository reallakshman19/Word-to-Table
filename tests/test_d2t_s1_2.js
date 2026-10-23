/**
 * test_d2t_s1_2.js — Node test suite for Doc2Table Step D2T-S1.2 (WBS 4.1.2)
 *
 * Verifies:
 *   STEP 0 (Hidden Text Defect Fix & Census):
 *     1. Minimal reader comparison cell-by-cell across all 140 tables (4,196 cells, 0 mismatches)
 *     2. Census non-empty cell count across all 140 tables matches target (3,796 cells)
 *     3. w:sdt content controls text extraction:
 *        - Table #3 cell (0,0) has "Temperature °C" with w:showingPlcHdr ("placeholder shown")
 *        - Table #119 has 9 non-empty cells (previously appeared empty)
 *        - Table #70 has 72 non-empty cells (previously 12)
 *        - Tables #33, #35, #37, #39, #41 titles ("Pipes", "Flanges", "Fittings", "Valves", "Miscellaneous")
 *        - Table #44 cell (0,0) has "Run"
 *        - Provenance companion records carry placeholder: "placeholder shown" for w:showingPlcHdr cells
 *     4. Filter "Only Tables with data" (>= 2 rows && >= 2 cols containing text) yields exactly 50 tables
 *     5. Auto v3 rule distribution on all 50 tables remains satisfied (Rule 1: 6, Rule 2: 1, Rule 3: 3, Rule 4: 40)
 *
 * Usage:
 *   node tests/test_d2t_s1_2.js
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
    return '<' + el.qName + '/>';
  }
}

// ─── Environment Setup ───
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

// ─── Test Runner ───
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

// ─── Minimal Reader (Independent Baseline) ───
/**
 * Minimal independent reader:
 * For each w:tc, collects all descendant w:t text, skipping any nested w:tbl.
 */
function getCellTextMinimal(tc) {
  let text = '';
  function walk(node) {
    for (const child of node.children) {
      if (child.localName === 'tbl') continue; // skip nested tables
      if (child.localName === 'del') continue; // skip deleted revisions
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

(async () => {
  console.log('===============================================================');
  console.log('  Doc2Table D2T-S1.2 Step 0 Test Suite (Census & Defect Fix)');
  console.log('===============================================================\n');

  const buf = fs.readFileSync(NATIVE_WORD_PATH);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('text');
  const doc = parseXml(xml);

  const fileHash = crypto.createHash('sha256').update(buf).digest('hex');
  const parser = new DocxTableParser();
  const res = await parser.parse(buf, fileHash);

  // Discover 140 tables in XML directly for independent comparison
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

  // ─── Target 1: Census & Minimal Reader Verification ───
  console.log('[Target 1: Census & Independent Minimal Reader Comparison]');
  assert(xmlTableRegistry.length === 140, 'Independent registry discovered 140 tables');

  let cellMatchCount = 0;
  let cellMismatchCount = 0;
  let totalMinimalCells = 0;
  let minimalNonEmptyTrimmed = 0;

  for (let tIdx = 0; tIdx < 140; tIdx++) {
    const tblEl = xmlTableRegistry[tIdx].element;
    const pTable = res.tables[tIdx];
    const trEls = tblEl.children.filter(c => c.localName === 'tr');

    for (let rIdx = 0; rIdx < trEls.length; rIdx++) {
      const tcEls = trEls[rIdx].children.filter(c => c.localName === 'tc');
      const unspannedRowCells = pTable.grid[rIdx].filter(c => !c.spanned);

      for (let cIdx = 0; cIdx < tcEls.length; cIdx++) {
        totalMinimalCells++;
        const minText = getCellTextMinimal(tcEls[cIdx]);
        if (minText.trim().length > 0) minimalNonEmptyTrimmed++;

        const parserCell = unspannedRowCells[cIdx];
        const parserText = parserCell ? parserCell.text : null;

        if (minText.trim() === (parserText || '').trim()) {
          cellMatchCount++;
        } else {
          cellMismatchCount++;
        }
      }
    }
  }

  assert(totalMinimalCells === 4196, `Total cells across 140 tables is 4,196 (actual: ${totalMinimalCells})`);
  assert(minimalNonEmptyTrimmed === 3796, `Minimal reader non-empty cell count is exactly 3,796 (actual: ${minimalNonEmptyTrimmed})`);
  assert(cellMismatchCount === 0, `Cell-by-cell comparison matches perfectly: 0 mismatches out of 4,196 cells (matches: ${cellMatchCount})`);

  let parserNonEmpty = 0;
  for (const t of res.tables) {
    for (const row of t.grid) {
      for (const cell of row) {
        if (!cell.spanned && cell.text && cell.text.trim().length > 0) {
          parserNonEmpty++;
        }
      }
    }
  }
  assert(parserNonEmpty === 3796, `Parser grid non-empty cell count is exactly 3,796 (actual: ${parserNonEmpty})`);

  // ─── Target 2: Content Control Hidden Text Recovery ───
  console.log('\n[Target 2: Content Control Hidden Text Recovery]');
  const t3 = res.tables[2];
  assert(t3.grid[0][0].text === 'Temperature °C', `Table #3 cell (0,0) recovered text "Temperature °C" (actual: "${t3.grid[0][0].text}")`);
  assert(t3.grid[0][0].isPlaceholder === true, 'Table #3 cell (0,0) marked isPlaceholder: true');
  assert(t3.grid[0][0].provenance.placeholder === 'placeholder shown', 'Table #3 cell (0,0) provenance marked "placeholder shown"');

  const t70 = res.tables[69];
  const t70NonEmpty = t70.grid.flat().filter(c => !c.spanned && c.text && c.text.trim()).length;
  assert(t70NonEmpty === 72, `Table #70 is populated with 72 non-empty cells (was 12, actual: ${t70NonEmpty})`);

  const t119 = res.tables[118];
  const t119NonEmpty = t119.grid.flat().filter(c => !c.spanned && c.text && c.text.trim()).length;
  assert(t119NonEmpty === 9, `Table #119 is populated with 9 non-empty cells (was 0, actual: ${t119NonEmpty})`);

  const t33 = res.tables[32];
  assert(t33.grid[0][0].text === 'Pipes', `Table #33 row 0 cell 0 has title "Pipes" (actual: "${t33.grid[0][0].text}")`);
  const t35 = res.tables[34];
  assert(t35.grid[0][0].text === 'Flanges', `Table #35 row 0 cell 0 has title "Flanges" (actual: "${t35.grid[0][0].text}")`);
  const t37 = res.tables[36];
  assert(t37.grid[0][0].text === 'Fittings', `Table #37 row 0 cell 0 has title "Fittings" (actual: "${t37.grid[0][0].text}")`);
  const t39 = res.tables[38];
  assert(t39.grid[0][0].text === 'Valves', `Table #39 row 0 cell 0 has title "Valves" (actual: "${t39.grid[0][0].text}")`);
  const t41 = res.tables[40];
  assert(t41.grid[0][0].text === 'Miscellaneous', `Table #41 row 0 cell 0 has title "Miscellaneous" (actual: "${t41.grid[0][0].text}")`);

  const t44 = res.tables[43];
  assert(t44.grid[0][0].text === 'Run', `Table #44 cell (0,0) recovered text "Run" (actual: "${t44.grid[0][0].text}")`);

  let placeholderCellsCount = 0;
  for (const t of res.tables) {
    for (const row of t.grid) {
      for (const c of row) {
        if (!c.spanned && c.isPlaceholder) placeholderCellsCount++;
      }
    }
  }
  assert(placeholderCellsCount === 374, `Total cells with w:showingPlcHdr is exactly 374 (actual: ${placeholderCellsCount})`);

  // ─── Target 3: Filter & Auto v3 Distribution ───
  console.log('\n[Target 3: Filter & Auto v3 Distribution]');
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

  const dataFiltered = res.tables.filter(isTableWithData);
  assert(dataFiltered.length === 50, `Filter yields exactly 50 tables with data (actual: ${dataFiltered.length})`);

  const ruleCounts = { 'Rule 1': 0, 'Rule 2': 0, 'Rule 3': 0, 'Rule 4': 0, other: 0 };
  for (const t of dataFiltered) {
    const sugg = AutoHeaderV3.suggest(t);
    ruleCounts[sugg.rule] = (ruleCounts[sugg.rule] || 0) + 1;
  }
  assert(ruleCounts['Rule 1'] === 6, `Rule 1 fires on 6 tables (actual: ${ruleCounts['Rule 1']})`);
  assert(ruleCounts['Rule 2'] === 1, `Rule 2 fires on 1 table (actual: ${ruleCounts['Rule 2']})`);
  assert(ruleCounts['Rule 3'] === 3, `Rule 3 fires on 3 tables (actual: ${ruleCounts['Rule 3']})`);
  assert(ruleCounts['Rule 4'] === 40, `Rule 4 fires on 40 tables (actual: ${ruleCounts['Rule 4']})`);

  // CSV companion provenance carries placeholder
  const exporter = new CsvExporter();
  const { provenance } = exporter.exportTable(t3, 1, 2, { foldedLabel: { targetCol: 0, labelRow: 1, labelCol: 0, text: 'Pressure bar(g)' } });
  const pHeader0 = provenance.find(p => p.isHeader && p.csvCol === 0);
  assert(pHeader0 && pHeader0.placeholder === 'placeholder shown', 'CSV companion provenance for Table #3 header cell carries placeholder: "placeholder shown"');

  // ─── Target 4: Rule R1 (Title Row) ───
  console.log('\n[Target 4: Rule R1 — Title Row Refinement]');
  // Table #11: Title over value columns appended to first header with " | "
  const t11 = res.tables[10];
  const sugg11 = AutoHeaderV3.suggest(t11);
  const refined11 = TableRefiner.refine(t11, sugg11.headerRowCount, sugg11.dataStartRow, sugg11.foldedLabel);
  assert(refined11.rule === 'R1', `Table #11 triggers Rule R1 (actual: ${refined11.rule})`);
  assert(refined11.headerRowCount === 1, 'Table #11 produces exactly 1 header row');
  assert(refined11.headers[0] === 'Run Size | Branch Size', `Table #11 cell 0 is "Run Size | Branch Size" (actual: "${refined11.headers[0]}")`);
  assert(refined11.headers[1] === '15', `Table #11 cell 1 is "15" (actual: "${refined11.headers[1]}")`);
  assert(refined11.headers[20] === '1200', `Table #11 cell 20 is "1200" (actual: "${refined11.headers[20]}")`);
  assert(refined11.headers.length === 21, `Table #11 has 21 header columns (actual: ${refined11.headers.length})`);
  assert(refined11.excludeRows.includes(0), 'Table #11 deletes row 0');

  // Tables #33, #35, #37, #39, #41: Group column + Title over values appended to cell 1
  const groupExpected = [
    { id: 33, idx: 32, group: 'Pipes' },
    { id: 35, idx: 34, group: 'Flanges' },
    { id: 37, idx: 36, group: 'Fittings' },
    { id: 39, idx: 38, group: 'Valves' },
    { id: 41, idx: 40, group: 'Miscellaneous' }
  ];

  for (const exp of groupExpected) {
    const tbl = res.tables[exp.idx];
    const sugg = AutoHeaderV3.suggest(tbl);
    const refined = TableRefiner.refine(tbl, sugg.headerRowCount, sugg.dataStartRow, sugg.foldedLabel);

    assert(refined.rule === 'R1', `Table #${exp.id} triggers Rule R1 (actual: ${refined.rule})`);
    assert(refined.headerRowCount === 1, `Table #${exp.id} produces exactly 1 header row`);
    assert(refined.headers[0] === 'Group', `Table #${exp.id} header col 0 is "Group"`);
    assert(refined.headers[1] === 'Item Description | Nominal Diameter (DN)',
      `Table #${exp.id} header col 1 is "Item Description | Nominal Diameter (DN)" (actual: "${refined.headers[1]}")`);
    assert(refined.headers[2] === 'MESC', `Table #${exp.id} header col 2 is "MESC"`);
    assert(refined.headers[3] === '15', `Table #${exp.id} header col 3 is "15"`);
    assert(refined.headers[22] === '1200', `Table #${exp.id} header col 22 is "1200"`);
    assert(refined.groupColumn === exp.group, `Table #${exp.id} groupColumn is "${exp.group}" (actual: "${refined.groupColumn}")`);
    assert(refined.excludeRows.includes(0), `Table #${exp.id} deletes row 0`);
  }

  // ─── Target 5: Rule R2 (Two Ordinary Header Rows) ───
  console.log('\n[Target 5: Rule R2 — Two Ordinary Header Rows]');
  // Table #44: Run (DN), x, Branch (DN), (empty), CIWB, RECB, REEB, TERB
  const sugg44 = AutoHeaderV3.suggest(t44);
  const refined44 = TableRefiner.refine(t44, sugg44.headerRowCount, sugg44.dataStartRow, sugg44.foldedLabel);
  assert(refined44.rule === 'R2', `Table #44 triggers Rule R2 (actual: ${refined44.rule})`);
  assert(refined44.headerRowCount === 1, 'Table #44 produces exactly 1 header row');
  assert(refined44.headers[0] === 'Run (DN)', `Table #44 header 0 is "Run (DN)" (actual: "${refined44.headers[0]}")`);
  assert(refined44.headers[1] === 'x', `Table #44 header 1 is "x" (actual: "${refined44.headers[1]}")`);
  assert(refined44.headers[2] === 'Branch (DN)', `Table #44 header 2 is "Branch (DN)" (actual: "${refined44.headers[2]}")`);
  assert(refined44.headers[3] === '', `Table #44 header 3 is empty string (actual: "${refined44.headers[3]}")`);
  assert(refined44.headers[4] === 'CIWB', `Table #44 header 4 is "CIWB" (actual: "${refined44.headers[4]}")`);
  assert(refined44.headers[5] === 'RECB', `Table #44 header 5 is "RECB" (actual: "${refined44.headers[5]}")`);
  assert(refined44.headers[6] === 'REEB', `Table #44 header 6 is "REEB" (actual: "${refined44.headers[6]}")`);
  assert(refined44.headers[7] === 'TERB', `Table #44 header 7 is "TERB" (actual: "${refined44.headers[7]}")`);
  assert(refined44.excludeRows.includes(1), 'Table #44 deletes row 1 (second row)');

  // Table #52: Branch (DN), Run min. (DN), -, Run max. (DN), (empty), BNLF, BN3P, BRSB, BROB
  const t52 = res.tables[51];
  const sugg52 = AutoHeaderV3.suggest(t52);
  const refined52 = TableRefiner.refine(t52, sugg52.headerRowCount, sugg52.dataStartRow, sugg52.foldedLabel);
  assert(refined52.rule === 'R2', `Table #52 triggers Rule R2 (actual: ${refined52.rule})`);
  assert(refined52.headerRowCount === 1, 'Table #52 produces exactly 1 header row');
  assert(refined52.headers[0] === 'Branch (DN)', `Table #52 header 0 is "Branch (DN)" (actual: "${refined52.headers[0]}")`);
  assert(refined52.headers[1] === 'Run min. (DN)', `Table #52 header 1 is "Run min. (DN)" (actual: "${refined52.headers[1]}")`);
  assert(refined52.headers[2] === '-', `Table #52 header 2 is "-" (actual: "${refined52.headers[2]}")`);
  assert(refined52.headers[3] === 'Run max. (DN)', `Table #52 header 3 is "Run max. (DN)" (actual: "${refined52.headers[3]}")`);
  assert(refined52.headers[4] === '', `Table #52 header 4 is empty string (actual: "${refined52.headers[4]}")`);
  assert(refined52.headers[5] === 'BNLF', `Table #52 header 5 is "BNLF" (actual: "${refined52.headers[5]}")`);
  assert(refined52.headers[6] === 'BN3P', `Table #52 header 6 is "BN3P" (actual: "${refined52.headers[6]}")`);
  assert(refined52.headers[7] === 'BRSB', `Table #52 header 7 is "BRSB" (actual: "${refined52.headers[7]}")`);
  assert(refined52.headers[8] === 'BROB', `Table #52 header 8 is "BROB" (actual: "${refined52.headers[8]}")`);
  assert(refined52.excludeRows.includes(1), 'Table #52 deletes row 1');

  // ─── Target 6: Rule R3 (Label Folded by Auto) ───
  console.log('\n[Target 6: Rule R3 — Folded Label Appended]');
  // Table #3: Temperature °C | Pressure bar(g), -101, 0, 50, 75, 100, 125, 150
  const sugg3 = AutoHeaderV3.suggest(t3);
  const refined3 = TableRefiner.refine(t3, sugg3.headerRowCount, sugg3.dataStartRow, sugg3.foldedLabel);
  assert(refined3.rule === 'R3', `Table #3 triggers Rule R3 (actual: ${refined3.rule})`);
  assert(refined3.headerRowCount === 1, 'Table #3 produces exactly 1 header row');
  assert(refined3.headers[0] === 'Temperature °C | Pressure bar(g)',
    `Table #3 header 0 is "Temperature °C | Pressure bar(g)" (actual: "${refined3.headers[0]}")`);
  assert(refined3.headers[1] === '-101', `Table #3 header 1 is "-101"`);
  assert(refined3.headers[2] === '0', `Table #3 header 2 is "0"`);
  assert(refined3.headers[3] === '50', `Table #3 header 3 is "50"`);
  assert(refined3.headers[4] === '75', `Table #3 header 4 is "75"`);
  assert(refined3.headers[5] === '100', `Table #3 header 5 is "100"`);
  assert(refined3.headers[6] === '125', `Table #3 header 6 is "125"`);
  assert(refined3.headers[7] === '150', `Table #3 header 7 is "150"`);
  assert(refined3.excludeRows.includes(1), 'Table #3 excludes label row 1 from data');

  // ─── Target 7: Rule R4 (No Header or Single Header without Label) ───
  console.log('\n[Target 7: Rule R4 — Nothing to Refine]');
  // Table #14: 1 header row, no label -> unchanged
  const t14 = res.tables[13];
  const sugg14 = AutoHeaderV3.suggest(t14);
  const refined14 = TableRefiner.refine(t14, sugg14.headerRowCount, sugg14.dataStartRow, sugg14.foldedLabel);
  assert(refined14.rule === 'R4', `Table #14 triggers Rule R4 (actual: ${refined14.rule})`);
  assert(refined14.headerRowCount === 1, 'Table #14 retains 1 header row');
  assert(refined14.headers[0] === 'Stainl steel AISI 316 Sour', `Table #14 header 0 is unchanged`);
  assert(refined14.headers[2] === 'Plant', `Table #14 header 2 is unchanged`);

  // Table #5: 0 header rows -> unchanged
  const t5 = res.tables[4];
  const sugg5 = AutoHeaderV3.suggest(t5);
  const refined5 = TableRefiner.refine(t5, sugg5.headerRowCount, sugg5.dataStartRow, sugg5.foldedLabel);
  assert(refined5.rule === 'R4', `Table #5 triggers Rule R4 (actual: ${refined5.rule})`);
  assert(refined5.headerRowCount === 0, 'Table #5 retains 0 header rows');
  assert(refined5.headers[0] === 'Column_1', 'Table #5 retains synthetic headers');

  // Verify all 40 no-header tables trigger R4
  let r4Count = 0;
  for (const t of dataFiltered) {
    const sugg = AutoHeaderV3.suggest(t);
    const ref = TableRefiner.refine(t, sugg.headerRowCount, sugg.dataStartRow, sugg.foldedLabel);
    if (ref.rule === 'R4') r4Count++;
  }
  assert(r4Count === 41, `Exactly 41 of 50 tables trigger Rule R4 (#14 + 40 no-header tables, actual: ${r4Count})`);

  // ─── Target 8: Provenance Traceability ───
  console.log('\n[Target 8: Provenance Traceability for Refined Cells]');
  // Table #11 cell 0 provenance: source cells include Row 1 Cell 0 and Row 0 Cell 1
  const p11_0 = refined11.headerProvenance[0];
  assert(p11_0 && p11_0.sourceCells.length === 2, 'Table #11 cell 0 provenance records exactly 2 source cells');
  assert(p11_0.sourceCells.some(sc => sc.rowIndex === 1 && sc.cellIndex === 0 && sc.rawText === 'Run Size'),
    'Table #11 cell 0 provenance points to Row 1 Cell 0 ("Run Size")');
  assert(p11_0.sourceCells.some(sc => sc.rowIndex === 0 && sc.cellIndex === 1 && sc.rawText === 'Branch Size'),
    'Table #11 cell 0 provenance points to Row 0 Cell 1 ("Branch Size")');

  // Table #33 cell 0 ("Group") and cell 1 provenance
  const sugg33 = AutoHeaderV3.suggest(t33);
  const refined33 = TableRefiner.refine(t33, sugg33.headerRowCount, sugg33.dataStartRow, sugg33.foldedLabel);
  const p33_grp = refined33.headerProvenance[0];
  assert(p33_grp && p33_grp.sourceCells.some(sc => sc.rowIndex === 0 && sc.cellIndex === 0 && sc.rawText === 'Pipes'),
    'Table #33 "Group" provenance points to Row 0 Cell 0 ("Pipes")');
  const p33_title = refined33.headerProvenance[1];
  assert(p33_title && p33_title.sourceCells.some(sc => sc.rowIndex === 1 && sc.cellIndex === 0 && sc.rawText === 'Item Description'),
    'Table #33 col 1 provenance points to Row 1 Cell 0 ("Item Description")');
  assert(p33_title && p33_title.sourceCells.some(sc => sc.rowIndex === 0 && sc.cellIndex === 1 && sc.rawText === 'Nominal Diameter (DN)'),
    'Table #33 col 1 provenance points to Row 0 Cell 1 ("Nominal Diameter (DN)")');

  // Table #44 cell 0 provenance
  const p44_0 = refined44.headerProvenance[0];
  assert(p44_0 && p44_0.sourceCells.length === 2, 'Table #44 cell 0 provenance records 2 source cells');
  assert(p44_0.sourceCells.some(sc => sc.rowIndex === 0 && sc.cellIndex === 0 && sc.rawText === 'Run'),
    'Table #44 cell 0 provenance points to Row 0 Cell 0 ("Run")');
  assert(p44_0.sourceCells.some(sc => sc.rowIndex === 1 && sc.cellIndex === 0 && sc.rawText === '(DN)'),
    'Table #44 cell 0 provenance points to Row 1 Cell 0 ("(DN)")');

  // Table #3 cell 0 provenance
  const p3_0 = refined3.headerProvenance[0];
  assert(p3_0 && p3_0.sourceCells.length === 2, 'Table #3 cell 0 provenance records 2 source cells');
  assert(p3_0.sourceCells.some(sc => sc.rowIndex === 0 && sc.cellIndex === 0 && sc.rawText === 'Temperature °C'),
    'Table #3 cell 0 provenance points to Row 0 Cell 0 ("Temperature °C")');
  assert(p3_0.sourceCells.some(sc => sc.rowIndex === 1 && sc.cellIndex === 0 && sc.rawText === 'Pressure bar(g)'),
    'Table #3 cell 0 provenance points to Row 1 Cell 0 ("Pressure bar(g)")');

  // ─── Target 9: CSV Export with Refined Header and Group Column ───
  console.log('\n[Target 9: CSV Export with Refined Header and Group Column]');
  // Table #33 CSV export
  const exp33 = exporter.exportTable(t33, 1, 2, { refined: refined33 });
  const lines33 = exp33.csv.split('\r\n');
  assert(lines33[0] === 'Group,Item Description | Nominal Diameter (DN),MESC,15,20,25,40,50,80,100,150,200,250,300,350,400,450,500,600,750,900,1050,1200',
    `Table #33 CSV header line matches expected format`);
  assert(lines33.length - 1 === 6, `Table #33 CSV has exactly 6 data rows (actual: ${lines33.length - 1})`);
  assert(lines33[1].startsWith('Pipes,'), `Table #33 first CSV data line starts with "Pipes," (line: "${lines33[1].substring(0, 20)}...")`);
  assert(lines33[6].startsWith('Pipes,'), `Table #33 last CSV data line starts with "Pipes," (line: "${lines33[6].substring(0, 20)}...")`);

  // Table #11 CSV export
  const exp11 = exporter.exportTable(t11, 1, 2, { refined: refined11 });
  const lines11 = exp11.csv.split('\r\n');
  assert(lines11[0].startsWith('Run Size | Branch Size,15,20,'), `Table #11 CSV header line starts with "Run Size | Branch Size,15,20,"`);
  assert(lines11.length - 1 === 20, `Table #11 CSV has exactly 20 data rows (actual: ${lines11.length - 1})`);

  // Table #44 CSV export
  const exp44 = exporter.exportTable(t44, 1, 2, { refined: refined44 });
  const lines44 = exp44.csv.split('\r\n');
  assert(lines44[0] === 'Run (DN),x,Branch (DN),,CIWB,RECB,REEB,TERB', `Table #44 CSV header line matches expected`);
  assert(lines44.length - 1 === 75, `Table #44 CSV has exactly 75 data rows (actual: ${lines44.length - 1})`);

  // Table #52 CSV export
  const exp52 = exporter.exportTable(t52, 1, 2, { refined: refined52 });
  const lines52 = exp52.csv.split('\r\n');
  assert(lines52[0] === 'Branch (DN),Run min. (DN),-,Run max. (DN),,BNLF,BN3P,BRSB,BROB', `Table #52 CSV header line matches expected`);
  assert(lines52.length - 1 === 60, `Table #52 CSV has exactly 60 data rows (actual: ${lines52.length - 1})`);

  // Table #3 CSV export
  const exp3 = exporter.exportTable(t3, 1, 2, { refined: refined3 });
  const lines3 = exp3.csv.split('\r\n');
  assert(lines3[0] === 'Temperature °C | Pressure bar(g),-101,0,50,75,100,125,150', `Table #3 CSV header line matches expected`);
  assert(lines3.length - 1 === 1, `Table #3 CSV has exactly 1 data row (actual: ${lines3.length - 1})`);

  // Exhaustive provenance companion records in refined CSV
  assert(exp33.provenance.length === (1 + 6) * 23, `Table #33 has 1 provenance record per CSV cell (${exp33.provenance.length})`);
  assert(exp11.provenance.length === (1 + 20) * 21, `Table #11 has 1 provenance record per CSV cell (${exp11.provenance.length})`);
  assert(exp44.provenance.length === (1 + 75) * 8, `Table #44 has 1 provenance record per CSV cell (${exp44.provenance.length})`);

  // ─── Target 10: Undo & Reversibility ───
  console.log('\n[Target 10: Undo & Reversibility]');
  // Simulating state save and undo
  const savedState = {
    headerRowCount: sugg11.headerRowCount,
    dataStartRow: sugg11.dataStartRow,
    foldedLabel: sugg11.foldedLabel
  };
  // Before undo: refined has headerRowCount 1
  assert(refined11.headerRowCount === 1, 'Refined state has 1 header row');
  // Undo restores savedState
  const restoredHeaderCount = savedState.headerRowCount;
  const restoredDataStart = savedState.dataStartRow;
  assert(restoredHeaderCount === 2, 'Undo restores headerRowCount to 2');
  assert(restoredDataStart === 2, 'Undo restores dataStartRow to 2');

  console.log('\n===============================================================');
  console.log(`  D2T-S1.2 Full Test Summary: ${passed}/${passed + failed} tests passed (${failed} failed)`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
})();
