/**
 * table_editor.js — Spreadsheet-like editor for single tables
 * 
 * Features:
 * - ContentEditable grid
 * - Row/Col selection & manipulation
 * - Merge/Split support
 * - Recording of all actions
 */

class TableEditor {
    constructor() {
        this.container = null;
        this.activeTableIndex = -1;
        this.selectedCells = new Set(); // store "row:col" strings
    }

    init() {
        this.container = document.getElementById('tab-edit');
    }

    render() {
        if (!this.container) this.init();
        if (!this.container) return;

        this.renderToolbar();
        this.renderGridContainer();

        // Auto-load if active
        if (this.activeTableIndex !== -1) {
            this.loadTable(this.activeTableIndex);
        } else if (appState.activeTableIndex !== -1) {
            this.loadTable(appState.activeTableIndex);
        }
    }

    renderToolbar() {
        const pages = app.getPageNumbers();
        const activePage = appState.activePageTab;

        // Filter tables for current page
        const pageTables = app.getTablesByPage(activePage);

        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        toolbar.innerHTML = `
            <div class="toolbar-group">
                <label>Page:</label>
                <select id="editor-page-select" onchange="tableEditor.switchPage(this.value)">
                    ${pages.map(p => `<option value="${p}" ${p == activePage ? 'selected' : ''}>Page ${p}</option>`).join('')}
                </select>
                <label>Table:</label>
                <select id="editor-table-select" onchange="tableEditor.loadTable(this.value)">
                    <option value="-1">-- Select --</option>
                    ${pageTables.map(t => `<option value="${t.index}" ${t.index == this.activeTableIndex ? 'selected' : ''}>${t.tableName}</option>`).join('')}
                </select>
            </div>
            <div class="toolbar-divider"></div>
            <div class="toolbar-group">
                <button onclick="tableEditor.mergeCells()" title="Merge selected cells (Content only)" class="btn-toolbar">Merge</button>
                <button onclick="tableEditor.splitCell()" title="Split content by newline" class="btn-toolbar">Split</button>
            </div>
            <div class="toolbar-divider"></div>
            <div class="toolbar-group">
                <button onclick="tableEditor.insertRow()" title="Insert Row Below" class="btn-toolbar">+Row</button>
                <button onclick="tableEditor.deleteRow()" title="Delete Selected Row" class="btn-toolbar">-Row</button>
                <button onclick="tableEditor.insertCol()" title="Insert Column Right" class="btn-toolbar">+Col</button>
                <button onclick="tableEditor.deleteCol()" title="Delete Selected Column" class="btn-toolbar">-Col</button>
            </div>
            <div class="toolbar-divider"></div>
            <div class="toolbar-group">
                 <button onclick="tableEditor.saveChanges()" class="btn-toolbar primary">💾 Save</button>
                 <button onclick="tableEditor.downloadCSV()" class="btn-toolbar">⬇️ CSV</button>
            </div>
        `;

        this.container.innerHTML = '';
        this.container.appendChild(toolbar);
    }

    switchPage(pageNum) {
        pageNum = parseInt(pageNum);
        appState.activePageTab = pageNum;
        // Re-render toolbar to update table list
        this.renderToolbar();
        // Load first table if none active
        const tables = app.getTablesByPage(pageNum);
        if (tables.length > 0) {
            this.loadTable(tables[0].index);
        } else {
            this.loadTable(-1);
        }
    }

    renderGridContainer() {
        const div = document.createElement('div');
        div.id = 'editor-grid-container';
        div.className = 'editor-grid-container';
        div.innerHTML = `
            <div class="empty-state">
                <div class="icon">✏️</div>
                <p>Select a table to edit.</p>
            </div>
        `;
        this.container.appendChild(div);
    }

    loadTable(index) {
        index = parseInt(index);
        if (index === -1) {
            this.activeTableIndex = -1;
            this.renderGridContainer();
            return;
        }

        const table = appState.tables.find(t => t.index === index);
        if (!table) return;

        this.activeTableIndex = index;

        // Update valid selection in dropdown
        const select = document.getElementById('editor-table-select');
        if (select) select.value = index;

        this.renderGrid(table);
        this.status(`Loaded ${table.tableName}`);
    }

