/**
 * validator.js — Quality Assurance for extracted tables
 *
 * Implements rules:
 * 1. Interactive: Detects "double rows" (e.g. "Pipe\nPipe") and offers to split.
 * 2. Auto: Deletes empty first rows.
 * 3. Auto: Promotes first row to header if headers are generic.
 * 4. Auto: Demotes header if it contains newlines (e.g., "Pipe\nPipe").
 */

class TableValidator {
    constructor() {
        this.changes = [];
        this.masterEnabled = true; // Master toggle
        this.rules = {
            '4': { id: '4', enabled: true, name: "Demote Multi-line Headers", desc: "If a header contains newlines (e.g., 'Pipe\\nPipe'), move it to the first data row." },
            '2': { id: '2', enabled: true, name: "Delete Empty First Row", desc: "If the first row of data is completely empty, remove it." },
            '3': { id: '3', enabled: true, name: "Auto-Promote Header", desc: "If headers are generic (Column_1...) and the first row looks like a header, promote it." },
            '5': { id: '5', enabled: false, name: "De-duplicate while merging", desc: "Reduces cells containing repeated lines (e.g., 'Pipe\\nPipe' -> 'Pipe')." },
            '1': { id: '1', enabled: true, name: "Split Merged Rows", desc: "Interactively detect rows with repeated text (e.g., 'Pipe\\nPipe') and offer to split them." },
            '6': { id: '6', enabled: true, name: "Split Merged Columns", desc: "Interactively detect columns with combined data (e.g., 'Val1   Val2') and offer to split. Requires at least 2 matching rows and 80% consistency." }
        };
        // Default order
        this.order = ['4', '2', '3', '5', '1', '6'];

        this.loadState();
    }

