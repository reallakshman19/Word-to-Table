/**
 * docx-table-parser.js — Browser-based DOCX table parser with full provenance tracking
 *
 * Extracts native Word tables from .docx files, handling:
 *   - Body-level and nested tables (w:tbl)
 *   - Horizontal spans (gridSpan) with grid normalization
 *   - Leading-zero text preservation ("031" stays "031")
 *   - Images (w:drawing, w:pict) detection
 *   - Nested table detection and cross-referencing
 *   - Per-cell provenance (fileHash, part, tableIndex, row, col)
 *
 * Dependencies: JSZip (global, loaded via <script> tag)
 *
 * Usage:
 *   const parser = new DocxTableParser();
 *   const result = await parser.parse(arrayBuffer, sha256Hash);
 *   // result.tables, result.bodyLevelCount, result.totalCount, etc.
 */

(function () {
  'use strict';

  // ─── Namespace constants ───────────────────────────────────────────────
  const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const DRAWING_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // Drawing elements live in the main namespace as w:drawing; we also check
  // the VML fallback (w:pict) which shares the same namespace.

  /**
   * DocxTableParser — Main parser class.
   *
   * Assigned to window.DocxTableParser for use without a bundler.
   */
  class DocxTableParser {
    constructor() {
      /** @type {string[]} Diagnostic log lines */
      this.logs = [];
    }

    // ─── Logging ─────────────────────────────────────────────────────────

    /** Append a timestamped log entry. */
    _log(level, msg) {
      const ts = new Date().toISOString();
      this.logs.push(`${ts} | ${level.toUpperCase().padEnd(5)} | ${msg}`);
    }

    // ─── Public API ──────────────────────────────────────────────────────

    /**
     * Parse a .docx ArrayBuffer and extract all tables.
     *
     * @param {ArrayBuffer} fileBuffer  — raw .docx bytes
     * @param {string}      fileHash   — SHA-256 hex string of the file
     * @returns {Promise<Object>}       — parsed result (see return shape below)
     */
    async parse(fileBuffer, fileHash) {
      this.logs = [];
      this._log('info', '=== DocxTableParser.parse() started ===');

      // ── 1. Validate JSZip availability ──────────────────────────────
      if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library is not loaded. Include jszip.min.js before this script.');
      }

      // ── 2. Unzip the .docx and read word/document.xml ───────────────
      const zip = await JSZip.loadAsync(fileBuffer);
      const docEntry = zip.file('word/document.xml');
      if (!docEntry) {
        throw new Error('Invalid .docx: missing word/document.xml');
      }
      const xmlText = await docEntry.async('string');
      this._log('info', `Loaded word/document.xml (${xmlText.length} chars)`);

      // ── 3. Parse the XML ────────────────────────────────────────────
      const domParser = new DOMParser();
      const xmlDoc = domParser.parseFromString(xmlText, 'application/xml');

      // Check for parse errors
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) {
        throw new Error(`XML parse error: ${parseError.textContent}`);
      }

      const bodies = xmlDoc.getElementsByTagNameNS(WORD_NS, 'body');
      if (bodies.length === 0) {
        throw new Error('Invalid document structure: no w:body element found');
      }
      const body = bodies[0];

      // ── 4. Discover body-level tables (direct children only) ────────
      //
      // IMPORTANT: We walk body.children manually instead of using
      // getElementsByTagNameNS, which would also capture nested tables.
      const bodyLevelTableElements = [];
      for (const child of body.children) {
        if ((child.localName === 'tbl' || child.nodeName === 'w:tbl') &&
            (child.namespaceURI === WORD_NS || !child.namespaceURI || child.prefix === 'w')) {
          bodyLevelTableElements.push(child);
        }
      }
      this._log('info', `Found ${bodyLevelTableElements.length} body-level w:tbl elements`);

      // ── 5. Build the full table list (body-level + nested) ──────────
      //
      // Strategy: Walk body-level tables in order. For each, check cells
      // for nested w:tbl elements. Assign a sequential physicalIndex to
      // every table encountered (1-based).
      //
      // We use a two-pass approach:
      //   Pass 1: Discover all tables and their parent–child relationships.
      //   Pass 2: Parse each table into row/cell data.

      /** @type {{ element: Element, isNested: boolean, parentPhysicalIndex: number|null, bodyIndex: number|null }[]} */
      const tableRegistry = [];

      // Recursive function to register a table element and discover nested tables.
      const registerTable = (tblElement, isNested, parentPhysicalIndex) => {
        const physicalIndex = tableRegistry.length + 1; // 1-based
        const entry = {
          element: tblElement,
          isNested,
          parentPhysicalIndex,
          bodyIndex: null, // set for body-level only
          nestedTableIndices: [],
        };
        tableRegistry.push(entry);

        // Scan cells for nested tables — we only look one level deep per cell
        // because the recursive call will handle deeper nesting.
        const rows = this._directChildrenByTag(tblElement, 'tr');
        for (const row of rows) {
          const cells = this._directChildrenByTag(row, 'tc');
          for (const cell of cells) {
            const nestedTbls = this._directChildrenByTag(cell, 'tbl');
            for (const nestedTbl of nestedTbls) {
              const nestedIdx = registerTable(nestedTbl, true, physicalIndex);
              entry.nestedTableIndices.push(nestedIdx);
            }
          }
        }

        return physicalIndex;
      };

      let bodyIdx = 0;
      for (const tblEl of bodyLevelTableElements) {
        bodyIdx++;
        const physIdx = registerTable(tblEl, false, null);
        tableRegistry[physIdx - 1].bodyIndex = bodyIdx;
      }

      const bodyLevelCount = bodyIdx;
      const nestedCount = tableRegistry.length - bodyLevelCount;
      this._log('info', `Total tables: ${tableRegistry.length} (${bodyLevelCount} body-level, ${nestedCount} nested)`);

      // ── 6. Parse each table ─────────────────────────────────────────
      const xmlSerializer = new XMLSerializer();
      const tables = [];

      for (let i = 0; i < tableRegistry.length; i++) {
        const reg = tableRegistry[i];
        const physicalIndex = i + 1;
        const tableObj = this._parseTable(
          reg.element,
          xmlSerializer,
          fileHash,
          physicalIndex,
          reg
        );
        tables.push(tableObj);
      }

      // ── 7. Count images in the document (for screenshot-only detection) ──
      const drawingEls = xmlDoc.getElementsByTagNameNS ? xmlDoc.getElementsByTagNameNS(WORD_NS, 'drawing') : [];
      const pictEls = xmlDoc.getElementsByTagNameNS ? xmlDoc.getElementsByTagNameNS(WORD_NS, 'pict') : [];
      let imageCount = (drawingEls ? drawingEls.length : 0) + (pictEls ? pictEls.length : 0);
      if (imageCount === 0) {
        const d2 = xmlDoc.getElementsByTagName('w:drawing');
        const p2 = xmlDoc.getElementsByTagName('w:pict');
        imageCount = (d2 ? d2.length : 0) + (p2 ? p2.length : 0);
      }
      if (imageCount > 0) {
        this._log('info', `Document contains ${imageCount} image(s)`);
      }

      // ── 8. Assemble the result ──────────────────────────────────────
      const result = {
        fileHash,
        part: 'word/document.xml',
        tables,
        bodyLevelCount,
        nestedCount,
        totalCount: tableRegistry.length,
        xmlLength: xmlText.length,
        imageCount,
      };

      this._log('info', `=== Parse complete: ${result.totalCount} tables extracted ===`);
      return result;
    }

    // ─── Table parsing ───────────────────────────────────────────────────

    /**
     * Parse a single w:tbl element into a structured table object.
     *
     * @param {Element}       tblElement     — the w:tbl DOM element
     * @param {XMLSerializer}  xmlSerializer — shared serializer instance
     * @param {string}         fileHash      — SHA-256 of the source file
     * @param {number}         physicalIndex — 1-based index among ALL tables
     * @param {Object}         regEntry      — registry entry with nesting info
     * @returns {Object}                     — parsed table object
     */
    _parseTable(tblElement, xmlSerializer, fileHash, physicalIndex, regEntry) {
      // ── Raw XML source of the table ────────────────────────────────
      const rawXml = xmlSerializer.serializeToString(tblElement);

      // ── Walk rows (direct children only) ───────────────────────────
      const rowElements = this._directChildrenByTag(tblElement, 'tr');
      const physicalGrid = [];
      let hasSpans = false;

      for (let rIdx = 0; rIdx < rowElements.length; rIdx++) {
        const rowEl = rowElements[rIdx];
        const cellElements = this._directChildrenByTag(rowEl, 'tc');
        const rowCells = [];

        for (let cIdx = 0; cIdx < cellElements.length; cIdx++) {
          const cellEl = cellElements[cIdx];
          const cell = this._parseCell(cellEl, fileHash, physicalIndex, rIdx, cIdx, regEntry);
          if (cell.gridSpan > 1) {
            hasSpans = true;
          }
          rowCells.push(cell);
        }

        physicalGrid.push(rowCells);
      }

      // ── Grid normalization ─────────────────────────────────────────
      // Expand gridSpan cells into additional spanned placeholder cells,
      // then pad all rows to the maximum column count.
      const normalizedGrid = this._normalizeGrid(physicalGrid);

      // Compute max column count from normalized grid
      let colCount = 0;
      for (const row of normalizedGrid) {
        if (row.length > colCount) colCount = row.length;
      }

      // ── Row metadata for Auto Header v3 & diagnostics ──────────────
      const rowMetadata = [];
      for (let r = 0; r < normalizedGrid.length; r++) {
        const row = normalizedGrid[r];
        const sourceCellCount = physicalGrid[r] ? physicalGrid[r].length : row.length;
        const placeholders = row.filter(c => c.spanned).length;
        const nonEmpty = row.filter(c => c.text && c.text.trim().length > 0).length;
        const hasTextInRow = row.some(c => c.hasText);
        const allBoldInRow = hasTextInRow && row.filter(c => c.hasText).every(c => c.isBold);
        const isBand = placeholders >= 3 && nonEmpty <= 2;
        rowMetadata.push({
          rowIndex: r,
          sourceCellCount,
          placeholders,
          nonEmpty,
          hasText: hasTextInRow,
          allBold: allBoldInRow,
          isBand,
        });
      }

      // ── Build table object (flat structure for easy consumption) ────
      return {
        physicalIndex,                              // 1-based among all tables (140)
        bodyIndex: regEntry.bodyIndex,               // 1-based among body-level (131), or null
        isNested: regEntry.isNested,
        parentTableIndex: regEntry.parentPhysicalIndex,
        rowCount: normalizedGrid.length,
        colCount,
        hasSpans,
        nestedTableIndices: regEntry.nestedTableIndices,
        grid: normalizedGrid,
        rowMetadata,
        sourceXml: rawXml,
        sourceFileHash: fileHash,
        sourcePart: 'word/document.xml',
        sourceTableIndex: physicalIndex,
      };
    }

    // ─── Cell parsing ────────────────────────────────────────────────────

    /**
     * Parse a single w:tc element into a cell object.
     *
     * @param {Element} cellEl        — the w:tc DOM element
     * @param {string}  fileHash      — SHA-256 of the source file
     * @param {number}  tableIndex    — 1-based physical table index
     * @param {number}  rowIndex      — 0-based row index within the table
     * @param {number}  cellIndex     — 0-based cell index within the row
     * @param {Object}  regEntry      — registry entry (for nested table refs)
     * @returns {Object}              — cell object
     */
    _parseCell(cellEl, fileHash, tableIndex, rowIndex, cellIndex, regEntry) {
      const xmlSerializer = new XMLSerializer();

      // ── gridSpan ───────────────────────────────────────────────────
      const gridSpan = this._getGridSpan(cellEl);

      // ── Nested table detection ─────────────────────────────────────
      const nestedTbls = this._directChildrenByTag(cellEl, 'tbl');
      const hasNestedTable = nestedTbls.length > 0;

      // Find the nested table's physical index from the registry
      let nestedTableIndex = null;
      if (hasNestedTable && nestedTbls.length > 0) {
        // Match the first nested table element to a registry entry
        nestedTableIndex = this._findNestedTableIndex(nestedTbls[0], regEntry);
      }

      // ── Image detection ────────────────────────────────────────────
      // Check for w:drawing or w:pict elements anywhere inside this cell,
      // but NOT inside nested tables.
      const hasImage = this._cellHasImage(cellEl);

      // ── Placeholder detection (w:showingPlcHdr) ───────────────────
      const isPlaceholder = this._cellIsPlaceholder(cellEl);

      // ── Text extraction ────────────────────────────────────────────
      // If the cell has an image, the text is "[image]".
      // Otherwise, extract text from w:p > w:r > w:t elements,
      // preserving leading zeros by treating everything as strings.
      let text;
      if (hasImage) {
        text = '[image]';
      } else {
        text = this._extractCellText(cellEl);
      }

      // ── Bold detection ─────────────────────────────────────────────
      const boldInfo = this._cellIsBold(cellEl);

      // ── Source XML of the cell ─────────────────────────────────────
      const sourceXml = xmlSerializer.serializeToString(cellEl);

      return {
        text,
        sourceXml,
        gridSpan,
        hasNestedTable,
        nestedTableIndex,
        hasImage,
        isPlaceholder,
        isBold: boldInfo.isBold,
        hasText: boldInfo.hasText,
        provenance: {
          fileHash,
          part: 'word/document.xml',
          tableIndex,
          rowIndex,
          cellIndex,
          placeholder: isPlaceholder ? 'placeholder shown' : null,
        },
      };
    }

    // ─── Text extraction ─────────────────────────────────────────────────

    /**
     * Extract text from a w:tc element.
     *
     * Rules:
     *   - Walk direct-child w:p paragraphs (skip nested table content)
     *   - Within each w:p, walk w:r runs
     *   - Within each w:r, concatenate w:t text, treat w:br and w:cr as newlines
     *   - Join paragraphs with newlines
     *   - Trim trailing empty paragraphs but preserve leading content
     *   - NEVER parse text as numbers — "031" must stay "031"
     *
     * @param {Element} cellEl — the w:tc element
     * @returns {string}       — extracted text
     */
    _extractCellText(cellEl) {
      const paragraphs = this._directChildrenByTag(cellEl, 'p');
      const paraTexts = [];

      for (const pEl of paragraphs) {
        const runs = this._getRunsInParagraph(pEl);
        let paraText = '';

        for (const runEl of runs) {
          paraText += this._extractRunText(runEl);
        }

        paraTexts.push(paraText);
      }

      // Trim trailing empty paragraphs
      while (paraTexts.length > 0 && paraTexts[paraTexts.length - 1] === '') {
        paraTexts.pop();
      }

      return paraTexts.join('\n');
    }

    /**
     * Check if a cell contains bold text and whether all non-empty text is bold.
     *
     * @param {Element} cellEl — the w:tc element
     * @returns {{ hasText: boolean, isBold: boolean }}
     */
    _cellIsBold(cellEl) {
      const paragraphs = this._directChildrenByTag(cellEl, 'p');
      let hasText = false;
      let allBold = true;

      for (const p of paragraphs) {
        const runs = this._getRunsInParagraph(p);
        for (const run of runs) {
          const runText = this._extractRunText(run).trim();
          if (runText.length > 0) {
            hasText = true;
            if (!this._isRunBold(run)) {
              allBold = false;
            }
          }
        }
      }

      return { hasText, isBold: hasText && allBold };
    }

    /**
     * Check if a w:r element has bold formatting (w:rPr > w:b).
     *
     * @param {Element} runEl — the w:r element
     * @returns {boolean}
     */
    _isRunBold(runEl) {
      for (const child of runEl.children) {
        if ((child.localName === 'rPr' || child.nodeName === 'w:rPr') &&
            (child.namespaceURI === WORD_NS || !child.namespaceURI || child.prefix === 'w')) {
          for (const rp of child.children) {
            if ((rp.localName === 'b' || rp.nodeName === 'w:b') &&
                (rp.namespaceURI === WORD_NS || !rp.namespaceURI || rp.prefix === 'w')) {
              const val = rp.getAttribute('w:val') || rp.getAttributeNS(WORD_NS, 'val');
              return val !== '0' && val !== 'false';
            }
          }
        }
      }
      return false;
    }

    /**
     * Get w:r elements within a w:p element.
     * Recursively collects runs inside w:sdt > w:sdtContent, w:smartTag,
     * w:customXml, w:ins, w:fldSimple, and w:hyperlink.
     * Never descends into nested w:tbl elements and never collects w:delText / w:del.
     *
     * @param {Element} pEl — the w:p element
     * @returns {Element[]} — array of w:r elements
     */
    _getRunsInParagraph(pEl) {
      const runs = [];
      const collect = (node) => {
        for (const child of node.children) {
          // Never inside a nested w:tbl
          if (child.localName === 'tbl') {
            continue;
          }
          // Never inside w:del (deleted text revision)
          if (child.localName === 'del') {
            continue;
          }
          if (child.localName === 'r') {
            runs.push(child);
          } else if (
            child.localName === 'sdt' ||
            child.localName === 'sdtContent' ||
            child.localName === 'smartTag' ||
            child.localName === 'customXml' ||
            child.localName === 'ins' ||
            child.localName === 'fldSimple' ||
            child.localName === 'hyperlink' ||
            child.localName === 'dir' ||
            child.localName === 'bdo'
          ) {
            collect(child);
          }
        }
      };
      collect(pEl);
      return runs;
    }

    /**
     * Extract text from a single w:r (run) element.
     *
     * Handles:
     *   - w:t — text content (preserved as-is, including leading zeros)
     *   - w:br — line break → newline
     *   - w:cr — carriage return → newline
     *   - w:tab — tab character
     *
     * @param {Element} runEl — the w:r element
     * @returns {string}      — text from this run
     */
    _extractRunText(runEl) {
      let text = '';

      for (const child of runEl.children) {
        if (child.namespaceURI !== WORD_NS) continue;

        switch (child.localName) {
          case 't':
            // Text content — preserved as-is. Never coerce to number.
            // The xml:space="preserve" attribute is handled by the DOM parser.
            text += child.textContent;
            break;

          case 'br':
            text += '\n';
            break;

          case 'cr':
            text += '\n';
            break;

          case 'tab':
            text += '\t';
            break;

          // Other run children (w:rPr, w:drawing, etc.) are intentionally skipped
          // for text extraction. Images are handled separately.
        }
      }

      return text;
    }

    // ─── Grid normalization ──────────────────────────────────────────────

    /**
     * Normalize the physical grid:
     *   1. Expand gridSpan cells into additional spanned placeholder cells
     *   2. Pad all rows to the maximum column count
     *
     * @param {Object[][]} physicalGrid — array of rows, each row = array of cell objects
     * @returns {Object[][]}            — normalized grid
     */
    _normalizeGrid(physicalGrid) {
      const expandedGrid = [];
      let maxCols = 0;

      // Pass 1: expand gridSpan
      for (const row of physicalGrid) {
        const expandedRow = [];

        for (const cell of row) {
          // Push the real cell (at its starting column position)
          const startCol = expandedRow.length;
          expandedRow.push(cell);

          // If gridSpan > 1, add spanned placeholder cells
          if (cell.gridSpan > 1) {
            for (let s = 1; s < cell.gridSpan; s++) {
              expandedRow.push({
                text: '',
                sourceXml: '',
                gridSpan: 1,
                hasNestedTable: false,
                nestedTableIndex: null,
                hasImage: false,
                isPlaceholder: false,
                spanned: true,
                spanParentCol: startCol,
                provenance: { ...cell.provenance }, // share the parent's provenance
              });
            }
          }
        }

        expandedGrid.push(expandedRow);
        if (expandedRow.length > maxCols) {
          maxCols = expandedRow.length;
        }
      }

      // Pass 2: pad all rows to maxCols
      for (const row of expandedGrid) {
        while (row.length < maxCols) {
          row.push({
            text: '',
            sourceXml: '',
            gridSpan: 1,
            hasNestedTable: false,
            nestedTableIndex: null,
            hasImage: false,
            isPlaceholder: false,
            spanned: false,
            spanParentCol: null,
            provenance: null,
          });
        }
      }

      return expandedGrid;
    }

    // ─── Cell property helpers ───────────────────────────────────────────

    /**
     * Read the gridSpan value from a cell's w:tcPr > w:gridSpan element.
     *
     * @param {Element} cellEl — the w:tc element
     * @returns {number}       — span count (1 if not specified)
     */
    _getGridSpan(cellEl) {
      // Look for w:tcPr as a direct child
      const tcPr = this._firstDirectChildByTag(cellEl, 'tcPr');
      if (!tcPr) return 1;

      const gridSpanEl = this._firstDirectChildByTag(tcPr, 'gridSpan');
      if (!gridSpanEl) return 1;

      const val = gridSpanEl.getAttributeNS(WORD_NS, 'val')
        || gridSpanEl.getAttribute('w:val');
      return val ? parseInt(val, 10) : 1;
    }

    /**
     * Check if a cell contains image elements (w:drawing or w:pict),
     * but NOT inside any nested w:tbl.
     *
     * @param {Element} cellEl — the w:tc element
     * @returns {boolean}
     */
    _cellHasImage(cellEl) {
      // Walk paragraphs (direct children only — skip nested tables)
      const paragraphs = this._directChildrenByTag(cellEl, 'p');
      for (const pEl of paragraphs) {
        if (this._elementContainsImage(pEl)) {
          return true;
        }
      }
      return false;
    }

    /**
     * Recursively check if an element contains w:drawing or w:pict,
     * stopping at w:tbl boundaries (to avoid counting images in nested tables).
     *
     * @param {Element} el — the element to search
     * @returns {boolean}
     */
    _elementContainsImage(el) {
      for (const child of el.children) {
        // Stop at nested table boundaries
        if (child.localName === 'tbl' && child.namespaceURI === WORD_NS) {
          continue;
        }

        if (child.namespaceURI === WORD_NS &&
            (child.localName === 'drawing' || child.localName === 'pict')) {
          return true;
        }

        // w:drawing can also be in the drawingML namespace, check without NS
        if (child.localName === 'drawing' || child.localName === 'pict') {
          return true;
        }

        // Recurse into children
        if (this._elementContainsImage(child)) {
          return true;
        }
      }
      return false;
    }

    /**
     * Check if a cell has the w:showingPlcHdr property (structured document tag placeholder).
     *
     * In OpenXML, structured document tags with placeholder text have
     * <w:showingPlcHdr/> inside <w:sdtPr>.
     * We check for any descendant element named "showingPlcHdr" within the cell,
     * skipping any nested w:tbl elements.
     *
     * @param {Element} cellEl — the w:tc element
     * @returns {boolean}
     */
    _cellIsPlaceholder(cellEl) {
      let found = false;
      const walk = (node) => {
        if (found) return;
        for (const child of node.children) {
          if (child.localName === 'tbl') continue;
          if (child.localName === 'showingPlcHdr') {
            found = true;
            return;
          }
          walk(child);
        }
      };
      walk(cellEl);
      return found;
    }

    /**
     * Find the physical index of a nested table element by matching it
     * against the registry entry's nestedTableIndices.
     *
     * Since the registry was built by walking cells in order, the N-th
     * nested w:tbl in this parent corresponds to nestedTableIndices[N].
     *
     * @param {Element} nestedTblEl — the nested w:tbl element
     * @param {Object}  regEntry    — parent table's registry entry
     * @returns {number|null}       — 1-based physical index, or null
     */
    _findNestedTableIndex(nestedTblEl, regEntry) {
      // The first nested table index corresponds to the first encountered nested tbl
      if (regEntry.nestedTableIndices.length > 0) {
        // We need to figure out which nested table this is within the parent.
        // Walk all cells of the parent and count nested tbls until we find ours.
        const rows = this._directChildrenByTag(regEntry.element, 'tr');
        let nestedCount = 0;
        for (const row of rows) {
          const cells = this._directChildrenByTag(row, 'tc');
          for (const cell of cells) {
            const nestedTbls = this._directChildrenByTag(cell, 'tbl');
            for (const nt of nestedTbls) {
              if (nt === nestedTblEl) {
                return regEntry.nestedTableIndices[nestedCount] || null;
              }
              nestedCount++;
            }
          }
        }
      }
      return null;
    }

    // ─── DOM traversal utilities ─────────────────────────────────────────
    //
    // These helpers avoid getElementsByTagNameNS which descends into
    // nested tables and gives incorrect results.

    /**
     * Get direct child elements matching a local tag name in the Word namespace.
     *
     * @param {Element} parent  — parent element
     * @param {string}  tagName — local name (e.g. 'tbl', 'tr', 'tc', 'p')
     * @returns {Element[]}
     */
    _directChildrenByTag(parent, tagName) {
      const result = [];
      if (!parent || !parent.children) return result;
      for (const child of parent.children) {
        if ((child.localName === tagName || child.nodeName === 'w:' + tagName) &&
            (child.namespaceURI === WORD_NS || !child.namespaceURI || child.prefix === 'w')) {
          result.push(child);
        }
      }
      return result;
    }

    /**
     * Get the first direct child element matching a local tag name in the Word namespace.
     *
     * @param {Element} parent  — parent element
     * @param {string}  tagName — local name
     * @returns {Element|null}
     */
    _firstDirectChildByTag(parent, tagName) {
      if (!parent || !parent.children) return null;
      for (const child of parent.children) {
        if ((child.localName === tagName || child.nodeName === 'w:' + tagName) &&
            (child.namespaceURI === WORD_NS || !child.namespaceURI || child.prefix === 'w')) {
          return child;
        }
      }
      return null;
    }
  }

  // ─── Export ─────────────────────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    window.DocxTableParser = DocxTableParser;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DocxTableParser;
  }

})();
