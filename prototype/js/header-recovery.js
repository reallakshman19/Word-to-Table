/**
 * header-recovery.js — Doc2Table Step D2T-S1.3 "Header recovery"
 *
 * Implements:
 *   STEP 1: Header recovery from a preceding 1-row header table H above T
 *     - Conditions a-d verification:
 *         a. H is a table with exactly 1 row and is not itself a table with data
 *         b. H has same number of grid columns as T and every H cell has text
 *         c. Column edges line up (cumulative gridCol widths within 3%)
 *         d. Word marks H's row as a header: repeat-header, bold, or underlined
 *     - Provenance tracking pointing to #H row 0 cell j
 *     - Signals tracking ('repeat-header', 'bold', 'underlined')
 *     - Idempotent execution and exact undo state restoration
 *
 *   STEP 2: Title path extraction & inheritance
 *     - Run of 1-row, 1-filled-cell tables directly above T (or above H if used)
 *     - Section lines (all uppercase with word of 4+ letters) with persistence
 *     - Lower lines inheritance when T has no title lines of its own
 *     - Links to source tables (#n row 0)
 */

(function () {
  'use strict';

  class HeaderRecovery {
    /**
     * Check if cumulative column edges of H and T line up within 3%.
     *
     * @param {number[]} widthsH - gridCol widths of H
     * @param {number[]} widthsT - gridCol widths of T
     * @returns {boolean}
     */
    static edgesLineUp(widthsH, widthsT) {
      if (!Array.isArray(widthsH) || !Array.isArray(widthsT)) return false;
      if (widthsH.length !== widthsT.length || widthsH.length === 0) return false;

      const sumH = widthsH.reduce((a, b) => a + b, 0);
      const sumT = widthsT.reduce((a, b) => a + b, 0);
      if (sumH === 0 || sumT === 0) return false;

      let cumH = 0;
      let cumT = 0;
      for (let i = 0; i < widthsH.length; i++) {
        cumH += widthsH[i] / sumH;
        cumT += widthsT[i] / sumT;
        if (Math.abs(cumH - cumT) > 0.03 + 1e-6) {
          return false;
        }
      }
      return true;
    }

    /**
     * Check if text constitutes a section title:
     * - Every letter is in upper case (no lowercase letters, at least one letter)
     * - Contains a word of 4+ letters
     *
     * @param {string} text
     * @returns {boolean}
     */
    static isSectionLine(text) {
      if (!text || typeof text !== 'string') return false;
      const trimmed = text.trim();
      if (trimmed.length === 0) return false;
      if (/[a-z]/.test(trimmed)) return false; // must have NO lowercase letters
      if (!/[A-Z]/.test(trimmed)) return false; // must have at least one uppercase letter
      return /[A-Z]{4,}/.test(trimmed);        // must have a word of 4+ letters
    }

    /**
     * Check if table T qualifies for header recovery from a preceding block H.
     * Evaluates conditions a-d and collects reasons for failure.
     *
     * @param {Object} table - Target table T
     * @param {Object[]} allTables - All tables in document
     * @param {Set<number>} isDataTableSet - Set of physical indices of tables with data
     * @param {number} [currentHeaderRows=0] - Current header row count on T
     * @returns {Object} { eligible, H, signals, failedChecks, message }
     */
    static canRecover(table, allTables, isDataTableSet, currentHeaderRows = 0) {
      // Applies ONLY to a table T with no header rows
      if (currentHeaderRows > 0) {
        return {
          eligible: false,
          H: null,
          signals: [],
          failedChecks: ['table already has header rows'],
          message: 'table already has header rows',
        };
      }

      // Check preceding blocks
      if (table.precedingText) {
        return {
          eligible: false,
          H: null,
          signals: [],
          failedChecks: ['a text paragraph between H and T'],
          message: 'a text paragraph between H and T',
        };
      }

      if (!table.precedingTableIndices || table.precedingTableIndices.length === 0) {
        return {
          eligible: false,
          H: null,
          signals: [],
          failedChecks: ['no table above'],
          message: 'no table above',
        };
      }

      const hIndex = table.precedingTableIndices[0];
      const H = allTables.find(t => t.physicalIndex === hIndex);
      if (!H) {
        return {
          eligible: false,
          H: null,
          signals: [],
          failedChecks: ['preceding table not found'],
          message: 'preceding table not found',
        };
      }

      const failedChecks = [];

      // Condition a: H is a table with exactly 1 row and is not itself a table with data
      if (H.rowCount !== 1) {
        failedChecks.push(`H has ${H.rowCount} rows (must be 1)`);
      }
      if (isDataTableSet && isDataTableSet.has(H.physicalIndex)) {
        failedChecks.push('H is a table with data');
      }

      // Condition b: H has same number of grid columns as T and every H cell has text
      if (H.colCount !== table.colCount) {
        failedChecks.push(`one column fewer or column count mismatch: H has ${H.colCount}, T has ${table.colCount}`);
      }
      const hRow0 = H.grid && H.grid[0] ? H.grid[0] : [];
      let allCellsHaveText = hRow0.length === H.colCount && hRow0.length > 0;
      for (const cell of hRow0) {
        if (!cell || !cell.text || cell.text.trim().length === 0) {
          allCellsHaveText = false;
          break;
        }
      }
      if (!allCellsHaveText) {
        failedChecks.push('one empty header cell');
      }

      // Condition c: column edges line up within 3%
      const widthsH = H.gridColWidths || [];
      const widthsT = table.gridColWidths || [];
      const edgesOk = this.edgesLineUp(widthsH, widthsT);
      if (!edgesOk) {
        failedChecks.push('edges off by more than 3%');
      }

      // Condition d: Word marks H's row as a header
      const signals = (H.signals || []).slice();
      if (signals.length === 0) {
        failedChecks.push('no header signal');
      }

      const eligible = failedChecks.length === 0;
      let message = '';
      if (!eligible) {
        message = `possible header above (#${H.physicalIndex}) not applied: ${failedChecks.join(', ')}`;
      }

      return {
        eligible,
        H,
        signals,
        failedChecks,
        message,
      };
    }

    /**
     * Recover header for table T from preceding table H if conditions a-d hold.
     *
     * @param {Object} table - Target table T
     * @param {Object[]} allTables - All tables in document
     * @param {Set<number>} isDataTableSet - Set of data table physical indices
     * @param {number} [currentHeaderRows=0] - Current header row count
     * @returns {Object} Recovery result
     */
    static recover(table, allTables, isDataTableSet, currentHeaderRows = 0) {
      const check = this.canRecover(table, allTables, isDataTableSet, currentHeaderRows);
      if (!check.eligible) {
        return {
          success: false,
          sourcePhysicalIndex: check.H ? check.H.physicalIndex : null,
          failedChecks: check.failedChecks,
          message: check.message,
        };
      }

      const H = check.H;
      const hRow0 = H.grid[0];
      const headerCells = [];
      const headerProvenance = [];
      const headerTexts = [];

      for (let j = 0; j < hRow0.length; j++) {
        const hCell = hRow0[j];
        const text = (hCell.text || '').trim();
        headerTexts.push(text);

        const prov = {
          fileHash: table.sourceFileHash,
          part: table.sourcePart || 'word/document.xml',
          tableIndex: H.physicalIndex,
          rowIndex: 0,
          cellIndex: j,
          recovered: true,
          signals: check.signals.slice(),
          rawText: text,
        };
        headerProvenance.push(prov);

        headerCells.push({
          text,
          recovered: true,
          signals: check.signals.slice(),
          provenance: prov,
        });
      }

      // Mark H as used as header of T
      H.usedAsHeaderOf = table.physicalIndex;

      return {
        success: true,
        sourcePhysicalIndex: H.physicalIndex,
        headers: headerTexts,
        headerRow: headerCells,
        headerProvenance,
        signals: check.signals.slice(),
        ruleName: 'Recovered',
        diagnostic: `Recovered header from #${H.physicalIndex} row 0 (${check.signals.join(', ')})`,
      };
    }

    /**
     * Compute title path for table T.
     *
     * @param {Object} table - Target table T
     * @param {Object[]} allTables - All tables in document
     * @param {number|null} [recoveredHIndex=null] - If H was used as recovered header, physical index of H
     * @param {Object|null} [currentSection=null] - In-force section line from prior tables
     * @param {Object[]} [prevLowerLines=[]] - Lower lines from prior data table for inheritance
     * @returns {Object} { path, inherited, newSection, newPrevLowerLines }
     */
    static computeTitlePath(table, allTables, recoveredHIndex = null, currentSection = null, prevLowerLines = []) {
      // Title lines of T = run of 1-row, 1-filled-cell tables directly above T (above H when H was used)
      let precedingIndices = table.precedingTableIndices || [];
      if (recoveredHIndex) {
        const H = allTables.find(t => t.physicalIndex === recoveredHIndex);
        if (H && H.precedingTableIndices) {
          precedingIndices = H.precedingTableIndices;
        }
      }

      const titleRun = [];
      for (const pIdx of precedingIndices) {
        const t = allTables.find(x => x.physicalIndex === pIdx);
        if (!t) break;
        if (t.rowCount !== 1) break;

        const filledCells = t.grid && t.grid[0]
          ? t.grid[0].filter(c => c.text && c.text.trim().length > 0)
          : [];

        if (filledCells.length !== 1) break;

        const text = filledCells[0].text.trim();
        titleRun.push({
          source: `#${t.physicalIndex} row 0`,
          tableIndex: t.physicalIndex,
          rowIndex: 0,
          text,
          section: this.isSectionLine(text),
        });
      }

      // titleRun was collected bottom-up; reverse for top-down document order
      titleRun.reverse();

      // Update in-force section line if any section line is present in titleRun
      let updatedSection = currentSection;
      for (const line of titleRun) {
        if (line.section) {
          updatedSection = line;
        }
      }

      // Lower lines: title lines of T after its last section line
      let ownLowerLines = [];
      if (titleRun.length > 0) {
        let lastSecIdx = -1;
        for (let i = titleRun.length - 1; i >= 0; i--) {
          if (titleRun[i].section) {
            lastSecIdx = i;
            break;
          }
        }
        if (lastSecIdx === -1) {
          ownLowerLines = titleRun;
        } else {
          ownLowerLines = titleRun.slice(lastSecIdx + 1);
        }
      }

      let finalPath = [];
      let inherited = false;
      let newPrevLowerLines = prevLowerLines;

      if (titleRun.length > 0) {
        inherited = false;
        newPrevLowerLines = ownLowerLines;
        if (updatedSection) {
          finalPath = [updatedSection, ...ownLowerLines];
        } else {
          finalPath = ownLowerLines;
        }
      } else {
        inherited = true;
        if (updatedSection) {
          finalPath = [updatedSection, ...prevLowerLines];
        } else {
          finalPath = prevLowerLines;
        }
      }

      return {
        path: finalPath,
        inherited,
        newSection: updatedSection,
        newPrevLowerLines,
      };
    }

    /**
     * Compute title paths sequentially across all data tables in document order.
     * Preserves section persistence and lower lines inheritance.
     *
     * @param {Object[]} allTables - All tables in document
     * @param {number[]} dataTableIndices - Physical indices of data tables in document order
     * @param {Map<number, number>} [recoveredMap=new Map()] - Map of tableIndex -> recoveredHIndex
     * @returns {Map<number, { path: Object[], inherited: boolean }>}
     */
    static computeAllTitlePaths(allTables, dataTableIndices, recoveredMap = new Map()) {
      let currentSection = null;
      let prevLowerLines = [];
      const results = new Map();

      for (const phys of dataTableIndices) {
        const table = allTables.find(t => t.physicalIndex === phys);
        if (!table) continue;

        const recoveredH = recoveredMap.get(phys) || null;
        const res = this.computeTitlePath(table, allTables, recoveredH, currentSection, prevLowerLines);

        currentSection = res.newSection;
        prevLowerLines = res.newPrevLowerLines;

        results.set(phys, {
          path: res.path,
          inherited: res.inherited,
        });
        table.titlePath = res.path;
        table.titleInherited = res.inherited;
      }

      return results;
    }
  }

  // Export for browser and Node.js environments
  if (typeof window !== 'undefined') {
    window.HeaderRecovery = HeaderRecovery;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderRecovery;
  }
})();