    loadState() {
        const saved = localStorage.getItem('validator_state');
        if (saved) {
            try {
                const state = JSON.parse(saved);
                this.masterEnabled = state.masterEnabled !== undefined ? state.masterEnabled : true;
                if (state.order && Array.isArray(state.order)) this.order = state.order;
                if (state.rules) {
                    for (const id in state.rules) {
                        if (this.rules[id]) {
                            this.rules[id].enabled = state.rules[id].enabled;
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to load validator state', e);
            }
        }
    }

    saveState() {
        const state = {
            masterEnabled: this.masterEnabled,
            order: this.order,
            rules: {}
        };
        for (const id in this.rules) {
            state.rules[id] = { enabled: this.rules[id].enabled };
        }
        localStorage.setItem('validator_state', JSON.stringify(state));
    }

    /**
     * Main entry point. Runs after extraction.
     */
    async validateAll() {
        if (!this.masterEnabled) {
            console.log("Validator: Skipped (Master Disabled).");
            return;
        }

        console.log("Validator: Starting validation...");
        this.changes = [];

        // Execute rules in defined order
        for (const ruleId of this.order) {
            const rule = this.rules[ruleId];
            if (!rule || !rule.enabled) continue;

            const tableCount = appState.tables.length;
            for (let tIdx = 0; tIdx < tableCount; tIdx++) {
                const table = appState.tables[tIdx];
                if (!table) continue;

                // Dispatch to specific rule handler
                // We use a mapping or switch
                switch (ruleId) {
                    case '4': this._checkHeaderDemotion(table); break;
                    case '2': this._checkEmptyFirstRow(table); break;
                    case '3': this._checkAutoPromoteHeader(table); break;
                    case '5': this._checkDeduplication(table); break;
                    case '1':
                        const splitCandidates = this._checkRepeatedTextRows(table);
                        if (splitCandidates.length > 0) {
                            splitCandidates.sort((a, b) => b - a);
                            await this._promptSplit(table, splitCandidates);
                        }
                        break;
                    case '6':
                        const colCandidates = this._checkMergedColumns(table);
                        if (colCandidates.length > 0) {
                            colCandidates.sort((a, b) => b.colIndex - a.colIndex);
                            await this._promptColumnSplit(table, colCandidates);
                        }
                        break;
                }
            }
        }

        if (this.changes.length > 0) {
            renderAllTabs();
            updateStatusBar();
        }

        console.log("Validator: Validation complete.");
    }

    hasChanges() {
        return this.changes.length > 0;
    }

    toggleMaster() {
        this.masterEnabled = !this.masterEnabled;
        this.saveState();
        this.renderPanel();
    }

    toggleRule(ruleId) {
        if (this.rules[ruleId]) {
            this.rules[ruleId].enabled = !this.rules[ruleId].enabled;
            this.saveState();
            this.renderPanel(); // Re-render tab to update toggle UI
        }
    }

    async reRun() {
        await this.validateAll();
        this.renderPanel();
    }

    // Drag and Drop Handlers
    handleDragStart(e, ruleId) {
        e.dataTransfer.setData('text/plain', ruleId);
        e.dataTransfer.effectAllowed = 'move';
        e.target.classList.add('dragging');
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    handleDrop(e, targetRuleId) {
        e.preventDefault();
        const startRuleId = e.dataTransfer.getData('text/plain');
        document.querySelector('.rule-item.dragging')?.classList.remove('dragging');

        if (startRuleId === targetRuleId) return;

        const fromIndex = this.order.indexOf(startRuleId);
        const toIndex = this.order.indexOf(targetRuleId);

        if (fromIndex >= 0 && toIndex >= 0) {
            // Move item
            this.order.splice(fromIndex, 1);
            this.order.splice(toIndex, 0, startRuleId);
            this.saveState();
            this.renderPanel();
        }
    }

    renderPanel() {
        const rulesContainer = document.getElementById('validator-rules-target');
        const reportContainer = document.getElementById('validator-report-target');

        if (!rulesContainer || !reportContainer) return;

        // Master Switch
        let configHtml = `
            <div class="validator-master-switch" style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border);">
                <label class="switch">
                    <input type="checkbox" ${this.masterEnabled ? 'checked' : ''} onchange="validator.toggleMaster()">
                    <span class="slider round"></span>
                </label>
                <span style="font-weight: bold; margin-left: 10px; font-size: 1.1rem; vertical-align: middle;">Enable Auto-Validator (Quality Rules)</span>
            </div>
            <div class="validator-rules-list" ${!this.masterEnabled ? 'style="opacity: 0.5; pointer-events: none;"' : ''}>
        `;

        for (const id of this.order) {
            const rule = this.rules[id];
            const checked = rule.enabled ? 'checked' : '';

            configHtml += `
                <div class="rule-item" draggable="true" 
                     ondragstart="validator.handleDragStart(event, '${id}')"
                     ondragover="validator.handleDragOver(event)"
                     ondrop="validator.handleDrop(event, '${id}')"
                     style="margin-bottom: 10px; display: flex; align-items: flex-start; gap: 10px; padding: 10px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; cursor: grab;">
                    
                    <div class="drag-handle" style="cursor: grab; display: flex; align-items: center; padding-top: 5px; color: var(--text-muted);">
                        ⋮⋮
                    </div>

                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <strong style="color: var(--text-primary); font-size: 1rem;">${rule.name}</strong>
                             <label class="switch" style="transform: scale(0.8);">
                                <input type="checkbox" ${checked} onchange="validator.toggleRule('${id}')">
                                <span class="slider round"></span>
                            </label>
                        </div>
                        <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 4px 0 0 0;">${rule.desc}</p>
                    </div>
                </div>
            `;
        }
        configHtml += `</div>`;
        rulesContainer.innerHTML = configHtml;

        let reportHtml = `<h3 style="margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px;">Validation Report</h3>`;
        if (this.changes.length === 0) {
            reportHtml += `
                <div class="empty-state-small" style="text-align:center; padding: 15px; color: var(--text-muted); background: var(--bg-secondary); border-radius: 4px;">
                    <p style="margin:0;">No issues found in last run.</p>
                </div>
            `;
        } else {
            reportHtml += `<ul class="validator-list" style="list-style:none; padding:0;">`;
            for (const change of this.changes) {
                const table = appState.tables[change.tableIndex];
                const tableName = table ? `(${table.tableName})` : '';
                reportHtml += `
                    <li class="validator-item" style="background: var(--bg-secondary); padding: 8px; margin-bottom: 6px; border-radius: 4px; border-left: 3px solid var(--accent);">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <a href="#" onclick="app.scrollToTable(${change.tableIndex}); return false;" style="font-weight:bold; color: var(--accent); text-decoration:none;">
                                Table ${change.tableIndex + 1}
                            </a>
                            <span class="badge" style="background:var(--bg-primary); padding:2px 6px; border-radius:4px; font-size:0.75rem;">Rule ${change.rule}</span>
                        </div>
                        <div class="v-msg" style="font-size:0.9rem; color:var(--text-primary);">${this._escapeHTML(change.message)}</div>
                    </li>
                `;
            }
            reportHtml += `</ul>`;
        }
        reportContainer.innerHTML = reportHtml;
    }

    // ─── Rule 4: Header Demotion ───
    _checkHeaderDemotion(table) {
        if (!table.headers || table.headers.length === 0) return false;
        const hasNewline = table.headers.some(h => typeof h === 'string' && h.includes('\n'));

        if (hasNewline) {
            const oldHeaders = [...table.headers];

            // Clean headers before demoting:
            // If header is "Column_X", replace with empty string in data row.
            const cleanedHeaders = oldHeaders.map(h => {
                const s = String(h || '');
                if (!s || s.startsWith('Column_')) return '';
                return s;
            });

            table.dataRows.unshift(cleanedHeaders);
            table.rows++;
            table.headers = oldHeaders.map((_, i) => `Column_${i + 1}`);
            this._logChange(table.index, '4', 'Demoted headers containing newlines to first row.');
            return true;
        }
        return false;
    }

    // ─── Rule 2: Empty First Row ───
    _checkEmptyFirstRow(table) {
        if (table.dataRows.length === 0) return false;
        const firstRow = table.dataRows[0];
        // Safe trim check for all cells
        const isEmpty = firstRow.every(cell => this._safeTrim(cell) === '');

        if (isEmpty) {
            table.dataRows.shift();
            table.rows--;
            this._logChange(table.index, '2', 'Deleted empty first row.');
            return true;
        }
        return false;
    }

    // ─── Rule 3: Auto Promote Header ───
    _checkAutoPromoteHeader(table) {
        // Headers might be non-strings?
        const isGeneric = table.headers.every(h => String(h).startsWith('Column_'));
        if (!isGeneric || table.dataRows.length === 0) return false;

        const firstRow = table.dataRows[0];

        // Critical Fix: Do NOT auto-promote if the row contains newlines
        // Safe check for newline
        const hasNewline = firstRow.some(c => c && String(c).includes('\n'));
        if (hasNewline) return false;

        const cols = firstRow.length;
        // Helper specifically for this rule to keep logic clean
        const isBlank = (val) => this._safeTrim(val) === '';
        const hasContent = (val) => this._safeTrim(val) !== '';

        const condA = isBlank(firstRow[0]) && firstRow.slice(1).every(hasContent);

        const condB = cols > 5 &&
            isBlank(firstRow[0]) &&
            isBlank(firstRow[1]) &&
            firstRow.slice(2).every(hasContent);

        const condC = firstRow.every(hasContent);

        if (condA || condB || condC) {
            const newHeaders = [...firstRow];
            const oldHeaders = [...table.headers];
            table.dataRows.shift();
            table.rows--;
            table.headers = newHeaders.map((h, i) => h || oldHeaders[i]);

            const rule = condA ? "3a" : (condB ? "3b" : "3c");
            this._logChange(table.index, rule, 'Promoted first row to header.');
            return true;
        }
        return false;
    }

    // ─── Rule 5: De-duplicate while merging ───
    _checkDeduplication(table) {
        let count = 0;
        table.dataRows.forEach((row, rIndex) => {
            row.forEach((cell, cIndex) => {
                // Check string type first
                if (typeof cell === 'string' && cell.includes('\n')) {
                    const parts = cell.split('\n');
                    // Check if all parts are identical (ignoring empty lines?)
                    // Let's trim each part first.
                    const cleanParts = parts.map(p => this._safeTrim(p)).filter(p => p.length > 0);

                    if (cleanParts.length > 1) {
                        const first = cleanParts[0];
                        const allSame = cleanParts.every(p => p === first);
                        if (allSame) {
                            table.dataRows[rIndex][cIndex] = first;
                            count++;
                        }
                    }
                }
            });
        });

        if (count > 0) {
            this._logChange(table.index, '5', `Deduplicated content in ${count} cells.`);
            return true;
        }
        return false;
    }

    // ─── Rule 1: Repeated Text (Split) ───
    _checkRepeatedTextRows(table) {
        const candidates = [];
        table.dataRows.forEach((row, rIndex) => {
            let patternCount = 0;
            for (const cell of row) {
                if (!cell || typeof cell !== 'string') continue;
                if (cell.includes('\n')) {
                    const parts = cell.split('\n');
                    if (parts.length >= 2 && this._safeTrim(parts[0]) === this._safeTrim(parts[1])) {
                        patternCount++;
                    }
                }
            }
            if (patternCount > 0) candidates.push(rIndex);
        });
        return candidates;
    }

    // ─── Rule 6: Split Merged Columns ───
    _checkMergedColumns(table) {
        const candidates = [];
        if (!table.dataRows || table.dataRows.length === 0) return candidates;

        const numCols = table.headers.length;
        const separators = [
            { seq: '\t', label: 'Tab' },
            { seq: '     ', label: '5 spaces' },
            { seq: '    ', label: '4 spaces' },
            { seq: '   ', label: '3 spaces' },
            { seq: '• ', label: 'Bullet (• )' },
            { seq: '•', label: 'Bullet (•)' }
        ];

        for (let c = 0; c < numCols; c++) {
            // Check if column is eligible (non-empty)
            // Logic: The separator must exist in ALL non-empty rows for this column.

            let bestSep = null;

            for (const sep of separators) {
                let matchCount = 0;
                let dataRowCount = 0;
                let debugMisses = []; // Log first few misses

                for (let r = 0; r < table.dataRows.length; r++) {
                    const row = table.dataRows[r];
                    let cell = row[c];

                    try {
                        // Ensure cell is string safe
                        if (cell === null || cell === undefined) continue;
                        cell = String(cell);

                        // Use consistent helper logic inline
                        if (this._safeTrim(cell) === '') continue;

                        // Normalize non-breaking spaces
                        cell = cell.replace(/\u00A0/g, ' ');

                        dataRowCount++;
                        // Check if separator exists
                        if (cell.includes(sep.seq)) {
                            matchCount++;
                        } else if (debugMisses.length < 3) {
                            debugMisses.push(`Row ${r + 1} val: "${cell.substring(0, 15)}..."`);
                        }
                    } catch (e) {
                        console.error(`Validator Rule 6 Error at Row ${r + 1}, Col ${c}:`, e, "Value:", row[c]);
                    }
                }

                const ratio = dataRowCount > 0 ? (matchCount / dataRowCount) : 0;
                // console.log(`[Validator] Col ${c} Sep '${sep.label}': ${matchCount}/${dataRowCount} (${(ratio*100).toFixed(1)}%)`);

                // Threshold: If >80% of data rows have this separator
                // Also ensure we have enough matches (at least 2 matching rows)
                if (dataRowCount > 1 && ratio >= 0.8) {
                    // console.log(`[Validator] Candidate Found! Col ${c} with '${sep.label}'`);
                    bestSep = sep;
                    break; // stop at first (prioritized) separator found
                }
            }

            if (bestSep) {
                candidates.push({ colIndex: c, separator: bestSep });
            }
        }
        return candidates;
    }

    async _promptColumnSplit(table, candidates) {
        for (const cand of candidates) {
            const colIndex = cand.colIndex;
            const sep = cand.separator;
            const header = table.headers[colIndex] || `Column ${colIndex + 1}`;

            // Preview: Show just this column and the split result
            let html = '<div class="table-preview-wrapper"><table class="result-table"><thead><tr>';
            html += `<th>${this._escapeHTML(header)} (Current)</th><th>Split 1</th><th>Split 2</th>`;
            html += '</tr></thead><tbody>';

            // Show first 5 rows
            const previewRows = table.dataRows.slice(0, 5);
            previewRows.forEach(row => {
                const cell = String(row[colIndex] || '');
                const parts = cell.split(sep.seq);
                const p1 = parts[0] || '';
                const p2 = parts.slice(1).join(sep.seq) || ''; // Join rest

                html += `<tr>
                    <td>${this._escapeHTML(cell)}</td>
                    <td style="background:#e6fffa; color:#333;">${this._escapeHTML(p1)}</td>
                    <td style="background:#e6fffa; color:#333;">${this._escapeHTML(p2)}</td>
                </tr>`;
            });
            html += '</tbody></table></div>';
            if (table.dataRows.length > 5) html += `<p>...and ${table.dataRows.length - 5} more rows.</p>`;

            const confirmed = await this._showModal(
                `Table ${table.index + 1}: Split Column "${header}"?`,
                `<p>Detected separator: <strong>${sep.label}</strong>.</p>
                 ${html}
                 <p>Do you want to split this column?</p>`
            );

            if (confirmed) {
                this._performColumnSplit(table, colIndex, sep.seq);
                this._logChange(table.index, '6', `Split column ${colIndex + 1} using "${sep.label}".`);
            }
        }
    }

    _performColumnSplit(table, colIndex, separator) {
        // 1. Update Headers
        const oldHeader = table.headers[colIndex];
        table.headers.splice(colIndex, 1, `${oldHeader}_1`, `${oldHeader}_2`);

        // 2. Update Rows
        table.dataRows.forEach(row => {
            const cell = String(row[colIndex] || '');
            let p1 = '', p2 = '';

            if (cell.includes(separator)) {
                const parts = cell.split(separator);
                p1 = parts[0];
                p2 = parts.slice(1).join(separator); // Keep remaining separators if any? Or split all?
                // User said "Split Merged Columns", usually implies split into 2. 
                // But if text is "A  B  C", maybe 3?
                // Let's stick to split-once-at-first-separator for now, or split all?
                // "derived new column is having same data"
                // Let's assume binary split for now as displayed in preview.
            } else {
                p1 = cell;
                p2 = '';
            }

            // Trim safely
            p1 = this._safeTrim(p1);
            p2 = this._safeTrim(p2);

            row.splice(colIndex, 1, p1, p2);
        });

        // Update col count?
        // table.cols++; // Not explicitly tracked in simple object, usually derived.
    }

    async _promptSplit(table, rowIndices) {
        for (const rowIndex of rowIndices) {
            const row = table.dataRows[rowIndex];

            // Build Table Preview
            let html = '<div class="table-preview-wrapper" style="overflow-x:auto; margin: 10px 0; border:1px solid var(--border); border-radius:4px;"><table class="result-table" style="width:100%"><thead><tr>';
            table.headers.forEach(h => {
                html += `<th>${this._escapeHTML(String(h))}</th>`;
            });
            html += '</tr></thead><tbody><tr>';
            row.forEach(cell => {
                const escaped = this._escapeHTML(String(cell || ''));
                html += `<td>${escaped.replace(/\n/g, '<br>')}</td>`;
            });
            html += '</tr></tbody></table></div>';

            const confirmed = await this._showModal(
                `Table ${table.index + 1}: Split Row?`,
                `<p>Row ${rowIndex + 1} contains repeated text (e.g. "Pipe<br>Pipe").</p>
                 ${html}
                 <p>Do you want to split this into two rows?</p>`
            );

            if (confirmed) {
                this._performSplit(table, rowIndex);
                this._logChange(table.index, '1', `Split row ${rowIndex + 1} (Interactive).`);
            }
        }
    }

    _performSplit(table, rowIndex) {
        const originalRow = table.dataRows[rowIndex];
        const rowA = [];
        const rowB = [];

        originalRow.forEach(cell => {
            // Ensure checked safely
            if (cell && typeof cell === 'string' && cell.includes('\n')) {
                // Find index of first newline
                const idx = cell.indexOf('\n');
                // Row A gets part BEFORE newline
                rowA.push(this._safeTrim(cell.substring(0, idx)));
                // Row B gets part AFTER newline (and subsequent newlines joined or kept?)
                // User said "look for text after \n".
                // If there are multiple newlines, we should probably keep them in the second row
                // or split further?
                // The requirement implies a simple split: Part1 -> Row A, Rest -> Row B.
                rowB.push(this._safeTrim(cell.substring(idx + 1)));
            } else {
                // If no newline, keep value in Row A, empty in Row B
                rowA.push(cell);
                rowB.push("");
            }
        });

        table.dataRows[rowIndex] = rowA;
        table.dataRows.splice(rowIndex + 1, 0, rowB);
        table.rows++;
    }

    _showModal(title, bodyHTML) {
        return new Promise((resolve) => {
            let modal = document.getElementById('validator-modal');
            if (!modal) {
                // Ensure modal created if not exists
                // Code omitted for brevity, but should be same as before or rely on pre-existing DOM
                modal = document.createElement('div');
                modal.id = 'validator-modal';
                modal.className = 'modal-overlay';
                modal.innerHTML = `
                    <div class="modal-content">
                        <h3 id="vm-title"></h3>
                        <div id="vm-body"></div>
                        <div class="modal-actions">
                            <button id="vm-yes" class="btn-primary">Yes, Split</button>
                            <button id="vm-no" class="btn-secondary">No, Skip</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            modal.querySelector('#vm-title').textContent = title;
            modal.querySelector('#vm-body').innerHTML = bodyHTML;
            modal.style.display = 'flex';

            const btnYes = modal.querySelector('#vm-yes');
            const btnNo = modal.querySelector('#vm-no');

            const newYes = btnYes.cloneNode(true);
            const newNo = btnNo.cloneNode(true);
            btnYes.parentNode.replaceChild(newYes, btnYes);
            btnNo.parentNode.replaceChild(newNo, btnNo);

            newYes.onclick = () => {
                modal.style.display = 'none';
                resolve(true);
            };
            newNo.onclick = () => {
                modal.style.display = 'none';
                resolve(false);
            };
        });
    }

    _logChange(tableIndex, ruleId, message) {
        this.changes.push({
            tableIndex: tableIndex,
            rule: ruleId,
            message: message
        });
        console.log(`[Validator] Table ${tableIndex + 1} (Rule ${ruleId}): ${message}`);
    }

    _safeTrim(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }

    _escapeHTML(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

const validator = new TableValidator();
window.validator = validator; // Explicit global assignment
console.log("Validator initialized and attached to window.");
