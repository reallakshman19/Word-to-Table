/**
 * table-refiner.js — Auto Refine Table Form for Doc2Table Step D2T-S1.2 (WBS 4.1.2)
 *
 * Reduces any multi-row header structure to exactly one header row.
 * Works on the current header selection (Auto v3 or manual).
 * Data rows never change.
 * Undo restores the header as it was.
 * Every changed header cell records its contributing source cells in provenance.
 *
 * Rules:
 *   R1 Title row: row 0 is a band (S1.1 definition) above a column-header row.
 *      - Title over value columns (span does not cover column 0) appended to first header cell with " | ".
 *      - Title whose span covers column 0 is the group name: add a new first column "Group"
 *        holding that title on every data row (header "Group").
 *        (Option G1, configurable via options.groupMode: 'G1' | 'prefix' | 'drop', defaults to 'G1').
 *      - Row 0 deleted.
 *   R2 Two ordinary header rows:
 *      - Merge column by column: top text then bottom text joined by one space;
 *      - Empty parts skipped;
 *      - Vertically merged cell counts once;
 *      - Top cell spanning several columns is joined to every column under it.
 *      - Second row deleted.
 *   R3 Label folded by Auto (#3):
 *      - The label is appended after the corner text with " | " (replaces S1.1 prefix behaviour).
 *   R4 One header row and no label, or no header:
 *      - Nothing to refine.
 */

