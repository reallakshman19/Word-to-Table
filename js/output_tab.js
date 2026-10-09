/**
 * output_tab.js
 * 
 * Handles the "Output" tab functionality:
 * 1. Tree View Selection (Pages -> Tables)
 * 2. Export Configuration (Path, Toggle Logs)
 * 3. Batch Export Actions (Individual CSVs / Combined Excel)
 */

const OutputTab = {
    // State
    selectedItems: new Set(), // Set of table indices
    targetPath: '',
    includeLogs: true,

    render: function () {
        const container = document.getElementById('tab-output');
        if (!container) return;

        // Group tables by page
        const tablesByPage = this._groupTablesByPage();

        container.innerHTML = `
            <div class="output-layout">
                <!-- Left Panel: Selection Tree -->
                <div class="output-sidebar">
                    <div class="sidebar-header">
                        <h3>Select Tables</h3>
                        <div class="selection-actions">
                            <button class="btn-micro" onclick="OutputTab.selectAllVerified()">All Verified</button>
                            <button class="btn-micro" onclick="OutputTab.selectAll()">Select All</button>
                            <button class="btn-micro" onclick="OutputTab.deselectAll()">None</button>
                        </div>
                    </div>
                    <div class="tree-view">
                        ${this._renderTree(tablesByPage)}
                    </div>
                </div>

                <!-- Right Panel: Export Options -->
                <div class="output-main">
                    <div class="export-card">
                        <h3>Export Configuration</h3>
                        
                        <div class="form-group">
                            <label>Target Directory</label>
                            <div class="input-with-btn">
                                <input type="text" id="export-path" value="${this.targetPath || 'C:/Exports'}" readonly>
                                <button class="btn-secondary" onclick="OutputTab.browseFolder()">📁 Browse...</button>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="toggle-switch-label">
                                <input type="checkbox" id="chk-export-logs" ${this.includeLogs ? 'checked' : ''} onchange="OutputTab.toggleLogs(this.checked)">
                                Export Log with Data
                            </label>
                            <p class="desc-small">
                                Individual: Saves "Extraction_Log.txt" in folder.<br>
                                Combined: Adds "Processing_Log" sheet to Excel.
                            </p>
                        </div>

                        <div class="action-buttons">
                            <button class="btn-primary-large" onclick="OutputTab.exportBatch('individual')">
                                <div class="icon">📄</div>
                                <div class="text">
                                    <strong>Export Individual CSVs</strong>
                                    <span>One file per table</span>
                                </div>
                            </button>
                            
                            <button class="btn-primary-large" onclick="OutputTab.exportBatch('combined')">
                                <div class="icon">📑</div>
                                <div class="text">
                                    <strong>Export Combined Excel</strong>
                                    <span>All tables in one .xlsx file</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    _groupTablesByPage: function () {
        if (!appState.tables) return {};
        const groups = {};
        appState.tables.forEach(t => {
            if (!groups[t.pageNumber]) groups[t.pageNumber] = [];
            groups[t.pageNumber].push(t);
        });
        return groups;
    },

    _renderTree: function (groups) {
        let html = '';
        const sortedPages = Object.keys(groups).sort((a, b) => Number(a) - Number(b));

        if (sortedPages.length === 0) {
            return '<div class="empty-tree">No tables available.</div>';
        }

        sortedPages.forEach(pageNum => {
            const tables = groups[pageNum];
            html += `
                <div class="tree-page-group">
                    <div class="tree-page-header">Page ${pageNum}</div>
                    <div class="tree-table-list">
            `;

            tables.forEach(t => {
                const isChecked = this.selectedItems.has(t.index) ? 'checked' : '';
                const statusClass = t.approved ? 'status-approved' : 'status-pending';
                const statusIcon = t.approved ? '✅' : '⚠️';

                html += `
                    <div class="tree-item">
                        <label>
                            <input type="checkbox" ${isChecked} onchange="OutputTab.toggleSelection(${t.index}, this.checked)">
                            <span class="table-name ${statusClass}">${statusIcon} ${t.tableName}</span>
                        </label>
                    </div>
                `;
            });

            html += `</div></div>`;
        });
        return html;
    },

    toggleSelection: function (index, checked) {
        if (checked) this.selectedItems.add(index);
        else this.selectedItems.delete(index);
    },

    selectAll: function () {
        appState.tables.forEach(t => this.selectedItems.add(t.index));
        this.render();
    },

    selectAllVerified: function () {
        this.selectedItems.clear();
        appState.tables.filter(t => t.approved).forEach(t => this.selectedItems.add(t.index));
        this.render();
    },

    deselectAll: function () {
        this.selectedItems.clear();
        this.render();
    },

    toggleLogs: function (checked) {
        this.includeLogs = checked;
    },

    browseFolder: async function () {
        try {
            const resp = await fetch('/select_folder');
            const data = await resp.json();
            if (data.path) {
                this.targetPath = data.path;
                this.render(); // Re-render to show path
            }
        } catch (e) {
            alert("Error selecting folder: " + e.message);
        }
    },

    exportBatch: async function (mode) {
        if (this.selectedItems.size === 0) {
            alert("Please select at least one table to export.");
            return;
        }

        if (!this.targetPath) {
            alert("Please select a target directory.");
            return;
        }

        const indices = Array.from(this.selectedItems);
        showLoading(true);
        showStatus(`Exporting ${indices.length} tables...`, 'working');

        try {
            // Prepare payload with full table objects
            const tableObjects = indices.map(idx => {
                const t = appState.tables[idx];
                return {
                    tableName: t.tableName,
                    csv: t.csv,
                    headers: t.headers,
                    dataRows: t.dataRows
                };
            });

            const payload = {
                path: this.targetPath,
                mode: mode,
                include_log: this.includeLogs,
                tables: indices,
                tableObjects: tableObjects // Send full data
            };

            const resp = await fetch('/export_batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await resp.json();

            if (result.success) {
                showStatus(`Export Successful! Saved to ${this.targetPath}`, 'success');
                if (typeof logAction === 'function') {
                    logAction(`Batch Export (${mode}) completed. ${result.count} files saved.`);
                }
            } else {
                showStatus(`Export Failed: ${result.error}`, 'error');
            }
        } catch (e) {
            showStatus(`Export Error: ${e.message}`, 'error');
        } finally {
            showLoading(false);
        }
    }
};

// Expose
window.OutputTab = OutputTab;
