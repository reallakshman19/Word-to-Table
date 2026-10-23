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

  console.log('\n===============================================================');
  console.log(`  Step 0 Test Summary: ${passed}/${passed + failed} tests passed (${failed} failed)`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
})();