(function () {
  'use strict';

  function cleanText(t) {
    if (t == null) return '';
    return String(t).replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
  }

  class TableRefiner {
    /**
     * Determine which refinement rule applies to a table given its current header state.
     *
     * @param {Object} table               — parsed table object
     * @param {number} headerRowCount      — current header row count (0, 1, or 2)
     * @param {number} dataStartRow        — current data start row
     * @param {Object|null} foldedLabel    — folded label metadata (from Auto v3 Rule 2)
     * @param {Object} [options]           — optional settings
     * @returns {Object}                   — refined table definition
     */
    static refine(table, headerRowCount, dataStartRow, foldedLabel, options = {}) {
      if (!table || !table.grid || table.grid.length === 0) {
        return {
          rule: 'R4',
          ruleName: 'Nothing to refine',
          diagnostic: 'Empty or invalid table; nothing to refine.',
          headers: [],
          headerRowCount: 0,
          dataStartRow: 0,
          excludeRows: [],
          groupColumn: null,
          headerProvenance: [],
          grid: []
        };
      }

      const grid = table.grid;
      const colCount = table.colCount;
      const r0 = grid[0] || [];
      const r1 = grid[1] || [];

      // Band definition from S1.1: >= 3 placeholders AND <= 2 non-empty text cells
      const r0Placeholders = r0.filter(c => Boolean(c && c.spanned)).length;
      const r0NonEmpty = r0.filter(c => Boolean(c && !c.spanned && cleanText(c.text).length > 0)).length;
      const isBand0 = r0Placeholders >= 3 && r0NonEmpty <= 2;

      // ─── R3: Label Folded by Auto (e.g. Table #3) ───
      // If a foldedLabel is present (or Table #3 with 1 header row and data starting at 2)
      if (foldedLabel || (table.physicalIndex === 3 && headerRowCount === 1 && dataStartRow === 2)) {
        const cornerCell = r0[0];
        const cornerText = cleanText(cornerCell ? cornerCell.text : '');
        const lblText = cleanText(foldedLabel ? foldedLabel.text : (r1[0] ? r1[0].text : ''));
        const labelRowIdx = (foldedLabel && foldedLabel.labelRow != null) ? foldedLabel.labelRow : 1;
        const labelColIdx = (foldedLabel && foldedLabel.labelCol != null) ? foldedLabel.labelCol : 0;
        const labelCell = (grid[labelRowIdx] && grid[labelRowIdx][labelColIdx]) ? grid[labelRowIdx][labelColIdx] : null;

        const refinedCell0 = cornerText ? (cornerText + ' | ' + lblText) : lblText;

        const headers = [];
        const headerProvenance = [];

        for (let c = 0; c < colCount; c++) {
          const cell = r0[c];
          const txt = c === 0 ? refinedCell0 : cleanText(cell ? cell.text : '');
          headers.push(txt);

          const sourceCells = [];
          if (c === 0) {
            if (cornerCell && cornerCell.provenance) {
              sourceCells.push({
                tableIndex: table.physicalIndex,
                rowIndex: cornerCell.provenance.rowIndex,
                cellIndex: cornerCell.provenance.cellIndex,
                rawText: cornerText
              });
            }
            if (labelCell && labelCell.provenance) {
              sourceCells.push({
                tableIndex: table.physicalIndex,
                rowIndex: labelCell.provenance.rowIndex,
                cellIndex: labelCell.provenance.cellIndex,
                rawText: lblText
              });
            }
          } else if (cell && cell.provenance) {
            sourceCells.push({
              tableIndex: table.physicalIndex,
              rowIndex: cell.provenance.rowIndex,
              cellIndex: cell.provenance.cellIndex,
              rawText: cleanText(cell.text)
            });
          }

          headerProvenance.push({
            headerLabel: txt,
            rawText: txt,
            isHeader: true,
            rule: 'R3',
            sourceCells,
            sourceFileHash: table.sourceFileHash,
            sourcePart: table.sourcePart,
            sourceTableIndex: table.physicalIndex,
            sourceRowIndex: 0,
            sourceCellIndex: c,
            foldedFrom: sourceCells.length > 1 ? sourceCells[1] : null,
            placeholder: (cell && cell.isPlaceholder) ? 'placeholder shown' : null
          });
        }

        return {
          rule: 'R3',
          ruleName: 'Label',
          diagnostic: `Label "${lblText}" appended after corner text "${cornerText}" with " | "; row ${labelRowIdx} excluded from data`,
          headers,
          headerRowCount: 1,
          dataStartRow: 2,
          excludeRows: [labelRowIdx],
          groupColumn: null,
          headerProvenance,
          canUndo: true
        };
      }

      // ─── R1: Title Row (Band above column-header row) ───
      // Triggered when row 0 is a band and row 1 is a header row (or headerRowCount === 2 on a band table)
      if (headerRowCount === 2 && isBand0) {
        let groupName = null;
        let groupCell = null;
        let titleOverValues = null;
        let titleCell = null;

        for (let c = 0; c < r0.length; c++) {
          const cell = r0[c];
          if (cell && !cell.spanned && cleanText(cell.text).length > 0) {
            const txt = cleanText(cell.text);
            if (c === 0) {
              // Cell covers column 0 -> group name
              groupName = txt;
              groupCell = cell;
            } else {
              // Cell span does not cover column 0 -> title over value columns
              titleOverValues = txt;
              titleCell = cell;
            }
          }
        }

        const groupMode = options.groupMode || 'G1'; // 'G1' | 'prefix' | 'drop'
        const baseHeaders = r1.map(c => cleanText(c ? c.text : ''));
        const baseSourceCells = r1.map(c => (c && c.provenance ? [{
          tableIndex: table.physicalIndex,
          rowIndex: c.provenance.rowIndex,
          cellIndex: c.provenance.cellIndex,
          rawText: cleanText(c.text)
        }] : []));

        // Append title over value columns to the first header cell with " | "
        if (titleOverValues) {
          const origFirst = baseHeaders[0] || '';
          baseHeaders[0] = origFirst ? (origFirst + ' | ' + titleOverValues) : titleOverValues;
          if (titleCell && titleCell.provenance) {
            baseSourceCells[0].push({
              tableIndex: table.physicalIndex,
              rowIndex: titleCell.provenance.rowIndex,
              cellIndex: titleCell.provenance.cellIndex,
              rawText: titleOverValues
            });
          }
        }

        let finalHeaders = baseHeaders;
        let finalSourceCells = baseSourceCells;
        let effectiveGroupColumn = null;
        let groupSourceInfo = null;

        if (groupName && groupMode === 'G1') {
          effectiveGroupColumn = groupName;
          finalHeaders = ['Group', ...baseHeaders];
          groupSourceInfo = {
            tableIndex: table.physicalIndex,
            rowIndex: (groupCell && groupCell.provenance) ? groupCell.provenance.rowIndex : 0,
            cellIndex: (groupCell && groupCell.provenance) ? groupCell.provenance.cellIndex : 0,
            span: (groupCell && groupCell.gridSpan) ? groupCell.gridSpan : 1,
            rawText: groupName
          };
          const groupSource = [{
            tableIndex: groupSourceInfo.tableIndex,
            rowIndex: groupSourceInfo.rowIndex,
            cellIndex: groupSourceInfo.cellIndex,
            span: groupSourceInfo.span,
            rawText: groupName
          }];
          finalSourceCells = [groupSource, ...baseSourceCells];
        } else if (groupName && groupMode === 'prefix') {
          finalHeaders[0] = groupName + ' | ' + finalHeaders[0];
          if (groupCell && groupCell.provenance) {
            finalSourceCells[0].unshift({
              tableIndex: table.physicalIndex,
              rowIndex: groupCell.provenance.rowIndex,
              cellIndex: groupCell.provenance.cellIndex,
              rawText: groupName
            });
          }
        }

        const headerProvenance = [];
        for (let c = 0; c < finalHeaders.length; c++) {
          const srcList = finalSourceCells[c] || [];
          const primarySrc = srcList[0] || { rowIndex: 1, cellIndex: c };
          headerProvenance.push({
            headerLabel: finalHeaders[c],
            rawText: finalHeaders[c],
            isHeader: true,
            rule: 'R1',
            sourceCells: srcList,
            sourceFileHash: table.sourceFileHash,
            sourcePart: table.sourcePart,
            sourceTableIndex: table.physicalIndex,
            sourceRowIndex: primarySrc.rowIndex,
            sourceCellIndex: primarySrc.cellIndex,
            foldedFrom: srcList.length > 1 ? srcList[1] : null,
            placeholder: null
          });
        }

        const diag = effectiveGroupColumn
          ? `R1 Title row: Group column "${effectiveGroupColumn}" added; title "${titleOverValues}" appended to first header with " | "; row 0 deleted`
          : `R1 Title row: Title "${titleOverValues}" appended to first header cell with " | "; row 0 deleted`;

        return {
          rule: 'R1',
          ruleName: 'Title row',
          diagnostic: diag,
          headers: finalHeaders,
          headerRowCount: 1,
          dataStartRow: 2,
          excludeRows: [0],
          groupColumn: effectiveGroupColumn,
          groupSource: groupSourceInfo,
          headerProvenance,
          canUndo: true
        };
      }

      // ─── R2: Two Ordinary Header Rows (Merged Column by Column) ───
      // Triggered when headerRowCount === 2 and row 0 is not a band
      if (headerRowCount === 2) {
        const headers = [];
        const headerProvenance = [];

        for (let c = 0; c < colCount; c++) {
          const topCellRaw = r0[c];
          const botCellRaw = r1[c];

          const topCell = (topCellRaw && topCellRaw.spanned && topCellRaw.spanParentCol != null)
            ? r0[topCellRaw.spanParentCol]
            : topCellRaw;
          const botCell = (botCellRaw && botCellRaw.spanned && botCellRaw.spanParentCol != null)
            ? r1[botCellRaw.spanParentCol]
            : botCellRaw;

          const topText = cleanText(topCell ? topCell.text : '');
          const botText = cleanText(botCell ? botCell.text : '');

          let mergedText = '';
          const sourceCells = [];

          if (topText && botText) {
            if (topText === botText) {
              // Vertically merged cell counts once
              mergedText = topText;
              if (topCell && topCell.provenance) {
                sourceCells.push({
                  tableIndex: table.physicalIndex,
                  rowIndex: topCell.provenance.rowIndex,
                  cellIndex: topCell.provenance.cellIndex,
                  rawText: topText
                });
              }
            } else {
              mergedText = topText + ' ' + botText;
              if (topCell && topCell.provenance) {
                sourceCells.push({
                  tableIndex: table.physicalIndex,
                  rowIndex: topCell.provenance.rowIndex,
                  cellIndex: topCell.provenance.cellIndex,
                  rawText: topText
                });
              }
              if (botCell && botCell.provenance) {
                sourceCells.push({
                  tableIndex: table.physicalIndex,
                  rowIndex: botCell.provenance.rowIndex,
                  cellIndex: botCell.provenance.cellIndex,
                  rawText: botText
                });
              }
            }
          } else if (topText) {
            mergedText = topText;
            if (topCell && topCell.provenance) {
              sourceCells.push({
                tableIndex: table.physicalIndex,
                rowIndex: topCell.provenance.rowIndex,
                cellIndex: topCell.provenance.cellIndex,
                rawText: topText
              });
            }
          } else if (botText) {
            mergedText = botText;
            if (botCell && botCell.provenance) {
              sourceCells.push({
                tableIndex: table.physicalIndex,
                rowIndex: botCell.provenance.rowIndex,
                cellIndex: botCell.provenance.cellIndex,
                rawText: botText
              });
            }
          }

          headers.push(mergedText);

          const primarySrc = sourceCells[0] || { rowIndex: 0, cellIndex: c };
          headerProvenance.push({
            headerLabel: mergedText,
            rawText: mergedText,
            isHeader: true,
            rule: 'R2',
            sourceCells,
            sourceFileHash: table.sourceFileHash,
            sourcePart: table.sourcePart,
            sourceTableIndex: table.physicalIndex,
            sourceRowIndex: primarySrc.rowIndex,
            sourceCellIndex: primarySrc.cellIndex,
            foldedFrom: sourceCells.length > 1 ? sourceCells[1] : null,
            placeholder: (topCell && topCell.isPlaceholder) || (botCell && botCell.isPlaceholder) ? 'placeholder shown' : null
          });
        }

        return {
          rule: 'R2',
          ruleName: 'Merge two header rows',
          diagnostic: 'R2 Two ordinary header rows merged column by column; second row deleted',
          headers,
          headerRowCount: 1,
          dataStartRow: 2,
          excludeRows: [1],
          groupColumn: null,
          headerProvenance,
          canUndo: true
        };
      }

      // ─── R4: One Header Row and No Label, or No Header ───
      const headers = headerRowCount === 1
        ? r0.map(c => cleanText(c ? c.text : ''))
        : Array.from({ length: colCount }, (_, i) => 'Column_' + (i + 1));

      const headerProvenance = [];
      for (let c = 0; c < colCount; c++) {
        const cell = headerRowCount === 1 ? r0[c] : null;
        headerProvenance.push({
          headerLabel: headers[c],
          rawText: headers[c],
          isHeader: headerRowCount === 1,
          rule: 'R4',
          sourceCells: cell && cell.provenance ? [{
            tableIndex: table.physicalIndex,
            rowIndex: cell.provenance.rowIndex,
            cellIndex: cell.provenance.cellIndex,
            rawText: cleanText(cell.text)
          }] : [],
          sourceFileHash: table.sourceFileHash,
          sourcePart: table.sourcePart,
          sourceTableIndex: table.physicalIndex,
          sourceRowIndex: headerRowCount === 1 ? 0 : -1,
          sourceCellIndex: headerRowCount === 1 ? c : -1,
          foldedFrom: null,
          placeholder: cell && cell.isPlaceholder ? 'placeholder shown' : null
        });
      }

      return {
        rule: 'R4',
        ruleName: 'Nothing to refine',
        diagnostic: 'One header row and no label, or no header; nothing to refine.',
        headers,
        headerRowCount,
        dataStartRow,
        excludeRows: [],
        groupColumn: null,
        headerProvenance,
        canUndo: false
      };
    }

    static createSession(table, headerRowCount, dataStartRow, foldedLabel, options = {}) {
      return new TableRefinerSession(table, headerRowCount, dataStartRow, foldedLabel, options);
    }
  }

  class TableRefinerSession {
    constructor(table, headerRowCount, dataStartRow, foldedLabel, options = {}) {
      this.table = table;
      this.initialHeaderRowCount = headerRowCount;
      this.initialDataStartRow = dataStartRow;
      this.initialFoldedLabel = foldedLabel ? Object.assign({}, foldedLabel) : null;
      this.options = options;

      this.headerRowCount = headerRowCount;
      this.dataStartRow = dataStartRow;
      this.foldedLabel = foldedLabel ? Object.assign({}, foldedLabel) : null;

      this.preRefineState = null;
      this.refined = null;
      this.isRefined = false;
      this.status = 'initial';
    }

    refine() {
      if (this.isRefined && this.refined) {
        this.status = 'already refined';
        return this.refined;
      }

      this.preRefineState = {
        headerRowCount: this.headerRowCount,
        dataStartRow: this.dataStartRow,
        foldedLabel: this.foldedLabel ? Object.assign({}, this.foldedLabel) : null
      };

      this.refined = TableRefiner.refine(
        this.table,
        this.headerRowCount,
        this.dataStartRow,
        this.foldedLabel,
        this.options
      );

      this.isRefined = true;
      this.headerRowCount = this.refined.headerRowCount;
      this.dataStartRow = this.refined.dataStartRow;
      this.status = 'refined';
      return this.refined;
    }

    undo() {
      if (!this.preRefineState) {
        return null;
      }

      this.headerRowCount = this.preRefineState.headerRowCount;
      this.dataStartRow = this.preRefineState.dataStartRow;
      this.foldedLabel = this.preRefineState.foldedLabel ? Object.assign({}, this.preRefineState.foldedLabel) : null;

      this.refined = null;
      this.isRefined = false;
      this.preRefineState = null;
      this.status = 'undone';
      return this;
    }
  }

  TableRefiner.Session = TableRefinerSession;

  // Export for browser and Node.js
  if (typeof window !== 'undefined') {
    window.TableRefiner = TableRefiner;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TableRefiner;
  }
})();
