/**
 * app.js — Doc2Table Prototype Application Controller (D2T-S1.1 / WBS 4.1.1)
 *
 * Orchestrates:
 *   1. File loading & SHA-256 computation
 *   2. Dropdown table selector with stable physical IDs
 *   3. Filter: "List all" vs "Only Tables with data" (>=2 rows AND >=2 cols)
 *   4. Auto Header v3 on-click heuristic (Rules 1, 2, 3, 4)
 *   5. Reversible manual header/data-start editing
 *   6. Grid/source/CSV/provenance display with label folding (Rule 2)
 *   7. RFC 4180 CSV export with companion per-cell provenance
 *
 * Dependencies: DocxTableParser, AutoHeaderV3, CsvExporter (all on window)
 */

(function () {
  'use strict';

  // ─── State ───
  let parseResult = null;            // DocxTableParser result
  let fileHash = null;               // SHA-256 hex string
  let fileName = null;               // Original file name
  let selectedPhysicalIndex = -1;    // 1-based physical index of active table
  let filterMode = 'all';            // 'all' | 'data'
  let currentFoldedLabel = null;     // { text, labelRow, labelCol, targetRow, targetCol }
  let autoRuleFired = null;          // Last suggestion from AutoHeaderV3

  // ─── DOM refs ───
  const $ = id => document.getElementById(id);

  const fileInput = $('fileInput');
  const fileInfo = $('fileInfo');
  const navCount = $('navCount');
  const tableFilter = $('tableFilter');
  const tableSelect = $('tableSelect');
  const filterHint = $('filterHint');
  const tableInfoCard = $('tableInfoCard');
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
  const btnAutoHeader = $('btnAutoHeader');
  const autoRuleBadge = $('autoRuleBadge');
  const btnDownloadCsv = $('btnDownloadCsv');

  // ─── File Input / Drag & Drop ───

  fileInput.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  if (dropZone) {
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
  }

  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  // ─── Header row / data start change (Independent Manual Controls) ───

  headerRowsSelect.addEventListener('change', () => {
    const hr = parseInt(headerRowsSelect.value);
    if (parseInt(dataStartInput.value) < hr) {
      dataStartInput.value = hr;
    }
    // If user changed away from rule 2 header count, clear folded label
    if (currentFoldedLabel && hr !== 1) {
      currentFoldedLabel = null;
    }
    if (autoRuleFired) {
      autoRuleBadge.textContent = autoRuleFired.ruleName + ' (manually edited)';
    }
    if (selectedPhysicalIndex > 0) renderSelectedTable();
  });

  dataStartInput.addEventListener('change', () => {
    if (autoRuleFired) {
      autoRuleBadge.textContent = autoRuleFired.ruleName + ' (manually edited)';
    }
    if (selectedPhysicalIndex > 0) renderSelectedTable();
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

      // Parse using DocxTableParser
      const parser = new window.DocxTableParser();
      parseResult = await parser.parse(buffer, fileHash);

      // Reset state
      selectedPhysicalIndex = -1;
      currentFoldedLabel = null;
      autoRuleFired = null;
      autoRuleBadge.style.display = 'none';

      // Update Filter & Table Selector dropdowns
      populateTableDropdown();
      updateStats();

      // Automatically select first available table if present
      const filtered = getFilteredTables();
      if (filtered.length > 0) {
        selectTableByPhysicalIndex(filtered[0].physicalIndex);
      } else {
        if (parseResult.tables.length > 0) {
          // Switch to all if data filter is empty
          filterMode = 'all';
          tableFilter.value = 'all';
          populateTableDropdown();
          selectTableByPhysicalIndex(parseResult.tables[0].physicalIndex);
        } else {
          showNoTablesState();
        }
      }

      setStatus(`Done — ${parseResult.totalCount} physical tables found`);
    } catch (err) {
      console.error(err);
      setStatus('Error: ' + err.message, true);
    } finally {
      loadingOverlay.classList.add('hidden');
    }
  }

  // ─── Filter & Dropdown Selector ───

  /**
   * Filter predicate:
   * 'all'  -> all tables
   * 'data' -> rowCount >= 2 AND colCount >= 2 (no content test)
   */
  function getFilteredTables() {
    if (!parseResult || !parseResult.tables) return [];
    if (filterMode === 'data') {
      return parseResult.tables.filter(t => t.rowCount >= 2 && t.colCount >= 2);
    }
    return parseResult.tables;
  }

  function onFilterChange() {
    filterMode = tableFilter.value;
    populateTableDropdown();

    // Check if current selection survived filtering
    const filtered = getFilteredTables();
    const stillVisible = filtered.some(t => t.physicalIndex === selectedPhysicalIndex);

    if (stillVisible) {
      // Retain current selection
      tableSelect.value = String(selectedPhysicalIndex);
    } else {
      // Explicitly clear selection/exports and ask for a visible table
      clearSelection(
        `Selected table #${selectedPhysicalIndex} is hidden by the active filter. Please select a visible table from the dropdown above.`
      );
    }
  }

  function populateTableDropdown() {
    if (!parseResult) {
      tableSelect.innerHTML = '<option value="">-- No file loaded --</option>';
      navCount.textContent = '';
      return;
    }

    const filtered = getFilteredTables();
    const totalCount = parseResult.tables.length;

    if (filterMode === 'data') {
      navCount.textContent = `(${filtered.length}/${totalCount})`;
      if (filterHint) filterHint.textContent = `Filtered: >= 2 rows AND >= 2 grid cols (${filtered.length} tables)`;
    } else {
      navCount.textContent = `(${totalCount})`;
      if (filterHint) filterHint.textContent = `Showing all ${totalCount} physical tables`;
    }

    if (filtered.length === 0) {
      tableSelect.innerHTML = '<option value="">-- No matching tables --</option>';
      tableInfoCard.innerHTML = '<p class="text-muted">No tables match the selected filter.</p>';
      return;
    }

    let html = '<option value="">-- Select a table --</option>';
    for (const t of filtered) {
      const isNested = t.isNested;
      const prefix = isNested ? `↳ #${t.physicalIndex} (Nested in #${t.parentTableIndex})` : `#${t.physicalIndex} Table ${t.bodyIndex}`;
      const dim = `${t.rowCount}×${t.colCount}`;
      const spanFlag = t.hasSpans ? ' [spans]' : '';
      html += `<option value="${t.physicalIndex}">${esc(prefix)} — ${dim}${spanFlag}</option>`;
    }

    tableSelect.innerHTML = html;

    if (selectedPhysicalIndex > 0) {
      tableSelect.value = String(selectedPhysicalIndex);
    }
  }

  function onTableSelectChange(val) {
    if (!val) {
      clearSelection('Please select a table from the dropdown above.');
      return;
    }
    const physIdx = parseInt(val, 10);
    selectTableByPhysicalIndex(physIdx);
  }

  function selectTableByPhysicalIndex(physIdx) {
    if (!parseResult) return;
    const t = parseResult.tables.find(x => x.physicalIndex === physIdx);
    if (!t) return;

    selectedPhysicalIndex = physIdx;
    tableSelect.value = String(physIdx);

    // Reset auto-header suggestions and folded label on table switch
    currentFoldedLabel = null;
    autoRuleFired = null;
    autoRuleBadge.style.display = 'none';

    // Show controls
    tableControls.style.display = '';
    contentTabs.style.display = '';
    if (btnDownloadCsv) btnDownloadCsv.disabled = false;

    // Update table info card
    renderTableInfoCard(t);

    const label = t.isNested
      ? `Nested table #${t.physicalIndex} (inside Table #${t.parentTableIndex})`
      : `Table ${t.bodyIndex} (Physical #${t.physicalIndex})`;
    tableTitle.textContent = `${label} — ${t.rowCount}×${t.colCount}`;

    // Set data start max
    dataStartInput.max = t.rowCount;

    // Default header rows & data start (defaults to 1 and 1 if table has >= 2 rows, else 0 and 0)
    if (t.rowCount >= 2) {
      headerRowsSelect.value = '1';
      dataStartInput.value = '1';
    } else {
      headerRowsSelect.value = '0';
      dataStartInput.value = '0';
    }

    renderSelectedTable();
  }

  function clearSelection(message) {
    selectedPhysicalIndex = -1;
    tableSelect.value = '';
    currentFoldedLabel = null;
    autoRuleFired = null;
    autoRuleBadge.style.display = 'none';

    tableControls.style.display = 'none';
    contentTabs.style.display = 'none';
    if (btnDownloadCsv) btnDownloadCsv.disabled = true;

    tableInfoCard.innerHTML = `<p class="text-muted">${esc(message || 'No table selected')}</p>`;
    gridPanel.innerHTML = `<div class="notice notice-warn">${esc(message || 'No table selected')}</div>` +
      '<div class="empty-state"><p>Choose a table from the dropdown above to inspect.</p></div>';
    sourcePanel.innerHTML = '';
    csvPanel.innerHTML = '';
    provenancePanel.innerHTML = '';
  }

  function renderTableInfoCard(t) {
    let badges = '';
    if (t.isNested) badges += '<span class="badge-sm badge-nested">nested</span> ';
    if (t.hasSpans) badges += '<span class="badge-sm badge-spans">spans</span> ';

    tableInfoCard.innerHTML = `
      <h4>Physical Table #${t.physicalIndex}</h4>
      <div class="info-row"><span class="label">Type:</span><span class="val">${t.isNested ? 'Nested in #' + t.parentTableIndex : 'Body Table ' + t.bodyIndex}</span></div>
      <div class="info-row"><span class="label">Dimensions:</span><span class="val">${t.rowCount} rows × ${t.colCount} cols</span></div>
      <div class="info-row"><span class="label">Spans:</span><span class="val">${t.hasSpans ? 'Present' : 'None'}</span></div>
      ${t.nestedTableIndices && t.nestedTableIndices.length > 0 ? `<div class="info-row"><span class="label">Contains Nested:</span><span class="val">#${t.nestedTableIndices.join(', #')}</span></div>` : ''}
      ${badges ? `<div style="margin-top:6px">${badges}</div>` : ''}
    `;
  }

  // ─── Auto Header v3 ───

  function applyAutoHeader() {
    if (selectedPhysicalIndex <= 0 || !parseResult) return;
    const t = parseResult.tables.find(x => x.physicalIndex === selectedPhysicalIndex);
    if (!t) return;

    // Call AutoHeaderV3 heuristic (pure, idempotent)
    const suggestion = window.AutoHeaderV3.suggest(t);
    autoRuleFired = suggestion;

    if (suggestion.warning) {
      // Show warning and keep prior selection
      autoRuleBadge.style.display = '';
      autoRuleBadge.className = 'auto-rule-badge auto-rule-warn';
      autoRuleBadge.textContent = '⚠ ' + suggestion.ruleExplanation;
      return;
    }

    // Apply header and data start suggestions
    headerRowsSelect.value = String(suggestion.headerRowCount);
    dataStartInput.value = String(suggestion.dataStartRow);
    currentFoldedLabel = suggestion.foldedLabel;

    // Display fired rule explanation
    autoRuleBadge.style.display = '';
    autoRuleBadge.className = 'auto-rule-badge';
    autoRuleBadge.textContent = '⚡ ' + suggestion.ruleExplanation;

    renderSelectedTable();
  }

  // ─── Table Rendering ───

  function getActiveTable() {
    if (!parseResult || selectedPhysicalIndex <= 0) return null;
    return parseResult.tables.find(x => x.physicalIndex === selectedPhysicalIndex) || null;
  }

  function renderSelectedTable() {
    const t = getActiveTable();
    if (!t) return;

    const headerRows = parseInt(headerRowsSelect.value, 10);
    const dataStart = Math.max(parseInt(dataStartInput.value, 10) || 0, 0);

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

    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      const isHeader = r < headerRows;
      const isFoldedLabelRow = currentFoldedLabel && r === currentFoldedLabel.labelRow;

      if (r === 0) html += '<tbody>';

      let rowCls = '';
      if (isHeader) rowCls = 'header-row';
      else if (isFoldedLabelRow) rowCls = 'label-row';

      html += `<tr class="${rowCls}">`;
      html += `<td class="row-idx">${isFoldedLabelRow ? '🏷 ' + r : r}</td>`;

      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        let cls = '';
        let content = '';

        const isFoldedTargetCell = isHeader && currentFoldedLabel &&
          r === currentFoldedLabel.targetRow && c === currentFoldedLabel.targetCol;

        if (isFoldedTargetCell) {
          cls = 'folded-header-cell';
          const origText = cell && cell.text ? String(cell.text).trim() : '';
          const foldedVal = origText ? `${currentFoldedLabel.text} ${origText}` : currentFoldedLabel.text;
          content = `<strong>${esc(foldedVal)}</strong> <small title="Folded from Row ${currentFoldedLabel.labelRow}">[folded: ${esc(currentFoldedLabel.text)}]</small>`;
        } else if (isFoldedLabelRow) {
          content = `<em>${esc(cell.text || '')}</em> <small>[label row - excluded from data]</small>`;
        } else if (cell.spanned) {
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

    // Header/data indicator banners
    let indicators = '';
    if (currentFoldedLabel) {
      indicators += `<div class="notice notice-info">` +
        `<strong>Rule 2 Folded Label:</strong> "${esc(currentFoldedLabel.text)}" from row ${currentFoldedLabel.labelRow} folded into header cell 0. ` +
        `Row ${currentFoldedLabel.labelRow} excluded from data projection. Data starts at row ${dataStart}.</div>`;
    } else if (headerRows > 0) {
      indicators += `<div class="notice notice-info">Header rows: 0–${headerRows - 1}. Data starts at row ${dataStart}.</div>`;
    } else {
      indicators += '<div class="notice notice-info">No header rows selected (Rule 4 / manual). All rows treated as data from row 0.</div>';
    }

    gridPanel.innerHTML = indicators + html;
  }

  // ─── Source XML Rendering ───

  function renderSource(table) {
    const xml = table.sourceXml || '(source not available)';
    const highlighted = esc(xml)
      .replace(/(&lt;\/?)([\w:]+)/g, '$1<span class="tag">$2</span>')
      .replace(/([\w:]+)(=)/g, '<span class="attr">$1</span>$2')
      .replace(/"([^"]*)"/g, '"<span class="val">$1</span>"');

    sourcePanel.innerHTML = `<div class="source-view">${highlighted}</div>`;
  }

  // ─── CSV Preview ───

  function renderCsvPreview(table, headerRows, dataStart) {
    const exporter = new window.CsvExporter();
    const options = { foldedLabel: currentFoldedLabel };
    const { csv } = exporter.exportTable(table, headerRows, dataStart, options);

    const notice = '<div class="notice notice-warn">' +
      '⚠ Spreadsheet programs may reinterpret leading-zero strings (e.g. "031" → 31). ' +
      'To preserve them, import the CSV as text: in Excel, use Data → From Text/CSV and set all columns to "Text".' +
      '</div>';

    csvPanel.innerHTML = notice + `<pre class="csv-preview">${esc(csv)}</pre>`;
  }

  // ─── Provenance ───

  function renderProvenance(table, headerRows, dataStart) {
    const exporter = new window.CsvExporter();
    const options = { foldedLabel: currentFoldedLabel };
    const { provenance } = exporter.exportTable(table, headerRows, dataStart, options);

    let html = '<div class="notice notice-info">Every CSV cell has a companion provenance record ' +
      'linking it to the original file hash, XML part, table, row, and cell index.</div>';

    html += '<div style="overflow:auto; max-height:calc(100vh - 300px)">';
    html += '<table class="provenance-table"><thead><tr>' +
      '<th>CSV Row</th><th>CSV Col</th><th>Header</th><th>Raw Text</th>' +
      '<th>Is Header</th><th>Source Table</th><th>Source Row</th><th>Source Cell</th>' +
      '<th>Folded From (Rule 2)</th><th>File Hash</th><th>Part</th>' +
      '</tr></thead><tbody>';

    for (const p of provenance) {
      let foldedInfo = '—';
      if (p.foldedFrom) {
        foldedInfo = `<span style="color:var(--green)">Row ${p.foldedFrom.sourceRowIndex}, Cell ${p.foldedFrom.sourceCellIndex} ("${esc(p.foldedFrom.rawText)}")</span>`;
      }

      html += '<tr>' +
        `<td>${p.csvRow}</td>` +
        `<td>${p.csvCol}</td>` +
        `<td>${esc(p.headerLabel)}</td>` +
        `<td class="mono">${esc(truncate(p.rawText, 50))}</td>` +
        `<td>${p.isHeader ? '✓' : ''}</td>` +
        `<td>#${p.sourceTableIndex}</td>` +
        `<td>${p.sourceRowIndex}</td>` +
        `<td>${p.sourceCellIndex}</td>` +
        `<td>${foldedInfo}</td>` +
        `<td class="mono">${p.sourceFileHash ? p.sourceFileHash.substring(0, 10) + '…' : '—'}</td>` +
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
    const t = getActiveTable();
    if (!t || !parseResult) return;
    const headerRows = parseInt(headerRowsSelect.value, 10);
    const dataStart = Math.max(parseInt(dataStartInput.value, 10) || 0, 0);
    const exporter = new window.CsvExporter();
    const options = { foldedLabel: currentFoldedLabel };
    const { csv } = exporter.exportTable(t, headerRows, dataStart, options);

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
    onFilterChange,
    onTableSelectChange,
    selectTableByPhysicalIndex,
    applyAutoHeader,
    switchTab,
    downloadSelectedCsv,
  };

})();
