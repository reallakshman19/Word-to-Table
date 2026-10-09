/**
 * stray_text.js
 * 
 * Visualization for text not extracted into tables.
 * Helps users identify missed tables and provides a summary of extraction coverage.
 */

const StrayTextRenderer = {
    /**
     * Main entry point to render the Stray Text tab.
     * @param {Array} strayText - Array of {pageNumber, paragraphs: [{text, style, bold}]}
     * @param {Array} tables - Array of table objects (for summary calculation)
     * @param {string} containerId - DOM ID of the container
     */
    render: function (strayText, tables, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Store data globally for modal access
        this._currentData = strayText;

        if (!strayText || strayText.length === 0) {
            this._renderEmpty(container);
            return;
        }

        let html = '<div class="stray-text-container">';

        // 1. Render Summary Dashboard (Clickable Rows)
        html += this._renderSummary(strayText, tables);

        // 2. Modal Overlay (Hidden by default)
        html += `
            <div id="stray-modal-overlay" class="modal-overlay" onclick="StrayTextRenderer.closeModal(event)">
                <div class="modal-content" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h3 id="stray-modal-title">Page Details</h3>
                        <button class="close-modal-btn" onclick="StrayTextRenderer.closeModal()">×</button>
                    </div>
                    <div id="stray-modal-body" class="modal-body">
                        <!-- Content Injected Here -->
                    </div>
                </div>
            </div>
        `;

        html += '</div>';
        container.innerHTML = html;
    },

    showDetails: function (pageIndex) {
        const pageData = this._currentData.find(p => p.pageNumber == pageIndex);
        if (!pageData) return;

        const modalOverlay = document.getElementById('stray-modal-overlay');
        const modalTitle = document.getElementById('stray-modal-title');
        const modalBody = document.getElementById('stray-modal-body');

        if (modalOverlay && modalTitle && modalBody) {
            modalTitle.innerText = `Stray Text - Page ${pageIndex}`;
            modalBody.innerHTML = this._renderPageContent(pageData);
            modalOverlay.classList.add('active');
        }
    },

    closeModal: function (event) {
        // If event is provided, make sure we only close if clicking overlay or close button
        const modalOverlay = document.getElementById('stray-modal-overlay');
        if (modalOverlay) {
            modalOverlay.classList.remove('active');
        }
    },

    _renderEmpty: function (container) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">📝</div>
                <h3>No Stray Text Found</h3>
                <p>All text in the document was either extracted as tables or ignored (headers/footers).</p>
            </div>
        `;
    },

    _renderSummary: function (strayText, tables) {
        // Calculate counts per page
        const pageStats = {};

        // 1. Stray Counts
        strayText.forEach(p => {
            const charCount = p.paragraphs.reduce((sum, para) => sum + (para.text ? para.text.length : 0), 0);
            if (!pageStats[p.pageNumber]) pageStats[p.pageNumber] = { stray: 0, table: 0 };
            pageStats[p.pageNumber].stray += charCount;
        });

        // 2. Table Counts
        if (tables) {
            tables.forEach(t => {
                const charCount = t.dataRows.reduce((rSum, row) =>
                    rSum + row.reduce((cSum, cell) => cSum + (cell ? cell.toString().length : 0), 0)
                    , 0);
                const headerCount = t.headers.reduce((sum, h) => sum + (h ? h.toString().length : 0), 0);

                if (!pageStats[t.pageNumber]) pageStats[t.pageNumber] = { stray: 0, table: 0 };
                // Use page_number from metadata if available, otherwise t.pageNumber
                const pNum = t.metadata?.page_number || t.pageNumber;
                // Note: Previous loop used t.pageNumber. Just keeping consistency.
                pageStats[pNum] = pageStats[pNum] || { stray: 0, table: 0 };
                // Refetch because pNum might be different if I changed logic? 
                // Actually stick to what worked: t.pageNumber (if the extractor provides it) 
                if (!pageStats[t.pageNumber]) pageStats[t.pageNumber] = { stray: 0, table: 0 };
                pageStats[t.pageNumber].table += (charCount + headerCount);
            });
        }

        let html = `
            <div class="stray-summary">
                <div class="summary-header">
                    <h3>Extraction Summary</h3>
                    <p class="desc-small">Click a row to view stray text details for that page.</p>
                </div>
                <table class="summary-table interactive">
                    <thead>
                        <tr>
                            <th>Page</th>
                            <th>Table Content</th>
                            <th>Stray Text (Body)</th>
                            <th>Total Body Text</th>
                            <th>Table %</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        Object.keys(pageStats).sort((a, b) => Number(a) - Number(b)).forEach(pageNum => {
            const stats = pageStats[pageNum];
            const total = stats.table + stats.stray;
            const percent = total > 0 ? Math.round((stats.table / total) * 100) : 0;
            const rowClass = percent < 10 && total > 500 ? 'warn-row' : '';

            html += `
                <tr class="${rowClass}" onclick="StrayTextRenderer.showDetails(${pageNum})">
                    <td>Page ${pageNum}</td>
                    <td>${stats.table.toLocaleString()}</td>
                    <td>${stats.stray.toLocaleString()}</td>
                    <td>${total.toLocaleString()}</td>
                    <td>
                        <div class="percent-bar-container">
                            <div class="percent-bar" style="width: ${percent}%"></div>
                            <span>${percent}%</span>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        return html;
    },

    _renderPageContent: function (page) {
        let html = `<div class="stray-content-modal">`;
        page.paragraphs.forEach(para => {
            html += this._renderParagraph(para);
        });
        html += `</div>`;
        return html;
    },

    _renderParagraph: function (para) {
        if (!para || !para.text) return '';

        let text = this._escapeHTML(para.text);
        text = this._highlightKeywords(text);

        const classes = ['stray-para'];
        if (para.style && para.style.toLowerCase().includes('heading')) classes.push('heading');
        if (para.bold) classes.push('bold');

        return `<div class="${classes.join(' ')}">${text}</div>`;
    },

    _highlightKeywords: function (text) {
        return text.replace(/(Table\s+\d+|Figure\s+\d+|Exhibit\s+\d+|Schedule\s+\d+)/gi,
            '<span class="keyword-highlight">$1</span>');
    },

    _escapeHTML: function (str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
};

// Expose globally
window.StrayTextRenderer = StrayTextRenderer;
