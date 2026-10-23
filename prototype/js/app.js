/**
 * app.js — Doc2Table Prototype Application Controller
 *
 * Orchestrates file loading, table parsing, navigation, grid/source/CSV
 * display, header row selection, and CSV download with provenance.
 *
 * Depends on: DocxTableParser, CsvExporter (both on window)
 */

(function () {
  'use strict';

  // ─── State ───
  let parseResult = null;   // DocxTableParser result
  let fileHash = null;      // SHA-256 hex
  let fileName = null;
  let selectedTableIdx = -1; // index into parseResult.tables

  // ─── DOM refs ───
  const $ = id => document.getElementById(id);

  const fileInput = $('fileInput');
  const fileInfo = $('fileInfo');
  const navList = $('navList');
  const navCount = $('navCount');
  const tableControls = $('tableControls');
  const contentTabs = $('contentTabs');
  const gridPanel = $('gridPanel');
  const sourcePanel = $('sourcePanel');
  const csvPanel = $('csvPanel');
  const provenancePanel = $('provenancePanel');
  const dropZone = $('dropZone');
  const loadingOverlay = $('loadingOverlay');
  const statusMsg = $('statusMsg');
  const tableTitle = $('tableTitle');
  const headerRowsSelect = $('headerRows');
  const dataStartInput = $('dataStart');

  // ─── File Input / Drop ───

  fileInput.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  // Also allow drop on the whole page
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  // ─── Header row / data start change ───
  headerRowsSelect.addEventListener('change', () => {
    // Auto-adjust data start to match header rows if user hasn't manually changed it
    const hr = parseInt(headerRowsSelect.value);
    if (parseInt(dataStartInput.value) < hr) {
      dataStartInput.value = hr;
    }
    if (selectedTableIdx >= 0) renderSelectedTable();
  });

  dataStartInput.addEventListener('change', () => {
    if (selectedTableIdx >= 0) renderSelectedTable();
  });

  // ─── File Processing ───

  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setStatus('Error: please select a .docx file', true);
      return;
    }

    fileName = file.name;
    setStatus('Reading file…');
    loadingOverlay.classList.remove('hidden');

    try {
      const buffer = await file.arrayBuffer();

      // Compute SHA-256
      const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
      fileHash = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      fileInfo.innerHTML = `<strong>${esc(fileName)}</strong> ` +
        `(${(file.size / 1024).toFixed(1)} KB) ` +
        `<span class="hash">sha256:${fileHash.substring(0, 12)}…</span>`;

      setStatus('Parsing tables…');

      // Parse
      const parser = new window.DocxTableParser();
      parseResult = await parser.parse(buffer, fileHash);

      // Render
      renderNavigator();
      updateStats();

      if (parseResult.tables.length > 0) {
        selectTable(0);
      } else {
        showNoTablesState();
      }

      setStatus(`Done — ${parseResult.totalCount} tables found`);
    } catch (err) {
      console.error(err);
      setStatus('Error: ' + err.message, true);
    } finally {
      loadingOverlay.classList.add('hidden');
    }
  }

  // ─── Navigator ───

  function renderNavigator() {
    if (!parseResult) return;
    const tables = parseResult.tables;

    navCount.textContent = `(${tables.length})`;

    if (tables.length === 0) {
      navList.innerHTML = '<div class="empty-state" style="min-height:200px">' +
        '<p>No native tables found</p></div>';
      return;
    }

    let html = '';
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      const isNested = t.isNested;
      const cls = isNested ? 'nav-item nested' : 'nav-item';

      let badges = '';
      if (isNested) badges += '<span class="badge-sm badge-nested">nested</span>';
      if (t.hasSpans) badges += '<span class="badge-sm badge-spans">spans</span>';

      const title = isNested
        ? `↳ Nested in Table ${t.parentTableIndex}`
        : `Table ${t.bodyIndex}`;

      html += `<div class="${cls}" data-idx="${i}" onclick="app.selectTable(${i})">
        <div class="nav-title">${esc(title)}</div>
        <div class="nav-meta">${t.rowCount} rows × ${t.colCount} cols · Physical #${t.physicalIndex}</div>
        ${badges ? '<div class="nav-badges">' + badges + '</div>' : ''}
      </div>`;
    }

    navList.innerHTML = html;
  }

  function selectTable(idx) {
    if (!parseResult || idx < 0 || idx >= parseResult.tables.length) return;
    selectedTableIdx = idx;

    // Update nav highlight
    navList.querySelectorAll('.nav-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });

    // Show controls
    tableControls.style.display = '';
    contentTabs.style.display = '';

    const t = parseResult.tables[idx];
    const label = t.isNested
      ? `Nested table (physical #${t.physicalIndex}) inside Table ${t.parentTableIndex}`
      : `Table ${t.bodyIndex} (physical #${t.physicalIndex})`;
    tableTitle.textContent = label + ` — ${t.rowCount}×${t.colCount}`;

    // Set data start max
    dataStartInput.max = t.rowCount;

    renderSelectedTable();
  }

  function renderSelectedTable() {
    const t = parseResult.tables[selectedTableIdx];
    const headerRows = parseInt(headerRowsSelect.value);
    const dataStart = Math.max(parseInt(dataStartInput.value) || 0, 0);

    renderGrid(t, headerRows, dataStart);
    renderSource(t);
    renderCsvPreview(t, headerRows, dataStart);
    renderProvenance(t, headerRows, dataStart);
  }

  // ─── Grid Rendering ───

  function renderGrid(table, headerRows, dataStart) {
    const grid = table.grid;
    if (!grid || grid.length === 0) {
      gridPanel.innerHTML = '<div class="notice notice-info">This table has no rows.</div>';
      return;
    }

    let html = '<div class="grid-container"><table class="data-grid">';

    // Render all rows, visually marking header rows
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      const isHeader = r < headerRows;
      const isBeforeData = r < dataStart && !isHeader;

      if (r === 0) html += '<tbody>';

      const rowCls = isHeader ? 'header-row' : '';
      html += `<tr class="${rowCls}">`;
      html += `<td class="row-idx">${r}</td>`;

      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        let cls = '';
        let content = '';

        if (cell.spanned) {
          cls = 'spanned-cell';
          content = '⬅ span';
        } else if (cell.hasImage) {
          cls = 'image-cell';
          content = '🖼 [image]';
        } else if (cell.hasNestedTable) {
          cls = 'nested-cell';
          content = `📋 [nested table ${cell.nestedTableIndex || ''}]`;
        } else {
          content = esc(cell.text);
        }

        const tag = isHeader ? 'th' : 'td';
        html += `<${tag} class="${cls}" title="Row ${cell.provenance?.rowIndex}, Cell ${cell.provenance?.cellIndex}">${content}</${tag}>`;
      }

      html += '</tr>';
    }

    html += '</tbody></table></div>';

    // Header/data indicators
    let indicators = '';
    if (headerRows > 0) {
      indicators += `<div class="notice notice-info">Header rows: 0–${headerRows - 1}. `;
      indicators += `Data starts at row ${dataStart}.</div>`;
    } else {
      indicators += '<div class="notice notice-info">No header rows selected. All rows treated as data.</div>';
    }

    gridPanel.innerHTML = indicators + html;
  }

  // ─── Source XML Rendering ───

  function renderSource(table) {
    const xml = table.sourceXml || '(source not available)';
    // Basic syntax highlighting
    const highlighted = esc(xml)
      .replace(/(&lt;\/?)([\w:]+)/g, '$1<span class="tag">$2</span>')
      .replace(/([\w:]+)(=)/g, '<span class="attr">$1</span>$2')
      .replace(/"([^"]*)"/g, '"<span class="val">$1</span>"');

    sourcePanel.innerHTML = `<div class="source-view">${highlighted}</div>`;
  }

  // ─── CSV Preview ───

  function renderCsvPreview(table, headerRows, dataStart) {
    const exporter = new window.CsvExporter();
    const { csv } = exporter.exportTable(table, headerRows, dataStart);

    const notice = '<div class="notice notice-warn">' +
      '⚠ Spreadsheet programs may reinterpret leading-zero strings (e.g. "031" → 31). ' +
      'To preserve them, import the CSV as text: in Excel, use Data → From Text/CSV and set all columns to "Text".' +
      '</div>';

    csvPanel.innerHTML = notice + `<pre class="csv-preview">${esc(csv)}</pre>`;
  }

  // ─── Provenance ───

  function renderProvenance(table, headerRows, dataStart) {
    const exporter = new window.CsvExporter();
    const { provenance } = exporter.exportTable(table, headerRows, dataStart);

    let html = '<div class="notice notice-info">Every CSV cell has a provenance record ' +
      'linking it to the original file hash, XML part, table, row, and cell index.</div>';

    html += '<div style="overflow:auto; max-height:calc(100vh - 300px)">';
    html += '<table class="provenance-table"><thead><tr>' +
      '<th>CSV Row</th><th>CSV Col</th><th>Header</th><th>Raw Text</th>' +
      '<th>Is Header</th><th>Source Table</th><th>Source Row</th><th>Source Cell</th>' +
      '<th>File Hash</th><th>Part</th>' +
      '</tr></thead><tbody>';

    for (const p of provenance) {
      html += '<tr>' +
        `<td>${p.csvRow}</td>` +
        `<td>${p.csvCol}</td>` +
        `<td>${esc(p.headerLabel)}</td>` +
        `<td class="mono">${esc(truncate(p.rawText, 60))}</td>` +
        `<td>${p.isHeader ? '✓' : ''}</td>` +
        `<td>${p.sourceTableIndex}</td>` +
        `<td>${p.sourceRowIndex}</td>` +
        `<td>${p.sourceCellIndex}</td>` +
        `<td class="mono">${p.sourceFileHash ? p.sourceFileHash.substring(0, 12) + '…' : '—'}</td>` +
        `<td>${esc(p.sourcePart)}</td>` +
        '</tr>';
    }

    html += '</tbody></table></div>';
    provenancePanel.innerHTML = html;
  }

  // ─── No Tables State ───

  function showNoTablesState() {
    tableControls.style.display = 'none';
    contentTabs.style.display = 'none';

    // Check if document has images (screenshot-only doc)
    if (parseResult && parseResult.imageCount > 0) {
      gridPanel.innerHTML = `<div class="image-doc-notice">
        <h3>⚠ No native tables found</h3>
        <p>This document contains <span class="image-count">${parseResult.imageCount} image(s)</span> 
        but zero native Word tables.</p>
        <p style="margin-top:8px; color:var(--text-muted)">
          Images (screenshots of tables) cannot be converted to structured data without OCR, 
          which this prototype does not perform. The images are present but not extracted as tables.</p>
        <p style="margin-top:8px; color:var(--text-muted)">
          Status: <strong>not-converted</strong> — these are image evidence, not native table cells.</p>
      </div>`;
    } else {
      gridPanel.innerHTML = '<div class="empty-state"><div class="icon">📭</div>' +
        '<h3>No tables found</h3><p>This document contains no native Word tables.</p></div>';
    }
  }

  // ─── Tab Switching ───

  function switchTab(btn) {
    const panelId = btn.dataset.panel;
    contentTabs.querySelectorAll('.content-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    [gridPanel, sourcePanel, csvPanel, provenancePanel].forEach(p => {
      p.classList.toggle('hidden', p.id !== panelId);
    });
  }

  // ─── CSV Download ───

  function downloadSelectedCsv() {
    if (selectedTableIdx < 0 || !parseResult) return;
    const t = parseResult.tables[selectedTableIdx];
    const headerRows = parseInt(headerRowsSelect.value);
    const dataStart = Math.max(parseInt(dataStartInput.value) || 0, 0);
    const exporter = new window.CsvExporter();
    const { csv } = exporter.exportTable(t, headerRows, dataStart);

    const safeName = (fileName || 'table').replace(/\.docx$/i, '');
    const csvName = `${safeName}_table${t.physicalIndex}_h${headerRows}.csv`;
    exporter.downloadCsv(csv, csvName);
  }

  // ─── Stats ───

  function updateStats() {
    if (!parseResult) return;
    $('statTables').textContent = parseResult.totalCount;
    $('statBody').textContent = parseResult.bodyLevelCount;
    $('statNested').textContent = parseResult.nestedCount;
    $('statRows').textContent = parseResult.tables.reduce((s, t) => s + t.rowCount, 0);
  }

  // ─── Helpers ───

  function setStatus(msg, isError) {
    statusMsg.textContent = msg;
    statusMsg.style.color = isError ? 'var(--red)' : 'var(--yellow)';
  }

  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function truncate(str, max) {
    if (str == null) return '';
    str = String(str);
    return str.length > max ? str.substring(0, max) + '…' : str;
  }

  // ─── Public API ───

  window.app = {
    selectTable,
    switchTab,
    downloadSelectedCsv
  };

})();
