/**
 * batch-exporter.js — Consolidated Before/After HTML Export for Doc2Table D2T-S1.2 Batch B1
 *
 * Generates self-contained before/after HTML files for side-by-side comparison.
 * - <docname>_before.html: Raw physical tables as parsed (row/col spans preserved).
 * - <docname>_after.html:  Refined tables after Auto + Refine (single <thead>, Group column, source row numbers).
 * - <docname>_compare.html: Side-by-side two-column before|after comparison (optional bonus).
 *
 * Requirements:
 * - Shared layout: same order, same anchor id="t<physicalIndex>", same heading "#<physicalIndex> · <rows> x <cols>".
 * - Contents list at top linking to each table anchor.
 * - After file adds: Auto rule, Refine rule ("Title row", "Merge two header rows", "Label", "Nothing to refine"), OK/FAILED status.
 * - Self-contained: inline CSS, no external scripts or links.
 * - Typography: white-space: normal, word-break: normal, overflow-wrap: normal, hyphens: none (never breaks mid-word or number).
 */

(function () {
  'use strict';

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const SHARED_CSS = `
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #0f141c;
      color: #e1e7ec;
      margin: 0;
      padding: 24px 32px;
      line-height: 1.5;
    }
    header {
      margin-bottom: 24px;
      border-bottom: 1px solid #28344a;
      padding-bottom: 16px;
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 1.45rem;
      color: #7aa2f7;
      letter-spacing: -0.3px;
    }
    .doc-meta {
      font-size: 0.85rem;
      color: #7982a9;
    }
    .toc-container {
      background: #161c28;
      border: 1px solid #28344a;
      border-radius: 6px;
      padding: 14px 18px;
      margin-bottom: 30px;
    }
    .toc-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: #a9b1d6;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    .toc-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      max-height: 180px;
      overflow-y: auto;
    }
    .toc-link {
      color: #7aa2f7;
      text-decoration: none;
      font-size: 0.8rem;
      font-family: monospace;
      padding: 2px 6px;
      border-radius: 3px;
      background: rgba(122, 162, 247, 0.08);
      transition: background 0.15s, color 0.15s;
    }
    .toc-link:hover {
      background: rgba(122, 162, 247, 0.2);
      color: #ffffff;
      text-decoration: none;
    }
    .table-section {
      background: #161c28;
      border: 1px solid #28344a;
      border-radius: 6px;
      padding: 18px 20px;
      margin-bottom: 32px;
      scroll-margin-top: 20px;
    }
    .table-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      border-bottom: 1px solid #28344a;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .table-header h3 {
      margin: 0;
      font-size: 1.15rem;
      color: #bb9af7;
      font-family: monospace;
    }
    .table-meta-badges {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-ok { background: rgba(158, 206, 106, 0.15); color: #9ece6a; border: 1px solid rgba(158, 206, 106, 0.3); }
    .badge-failed { background: rgba(247, 118, 142, 0.2); color: #f7768e; border: 1px solid rgba(247, 118, 142, 0.4); }
    .badge-auto { background: rgba(122, 162, 247, 0.15); color: #7aa2f7; border: 1px solid rgba(122, 162, 247, 0.3); }
    .badge-refine { background: rgba(224, 175, 104, 0.15); color: #e0af68; border: 1px solid rgba(224, 175, 104, 0.3); }
    .badge-info { background: rgba(121, 130, 169, 0.15); color: #a9b1d6; }
    .table-scroll {
      overflow-x: auto;
      max-width: 100%;
    }
    table.data-table {
      border-collapse: collapse;
      font-size: 0.8rem;
      width: max-content;
      min-width: 100%;
    }
    table.data-table th, table.data-table td {
      border: 1px solid #28344a;
      padding: 6px 10px;
      text-align: left;
      white-space: normal;
      word-break: normal;
      overflow-wrap: normal;
      hyphens: none;
      vertical-align: top;
    }
    table.data-table th {
      background: #1f2738;
      color: #ffffff;
      font-weight: 600;
    }
    table.data-table td.row-idx, table.data-table th.row-idx {
      width: 40px;
      min-width: 40px;
      text-align: right;
      color: #7982a9;
      font-family: monospace;
      font-size: 0.75rem;
      background: #121722;
      user-select: none;
    }
    table.data-table .group-cell {
      color: #7aa2f7;
      font-weight: 600;
      background: rgba(122, 162, 247, 0.05);
    }
    table.data-table .spanned-cell {
      color: #7982a9;
      font-style: italic;
      background: rgba(224, 175, 104, 0.04);
    }
    .error-notice {
      background: rgba(247, 118, 142, 0.1);
      border: 1px solid rgba(247, 118, 142, 0.3);
      color: #f7768e;
      padding: 10px 14px;
      border-radius: 4px;
      margin-bottom: 12px;
      font-size: 0.85rem;
    }
    .title-path-box {
      background: #161c28;
      border: 1px solid #28344a;
      border-radius: 4px;
      padding: 6px 12px;
      margin-bottom: 10px;
      font-size: 0.82rem;
      color: #7aa2f7;
    }
    .title-path-link {
      color: #e1e7ec;
      text-decoration: underline;
      text-decoration-style: dotted;
    }
    .title-path-link:hover {
      color: #7aa2f7;
      text-decoration: underline;
    }
    .badge-inherited {
      font-size: 0.7rem;
      padding: 1px 5px;
      border-radius: 3px;
      background: rgba(224, 175, 104, 0.15);
      color: #e0af68;
      font-style: italic;
      margin-left: 4px;
    }
    .badge-recovered {
      background: rgba(42, 195, 222, 0.2);
      border: 1px solid rgba(42, 195, 222, 0.4);
      color: #2ac3de;
    }
  `;

  function formatTitlePathHtml(titlePath, inherited) {
    if (!titlePath || !Array.isArray(titlePath) || titlePath.length === 0) return '';
    const links = titlePath.map(line =>
      `<a class="title-path-link" href="#t${line.tableIndex}">#${line.tableIndex} row 0: ${escapeHtml(line.text)}</a>`
    ).join(' &gt; ');
    const inhTag = inherited ? ' <span class="badge-inherited">(inherited)</span>' : '';
    return `  <div class="title-path-box"><strong>Title:</strong> ${links}${inhTag}</div>\n`;
  }

  class BatchExporter {
    /**
     * Generate HTML for all tables before batch processing (File 1: <docname>_before.html)
     * Every table in the filter exactly as parsed, with row/col spans preserved.
     */
    static generateBeforeHtml(tables, docName = 'document') {
      const title = `${escapeHtml(docName)} — Before Batch (Raw Tables)`;
      let html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n`;
      html += `<title>${title}</title>\n`;
      html += `<style>${SHARED_CSS}</style>\n</head>\n<body>\n`;
      html += `<header>\n  <h1>${title}</h1>\n`;
      html += `  <div class="doc-meta">Document: <strong>${escapeHtml(docName)}</strong> · Filter: <strong>Only Tables with data</strong> (${tables.length} tables) · State: Unrefined physical grid</div>\n`;
      html += `</header>\n`;

      // Table of Contents
      html += `<div class="toc-container">\n  <div class="toc-title">Table of Contents (${tables.length} tables in document order)</div>\n  <div class="toc-grid">\n`;
      for (const t of tables) {
        html += `    <a class="toc-link" href="#t${t.physicalIndex}">#${t.physicalIndex} (${t.rowCount}×${t.colCount})</a>\n`;
      }
      html += `  </div>\n</div>\n`;

      // Tables
      for (const t of tables) {
        html += `<section class="table-section" id="t${t.physicalIndex}">\n`;
        html += `  <div class="table-header">\n`;
        html += `    <h3>#${t.physicalIndex} · ${t.rowCount} x ${t.colCount}</h3>\n`;
        html += `    <div class="table-meta-badges">\n`;
        if (t.isNested) {
          html += `      <span class="badge badge-info">Nested in #${t.parentTableIndex}</span>\n`;
        } else {
          html += `      <span class="badge badge-info">Body Table ${t.bodyIndex || ''}</span>\n`;
        }
        if (t.hasSpans) {
          html += `      <span class="badge badge-refine">Spans Present</span>\n`;
        }
        html += `    </div>\n  </div>\n`;

        html += formatTitlePathHtml(t.titlePath, t.titleInherited);

        html += `  <div class="table-scroll">\n    <table class="data-table"><tbody>\n`;
        for (let r = 0; r < t.rowCount; r++) {
          html += `      <tr><td class="row-idx">${r}</td>`;
          const row = t.grid[r];
          if (row) {
            for (let c = 0; c < row.length; c++) {
              const cell = row[c];
              if (!cell) {
                html += `<td></td>`;
                continue;
              }
              if (cell.spanned) {
                // Covered by a previous cell's span
                continue;
              }
              const attrs = [];
              if (cell.gridSpan && cell.gridSpan > 1) {
                attrs.push(`colspan="${cell.gridSpan}"`);
              }
              if (cell.vMerge === 'restart' && cell.rowSpan && cell.rowSpan > 1) {
                attrs.push(`rowspan="${cell.rowSpan}"`);
              }
              const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
              html += `<td${attrStr}>${escapeHtml(cell.text || '')}</td>`;
            }
          }
          html += `</tr>\n`;
        }
        html += `    </tbody></table>\n  </div>\n</section>\n`;
      }

      html += `</body>\n</html>\n`;
      return html;
    }

    /**
     * Generate HTML for all tables after batch processing (File 2: <docname>_after.html)
     * Every table in the filter after Auto + Refine: one header row as <thead>, Group column, source row numbers.
     */
    static generateAfterHtml(batchResults, docName = 'document') {
      const title = `${escapeHtml(docName)} — After Batch (Refined Tables)`;
      const okCount = batchResults.filter(r => r.status === 'OK').length;
      const failedCount = batchResults.filter(r => r.status === 'FAILED').length;

      let html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n`;
      html += `<title>${title}</title>\n`;
      html += `<style>${SHARED_CSS}</style>\n</head>\n<body>\n`;
      html += `<header>\n  <h1>${title}</h1>\n`;
      html += `  <div class="doc-meta">Document: <strong>${escapeHtml(docName)}</strong> · Filter: <strong>Only Tables with data</strong> (${batchResults.length} tables) · Result: <strong style="color:#9ece6a">${okCount} OK</strong>, <strong style="color:${failedCount > 0 ? '#f7768e' : '#7982a9'}">${failedCount} FAILED</strong></div>\n`;
      html += `</header>\n`;

      // Table of Contents
      html += `<div class="toc-container">\n  <div class="toc-title">Table of Contents (${batchResults.length} tables in document order)</div>\n  <div class="toc-grid">\n`;
      for (const res of batchResults) {
        const t = res.table;
        const statusClass = res.status === 'OK' ? '' : ' style="color:#f7768e"';
        html += `    <a class="toc-link" href="#t${t.physicalIndex}"${statusClass}>#${t.physicalIndex} (${t.rowCount}×${t.colCount}) [${res.status}]</a>\n`;
      }
      html += `  </div>\n</div>\n`;

      // Tables
      for (const res of batchResults) {
        const t = res.table;
        const refined = res.refined;

        html += `<section class="table-section" id="t${t.physicalIndex}">\n`;
        html += `  <div class="table-header">\n`;
        html += `    <h3>#${t.physicalIndex} · ${t.rowCount} x ${t.colCount}</h3>\n`;
        html += `    <div class="table-meta-badges">\n`;
        if (res.status === 'OK') {
          html += `      <span class="badge badge-ok">OK</span>\n`;
        } else {
          html += `      <span class="badge badge-failed">FAILED</span>\n`;
        }
        if (res.autoRule) {
          html += `      <span class="badge badge-auto">Auto: ${escapeHtml(res.autoRule)}</span>\n`;
        }
        if (res.refineRule) {
          html += `      <span class="badge badge-refine">Refine: ${escapeHtml(res.refineRule)}</span>\n`;
        }
        if (res.recovered && res.recovered.success) {
          html += `      <span class="badge badge-recovered">Recovered: #${res.recovered.sourcePhysicalIndex} (${escapeHtml(res.recovered.signals.join(', '))})</span>\n`;
        }
        html += `    </div>\n  </div>\n`;

        html += formatTitlePathHtml(t.titlePath, t.titleInherited);

        if (res.status === 'FAILED') {
          html += `  <div class="error-notice"><strong>Processing Error:</strong> ${escapeHtml(res.error || 'Unknown error')}</div>\n`;
        }

        const rec = res.recovered && res.recovered.success ? res.recovered : null;
        if (rec) {
          html += `  <div class="table-scroll">\n    <table class="data-table">\n`;
          html += `      <thead>\n        <tr><th class="row-idx" title="Recovered header from #${rec.sourcePhysicalIndex} row 0">H</th>`;
          for (let c = 0; c < rec.headers.length; c++) {
            html += `<th title="Recovered from #${rec.sourcePhysicalIndex} row 0 cell ${c} (signals: ${escapeHtml(rec.signals.join(', '))})">${escapeHtml(rec.headers[c])}</th>`;
          }
          html += `</tr>\n      </thead>\n`;
          html += `      <tbody>\n`;
          for (let r = 0; r < t.rowCount; r++) {
            const row = t.grid[r];
            html += `        <tr><td class="row-idx" title="Source row ${r}">${r}</td>`;
            if (row) {
              for (let c = 0; c < t.colCount; c++) {
                const cell = row[c];
                let text = '';
                if (cell && cell.spanned) {
                  text = '';
                } else if (cell) {
                  text = cell.text || '';
                }
                html += `<td>${escapeHtml(text)}</td>`;
              }
            }
            html += `</tr>\n`;
          }
          html += `      </tbody>\n    </table>\n  </div>\n`;
        } else if (refined && refined.headers) {
          const hasGroup = Boolean(refined.groupColumn);
          const excludeRows = refined.excludeRows || [];

          html += `  <div class="table-scroll">\n    <table class="data-table">\n`;
          // Exactly one header row in <thead>
          html += `      <thead>\n        <tr><th class="row-idx">H</th>`;
          for (let c = 0; c < refined.headers.length; c++) {
            html += `<th>${escapeHtml(refined.headers[c])}</th>`;
          }
          html += `</tr>\n      </thead>\n`;

          // Data rows with source row numbers in <tbody>
          html += `      <tbody>\n`;
          for (let r = refined.dataStartRow; r < t.grid.length; r++) {
            if (excludeRows.includes(r)) continue;
            const row = t.grid[r];
            html += `        <tr><td class="row-idx" title="Source row ${r}">${r}</td>`;
            if (hasGroup) {
              html += `<td class="group-cell">${escapeHtml(refined.groupColumn)}</td>`;
            }
            if (row) {
              for (let c = 0; c < t.colCount; c++) {
                const cell = row[c];
                let text = '';
                if (cell && cell.spanned) {
                  text = '';
                } else if (cell) {
                  text = cell.text || '';
                }
                html += `<td>${escapeHtml(text)}</td>`;
              }
            }
            html += `</tr>\n`;
          }
          html += `      </tbody>\n    </table>\n  </div>\n`;
        }

        html += `</section>\n`;
      }

      html += `</body>\n</html>\n`;
      return html;
    }

    /**
     * Generate optional side-by-side comparison HTML (File 3: <docname>_compare.html)
     * Two columns per table: Left = Before (Raw), Right = After (Refined).
     */
    static generateCompareHtml(tables, batchResults, docName = 'document') {
      const title = `${escapeHtml(docName)} — Before vs After Comparison`;
      let html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n`;
      html += `<title>${title}</title>\n`;
      html += `<style>
        ${SHARED_CSS}
        .compare-row {
          display: flex;
          gap: 20px;
          margin-top: 12px;
        }
        .compare-col {
          flex: 1;
          min-width: 0;
          background: #121722;
          border: 1px solid #28344a;
          border-radius: 4px;
          padding: 12px;
        }
        .compare-col-title {
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          color: #7982a9;
          margin-bottom: 8px;
          border-bottom: 1px solid #28344a;
          padding-bottom: 4px;
        }
      </style>\n</head>\n<body>\n`;

      html += `<header>\n  <h1>${title}</h1>\n`;
      html += `  <div class="doc-meta">Side-by-side comparison of ${batchResults.length} tables in "Only Tables with data"</div>\n</header>\n`;

      // TOC
      html += `<div class="toc-container">\n  <div class="toc-title">Table of Contents (${batchResults.length} tables)</div>\n  <div class="toc-grid">\n`;
      for (const res of batchResults) {
        html += `    <a class="toc-link" href="#t${res.table.physicalIndex}">#${res.table.physicalIndex}</a>\n`;
      }
      html += `  </div>\n</div>\n`;

      for (let i = 0; i < batchResults.length; i++) {
        const res = batchResults[i];
        const t = res.table;
        const refined = res.refined;

        html += `<section class="table-section" id="t${t.physicalIndex}">\n`;
        html += `  <div class="table-header">\n`;
        html += `    <h3>#${t.physicalIndex} · ${t.rowCount} x ${t.colCount}</h3>\n`;
        html += `    <div class="table-meta-badges">\n`;
        html += `      <span class="badge ${res.status === 'OK' ? 'badge-ok' : 'badge-failed'}">${res.status}</span>\n`;
        if (res.autoRule) html += `      <span class="badge badge-auto">${escapeHtml(res.autoRule)}</span>\n`;
        if (res.refineRule) html += `      <span class="badge badge-refine">${escapeHtml(res.refineRule)}</span>\n`;
        if (res.recovered && res.recovered.success) {
          html += `      <span class="badge badge-recovered">Recovered: #${res.recovered.sourcePhysicalIndex}</span>\n`;
        }
        html += `    </div>\n  </div>\n`;

        html += formatTitlePathHtml(t.titlePath, t.titleInherited);

        html += `  <div class="compare-row">\n`;

        // Left Col: Before
        html += `    <div class="compare-col">\n`;
        html += `      <div class="compare-col-title">Before (Raw Table)</div>\n`;
        html += `      <div class="table-scroll"><table class="data-table"><tbody>\n`;
        for (let r = 0; r < t.rowCount; r++) {
          html += `        <tr><td class="row-idx">${r}</td>`;
          const row = t.grid[r];
          if (row) {
            for (let c = 0; c < row.length; c++) {
              const cell = row[c];
              if (!cell || cell.spanned) continue;
              const attrs = [];
              if (cell.gridSpan && cell.gridSpan > 1) attrs.push(`colspan="${cell.gridSpan}"`);
              if (cell.vMerge === 'restart' && cell.rowSpan && cell.rowSpan > 1) attrs.push(`rowspan="${cell.rowSpan}"`);
              html += `<td${attrs.length ? ' ' + attrs.join(' ') : ''}>${escapeHtml(cell.text || '')}</td>`;
            }
          }
          html += `</tr>\n`;
        }
        html += `      </tbody></table></div>\n`;
        html += `    </div>\n`;

        // Right Col: After
        html += `    <div class="compare-col">\n`;
        html += `      <div class="compare-col-title">After (Auto + Refined)</div>\n`;
        const rec = res.recovered && res.recovered.success ? res.recovered : null;
        if (rec) {
          html += `      <div class="table-scroll"><table class="data-table"><thead><tr><th class="row-idx" title="Recovered header from #${rec.sourcePhysicalIndex} row 0">H</th>`;
          for (let c = 0; c < rec.headers.length; c++) {
            html += `<th title="Recovered from #${rec.sourcePhysicalIndex} row 0 cell ${c} (signals: ${escapeHtml(rec.signals.join(', '))})">${escapeHtml(rec.headers[c])}</th>`;
          }
          html += `</tr></thead><tbody>\n`;
          for (let r = 0; r < t.rowCount; r++) {
            const row = t.grid[r];
            html += `        <tr><td class="row-idx">${r}</td>`;
            if (row) {
              for (let c = 0; c < t.colCount; c++) {
                const cell = row[c];
                html += `<td>${escapeHtml((cell && !cell.spanned) ? cell.text : '')}</td>`;
              }
            }
            html += `</tr>\n`;
          }
          html += `      </tbody></table></div>\n`;
        } else if (refined && refined.headers) {
          const hasGroup = Boolean(refined.groupColumn);
          const excludeRows = refined.excludeRows || [];
          html += `      <div class="table-scroll"><table class="data-table"><thead><tr><th class="row-idx">H</th>`;
          for (let c = 0; c < refined.headers.length; c++) {
            html += `<th>${escapeHtml(refined.headers[c])}</th>`;
          }
          html += `</tr></thead><tbody>\n`;
          for (let r = refined.dataStartRow; r < t.grid.length; r++) {
            if (excludeRows.includes(r)) continue;
            const row = t.grid[r];
            html += `        <tr><td class="row-idx">${r}</td>`;
            if (hasGroup) html += `<td class="group-cell">${escapeHtml(refined.groupColumn)}</td>`;
            if (row) {
              for (let c = 0; c < t.colCount; c++) {
                const cell = row[c];
                html += `<td>${escapeHtml((cell && !cell.spanned) ? cell.text : '')}</td>`;
              }
            }
            html += `</tr>\n`;
          }
          html += `      </tbody></table></div>\n`;
        } else {
          html += `      <div class="error-notice">${escapeHtml(res.error || 'No refined output')}</div>\n`;
        }
        html += `    </div>\n`;

        html += `  </div>\n</section>\n`;
      }

      html += `</body>\n</html>\n`;
      return html;
    }

    /**
     * Browser helper to trigger file download.
     */
    static downloadHtmlFile(filename, htmlContent) {
      if (typeof Blob === 'undefined' || typeof document === 'undefined') return;
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }
  }

  // Export
  if (typeof window !== 'undefined') {
    window.BatchExporter = BatchExporter;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BatchExporter;
  }
})();
