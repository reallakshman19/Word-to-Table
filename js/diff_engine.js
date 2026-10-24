/* Deterministic, occurrence-consuming diff. No global substring matching. */
const DiffEngine = (() => {
    const STATUSES = ['PRESERVED_EXACT','PRESERVED_NORMALIZED','ALTERED','FILTERED','MISSING','AMBIGUOUS','UNSUPPORTED','ERROR'];
    function norm(value, cfg) {
        let v = String(value == null ? '' : value);
        if (cfg.normalizeWhitespace !== false) v = v.replace(/\s+/g, ' ').trim();
        if (cfg.caseInsensitive !== false) v = v.toLowerCase();
        return v;
    }
    function textStatus(source, target, cfg) {
        if (source === target) return 'PRESERVED_EXACT';
        return norm(source, cfg) === norm(target, cfg) ? 'PRESERVED_NORMALIZED' : 'ALTERED';
    }
    function compare(sourceLedger, conversionLedger, outputLedger, config) {
        const cfg = config || {};
        const source = sourceLedger.occurrences || [];
        const target = outputLedger.occurrences || [];
        const mode = outputLedger.mode || 'companion';
        const events = conversionLedger && conversionLedger.events || [];
        const filtered = new Map(events.filter(e => e.action === 'FILTERED').map(e => [e.sourceId,e]));
        const unsupported = new Set((conversionLedger && conversionLedger.unsupportedSourceIds) || []);
        const index = new Map();
        for (const item of target) {
            for (const sid of (item.sourceIds || [])) {
                if (!index.has(sid)) index.set(sid, []);
                index.get(sid).push(item);
            }
        }
        const used = new Set();
        const statuses = Object.fromEntries(STATUSES.map(s => [s, 0]));
        const rows = [];
        let paragraphCursor = 0;
        for (const src of source) {
            let status = 'MISSING', out = null, reason = 'No verified output occurrence';
            if (src.coverage !== 'SUPPORTED' || unsupported.has(src.sourceId)) {
                status = 'UNSUPPORTED'; reason = 'Source conversion unsupported by this extraction mode';
            } else if (filtered.has(src.sourceId)) {
                status = 'FILTERED'; reason = filtered.get(src.sourceId).ruleId || 'Actual converter filter event';
            } else if (mode === 'generated') {
                const candidates = index.get(src.sourceId) || [];
                if (candidates.length === 1) {
                    out = candidates[0];
                    const shared = (out.sourceIds || []).length > 1;
                    const hasTransform = events.some(e =>
                        e.action === 'TRANSFORMED' &&
                        e.sourceId === src.sourceId &&
                        e.outputId === out.outputId);
                    if (used.has(out.outputId) && !shared) {
                        status = 'AMBIGUOUS'; reason = 'Output occurrence already consumed';
                    } else if (shared && !hasTransform) {
                        status = 'AMBIGUOUS'; reason = 'Multi-source output without transformation evidence';
                    } else {
                        used.add(out.outputId);
                        status = textStatus(src.textOriginal, out.text, cfg);
                        reason = shared ? 'Header aggregation documented; inspect changed text' : 'Embedded source ID in generated output';
                        if (shared && status === 'PRESERVED_EXACT') status = 'ALTERED';
                    }
                } else if (candidates.length > 1) {
                    status = 'AMBIGUOUS'; reason = 'Source ID emitted more than once';
                }
            } else {
                let candidates;
                if (src.kind === 'cell') candidates = target.filter(t =>
                    t.kind === 'cell' &&
                    t.tableIndex === sourceTableOrdinal(sourceLedger, src.tableId) &&
                    t.rowIndex === src.rowIndex && t.colIndex === src.colIndex);
                else {
                    candidates = target.filter(t => t.kind === 'paragraph' && t.paraIndex === paragraphCursor);
                    paragraphCursor++;
                }
                if (candidates.length === 1 && !used.has(candidates[0].outputId)) {
                    out = candidates[0];
                    const match = textStatus(src.textOriginal, out.text, cfg);
                    if (match === 'PRESERVED_EXACT' || match === 'PRESERVED_NORMALIZED') {
                        status = match; reason = 'Unique position-constrained candidate';
                        used.add(out.outputId);
                    } else {
                        status = 'AMBIGUOUS'; reason = 'Position candidate differs; no transformation provenance';
                    }
                } else if (candidates.length > 1) {
                    status = 'AMBIGUOUS'; reason = 'Multiple structural candidates';
                }
            }
            statuses[status]++;
            rows.push({
                sourceId:src.sourceId, sourcePath:src.sourcePath, sourcePart:src.sourcePart,
                kind:src.kind, tableId:src.tableId || null, pageHint:src.pageHint || null,
                sourceText:src.textOriginal, outputId:out ? out.outputId : null,
                outputLocation:out ? out.location : null, outputText:out ? out.text : null,
                status, reason, structuralEmpty:!!src.structuralEmpty
            });
        }
        const extras = target.filter(t => !used.has(t.outputId));
        const total = Object.values(statuses).reduce((a,b) => a+b,0);
        if (total !== source.length) throw new Error('Audit accounting mismatch');
        const diagnostics = sourceLedger.diagnostics || [];
        return {
            schemaVersion:1, mode, rows, statuses, sourceTotal:source.length,
            tableCount:(sourceLedger.tables || []).length,
            outputTotal:target.length, extraOutput:extras, diagnostics,
            dispositionCoverage:total === source.length ? 1 : 0,
            qualified:diagnostics.length === 0 && !statuses.AMBIGUOUS &&
                !statuses.UNSUPPORTED && !statuses.ERROR && !extras.length
        };
    }
    function sourceTableOrdinal(ledger, id) {
        return (ledger.tables || []).filter(t => !t.parentTableId).findIndex(t => t.tableId === id);
    }
    const api = {compare, norm, textStatus, STATUSES};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return api;
})();