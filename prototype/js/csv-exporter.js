/**
 * csv-exporter.js — CSV Export with Provenance for Doc2Table
 *
 * Provides RFC 4180 compliant CSV generation from parsed DOCX table grids,
 * along with per-cell provenance metadata for full traceability back to the
 * source document.
 *
 * Usage:
 *   const exporter = new CsvExporter();
 *   const { csv, provenance } = exporter.exportTable(table, headerRowCount, dataStartRow);
 *   exporter.downloadCsv(csv, 'output.csv');
 */

(function () {
  'use strict';

  /**
   * @class CsvExporter
   * Converts a DocxTableParser table object into an RFC 4180 CSV string
   * and an accompanying provenance array.
   */
  class CsvExporter {

    // ─── CSV Cell Escaping ────────────────────────────────────────────

    /**
     * Escape a single cell value per RFC 4180.
     *  - Wraps in double-quotes if the value contains a comma, double-quote,
     *    or newline character.
     *  - Doubles any internal double-quote characters.
     *  - Never coerces numeric-looking strings (e.g. "031") to numbers.
     *
     * @param {string} value  Raw cell text.
     * @returns {string}      Escaped cell text ready for CSV output.
     */
    _escapeCell(value) {
      // Ensure we always work with a string (preserves leading zeros, etc.)
      const str = String(value);

      // Check whether quoting is required
      if (str.indexOf('"') !== -1 || str.indexOf(',') !== -1 ||
          str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1) {
        // Double any internal double-quotes, then wrap the whole value
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    // ─── Cell Text Extraction ─────────────────────────────────────────

    /**
     * Derive the display text for a single grid cell.
     *  - Images  → "[image]"
     *  - Nested tables → "[nested table N]" (N = 1-based nested-table counter)
     *  - Spanned (covered) cells → "" (empty — they are consumed by their
     *    parent merged cell)
     *  - Everything else → trimmed cell text
     *
     * @param {object} cell           Cell object from the parsed grid.
     * @param {number} nestedCounter  Running counter of nested tables seen so far.
     * @returns {{ text: string, nestedCounter: number }}
     */
    _cellText(cell, nestedCounter) {
      if (!cell) {
        return { text: '', nestedCounter };
      }

      // Spanned cells are part of a horizontal merge and carry no independent content
      if (cell.spanned) {
        return { text: '', nestedCounter };
      }

      if (cell.hasImage) {
        return { text: '[image]', nestedCounter };
      }

      if (cell.hasNestedTable) {
        nestedCounter++;
        return { text: '[nested table ' + nestedCounter + ']', nestedCounter };
      }

      // Default: use the raw text, trimmed
      const text = (cell.text != null) ? String(cell.text).trim() : '';
      return { text, nestedCounter };
    }

    // ─── Header Construction ──────────────────────────────────────────

    /**
     * Build the array of header labels for every column in the grid.
     *
     * @param {Array<Array<object>>} grid            Full table grid.
     * @param {number}               headerRowCount  0, 1, or 2.
     * @param {number}               colCount        Number of columns.
     * @returns {string[]}  Array of header labels, one per column.
     */
    _buildHeaders(grid, headerRowCount, colCount) {
      if (headerRowCount === 0) {
        // Synthetic headers: "Column_1", "Column_2", …
        return Array.from({ length: colCount }, (_, i) => 'Column_' + (i + 1));
      }

      if (headerRowCount === 1) {
        // First row texts become headers
        const row = grid[0] || [];
        const headers = [];
        let nc = 0;
        for (let c = 0; c < colCount; c++) {
          const { text, nestedCounter } = this._cellText(row[c], nc);
          nc = nestedCounter;
          headers.push(text || 'Column_' + (c + 1));
        }
        return headers;
      }

      if (headerRowCount === 2) {
        // Concatenate row 0 and row 1 texts with " / " separator
        const row0 = grid[0] || [];
        const row1 = grid[1] || [];
        const headers = [];
        let nc = 0;
        for (let c = 0; c < colCount; c++) {
          const r0 = this._cellText(row0[c], nc);
          nc = r0.nestedCounter;
          const r1 = this._cellText(row1[c], nc);
          nc = r1.nestedCounter;

          const parts = [r0.text, r1.text].filter(Boolean);
          headers.push(parts.length > 0 ? parts.join(' / ') : 'Column_' + (c + 1));
        }
        return headers;
      }

      // Fallback (should not reach here)
      return Array.from({ length: colCount }, (_, i) => 'Column_' + (i + 1));
    }

    // ─── Main Export ──────────────────────────────────────────────────

    /**
     * Export a parsed table to CSV with provenance metadata.
     *
     * @param {object} table            Table object from DocxTableParser.
     *   Must have a `grid` property: Array of rows, each row an array of
     *   cell objects with { text, provenance, gridSpan, spanned, hasImage,
     *   hasNestedTable }.  May also carry `sourceFileHash`, `sourcePart`,
     *   `sourceTableIndex` at the table level.
     * @param {number} headerRowCount   Number of header rows (0, 1, or 2).
     * @param {number} [dataStartRow]   Row index where data begins.
     *   Defaults to headerRowCount.
     * @returns {{ csv: string, provenance: Array }}
     */
    exportTable(table, headerRowCount, dataStartRow) {
      const grid = table.grid || [];
      if (grid.length === 0) {
        return { csv: '', provenance: [] };
      }

      // Clamp headerRowCount to a sensible range
      headerRowCount = Math.max(0, Math.min(2, Number(headerRowCount) || 0));

      // Default dataStartRow to headerRowCount
      if (dataStartRow == null || dataStartRow === undefined) {
        dataStartRow = headerRowCount;
      }

      // Determine column count (max across all rows)
      const colCount = grid.reduce((max, row) => Math.max(max, row.length), 0);

      // Build header labels
      const headers = this._buildHeaders(grid, headerRowCount, colCount);

      // Table-level provenance defaults
      const fileHash = table.sourceFileHash || '';
      const sourcePart = table.sourcePart || '';
      const tableIndex = (table.sourceTableIndex != null) ? table.sourceTableIndex : 0;

      // Accumulators
      const csvLines = [];       // Each entry is one CSV row string
      const provenance = [];     // Flat list of provenance objects
      let csvRowIndex = 0;       // Tracks the current row in the CSV output

      // ── Emit header row ─────────────────────────────────────────────
      // Always emit exactly one header row in the CSV, regardless of
      // headerRowCount (for headerRowCount=0, synthetic headers are used).
      const headerCsvCells = headers.map(h => this._escapeCell(h));
      csvLines.push(headerCsvCells.join(','));

      // Provenance for header cells
      for (let c = 0; c < colCount; c++) {
        // Determine the source row index and cell index for provenance
        const headerCell = (headerRowCount > 0 && grid[0] && grid[0][c]) ? grid[0][c] : null;
        const sourceRow = headerCell && headerCell.provenance ? headerCell.provenance.rowIndex : (headerRowCount > 0 ? 0 : -1);
        const sourceCell = headerCell && headerCell.provenance ? headerCell.provenance.cellIndex : (headerRowCount > 0 ? c : -1);
        provenance.push({
          csvRow: csvRowIndex,
          csvCol: c,
          sourceFileHash: fileHash,
          sourcePart: sourcePart,
          sourceTableIndex: tableIndex,
          sourceRowIndex: sourceRow,
          sourceCellIndex: sourceCell,
          rawText: headers[c],
          headerLabel: headers[c],
          isHeader: true
        });
      }
      csvRowIndex++;

      // If headerRowCount=2, we also record provenance for row 1 header
      // contribution, but the CSV still has only one merged header row
      // (already handled above in _buildHeaders).

      // ── Emit data rows ──────────────────────────────────────────────
      let nestedCounter = 0; // Running counter across all data rows

      for (let r = dataStartRow; r < grid.length; r++) {
        const row = grid[r];
        const csvCells = [];

        for (let c = 0; c < colCount; c++) {
          const cell = (row && row[c]) ? row[c] : null;
          const { text, nestedCounter: nc } = this._cellText(cell, nestedCounter);
          nestedCounter = nc;

          csvCells.push(this._escapeCell(text));

          // Raw text for provenance is the original cell text (untrimmed)
          const rawText = cell ? (cell.text != null ? String(cell.text) : '') : '';
          const sourceRow = cell && cell.provenance ? cell.provenance.rowIndex : r;
          const sourceCell = cell && cell.provenance ? cell.provenance.cellIndex : c;

          provenance.push({
            csvRow: csvRowIndex,
            csvCol: c,
            sourceFileHash: fileHash,
            sourcePart: sourcePart,
            sourceTableIndex: tableIndex,
            sourceRowIndex: sourceRow,
            sourceCellIndex: sourceCell,
            rawText: rawText,
            headerLabel: headers[c] || ('Column_' + (c + 1)),
            isHeader: false
          });
        }

        csvLines.push(csvCells.join(','));
        csvRowIndex++;
      }

      // Join all lines with CRLF (RFC 4180 standard line ending)
      const csv = csvLines.join('\r\n');

      return { csv, provenance };
    }

    // ─── Browser Download ─────────────────────────────────────────────

    /**
     * Trigger a browser download of a CSV string as a file.
     * Uses the Blob + URL.createObjectURL + programmatic click pattern.
     *
     * @param {string} csvString  The CSV content to download.
     * @param {string} filename   Desired filename (e.g. "export.csv").
     */
    downloadCsv(csvString, filename) {
      // Prepend BOM for Excel compatibility with UTF-8
      const bom = '\uFEFF';
      const blob = new Blob([bom + csvString], { type: 'text/csv;charset=utf-8;' });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename || 'export.csv');

      // Append, click, then clean up
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      // Revoke the object URL after a short delay to allow the download to start
      setTimeout(function () {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    }
  }

  // ─── Export ─────────────────────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    window.CsvExporter = CsvExporter;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CsvExporter;
  }

})();