    renderGrid(table) {
        const container = document.getElementById('editor-grid-container');
        if (!container) return;

        let html = '<table class="editor-table">';

        // Headers
        html += '<thead><tr><th class="row-header">#</th>';
        const colCount = table.headers ? table.headers.length : (table.dataRows[0]?.length || 0);

        for (let c = 0; c < colCount; c++) {
            const txt = (table.headers && table.headers[c]) ? table.headers[c] : `Col ${c + 1}`;
            html += `<th contenteditable="true" onblur="tableEditor.updateHeader(${c}, this.innerText)">${txt}</th>`;
        }
        html += '</tr></thead><tbody>';

        // Body
        table.dataRows.forEach((row, r) => {
            html += `<tr><td class="row-header" onclick="tableEditor.selectRow(${r})">${r + 1}</td>`;
            for (let c = 0; c < colCount; c++) {
                const val = (row[c] !== undefined) ? row[c] : "";
                // Add onclick for selection
                html += `<td contenteditable="true" 
                            data-r="${r}" data-c="${c}"
                            onfocus="tableEditor.onCellFocus(this, ${r}, ${c})"
                            onblur="tableEditor.updateCell(${r}, ${c}, this.innerText)"
                            onclick="tableEditor.handleCellClick(event, ${r}, ${c})">${val}</td>`;
            }
            html += `</tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    updateCell(row, col, value) {
        if (this.activeTableIndex === -1) return;
        const table = appState.tables[this.activeTableIndex];

        // Update State
        if (table.dataRows[row]) {
            table.dataRows[row][col] = value;
        }

        // Record
        if (typeof recordEvent === 'function') {
            recordEvent('editCell', { tableIndex: this.activeTableIndex, row, col, value });
        }
    }

    updateHeader(col, value) {
        if (this.activeTableIndex === -1) return;
        const table = appState.tables[this.activeTableIndex];

        if (table.headers) {
            table.headers[col] = value;
        }

        if (typeof recordEvent === 'function') {
            recordEvent('updateHeader', { tableIndex: this.activeTableIndex, col, value });
        }
    }

    saveChanges() {
        if (this.activeTableIndex === -1) return;
        const table = appState.tables[this.activeTableIndex];

        // Reconstruct CSV (Logic from results_tab.js)
        const escapeCsv = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val).replace(/"/g, '""');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str}"`;
            return str;
        };

        const headerLine = table.headers.map(escapeCsv).join(',');
        const rowLines = table.dataRows.map(r => r.map(escapeCsv).join(',')).join('\n');
        table.csv = headerLine + '\n' + rowLines;

        this.status(`Changes saved. CSV updated for ${table.tableName}.`);
    }

    status(msg) {
        // Basic console log or toast
        console.log(`[Editor] ${msg}`);
        const el = document.getElementById('status');
        if (el) el.textContent = msg;
    }

    handleCellClick(e, r, c) {
        if (e.ctrlKey || e.metaKey) {
            // Add to selection
            this.toggleSelection(r, c);
        } else if (e.shiftKey) {
            // Range selection (simple impl: from last selected to this)
            // For now, just add
            this.toggleSelection(r, c);
        } else {
            // Single select (clear others unless already selected)
            // But contenteditable focus handles visual "selection" of text.
            // We need a way to mark "Cell Selected" vs "Editing Text".
            // Let's rely on stored active cell.
            this.selectedCells.clear();
            this.selectedCells.add(`${r}:${c}`);
        }
        this.refreshHighlights();
    }

    toggleSelection(r, c) {
        const key = `${r}:${c}`;
        if (this.selectedCells.has(key)) this.selectedCells.delete(key);
        else this.selectedCells.add(key);
    }

    selectRow(r) {
        // value of r
        const table = appState.tables[this.activeTableIndex];
        const cols = table.dataRows[r].length;
        this.selectedCells.clear();
        for (let c = 0; c < cols; c++) this.selectedCells.add(`${r}:${c}`);
        this.refreshHighlights();
    }

    refreshHighlights() {
        const tbl = document.querySelector('#editor-grid-container table');
        if (!tbl) return;

        // Clear all
        tbl.querySelectorAll('td.selected').forEach(td => td.classList.remove('selected'));

        // Apply
        this.selectedCells.forEach(key => {
            const [r, c] = key.split(':');
            const td = tbl.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
            if (td) td.classList.add('selected');
        });
    }

    onCellFocus(td, r, c) {
        // If simply focusing, treat as selection
        this.selectedCells.clear();
        this.selectedCells.add(`${r}:${c}`);
        this.refreshHighlights();
    }

    downloadCSV() {
        if (this.activeTableIndex === -1) return;
        const table = appState.tables[this.activeTableIndex];
        // Reuse global download logic if available, or simple generate
        let csv = table.headers.join(",") + "\n";
        csv += table.dataRows.map(r => r.join(",")).join("\n");

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${table.tableName}.csv`;
        a.click();
    }
}

// Global Instance
window.tableEditor = new TableEditor();

// Ensure app methods are available
if (!window.app) window.app = {};
if (!window.app.getPageNumbers) window.app.getPageNumbers = getPageNumbers;
if (!window.app.getTablesByPage) window.app.getTablesByPage = getTablesByPage;
