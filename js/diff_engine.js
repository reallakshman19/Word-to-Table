/* Deterministic, occurrence-consuming diff. No global substring matching. */
const DiffEngine = (() => {
    const STATUSES = ['PRESERVED_EXACT','PRESERVED_NORMALIZED','ALTERED','CANDIDATE_MATCH','FILTERED','MISSING','AMBIGUOUS','UNSUPPORTED','ERROR'];
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
        if (source.length > 100000 || target.length > 100000) throw new Error('Audit occurrence limit (100,000 per side) exceeded; split the document');
        const events = conversionLedger && conversionLedger.events || [];
        const filtered = new Map(events.filter(e => e.action === 'FILTERED').map(e => [e.sourceId,e]));
        const unsupported = new Set((conversionLedger && conversionLedger.unsupportedSourceIds) || []);
        const index = new Map();
        const byPosition = new Map();
        const tableOrdinal = new Map((sourceLedger.tables || []).filter(t=>!t.parentTableId).map((t,i)=>[t.tableId,i]));
        const transforms = new Set(events.filter(e=>e.action==='TRANSFORMED').map(e=>e.sourceId+'|'+e.outputId));
        const trustedProvenance = mode === 'generated' && conversionLedger &&
            conversionLedger.provenanceVerified === true && outputLedger.visibilityVerified === true;
        const tableMappings = new Map((conversionLedger && conversionLedger.tables || []).map(t => [t.sourceTableId,t]));
        for (const item of target) {
            const positionKey = item.kind === 'cell' ?
                'c|'+item.tableIndex+'|'+item.rowIndex+'|'+item.colIndex :
                'p|'+item.paraIndex;
            if (!byPosition.has(positionKey)) byPosition.set(positionKey, []);
            byPosition.get(positionKey).push(item);
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
                    const hasTransform = transforms.has(src.sourceId+'|'+out.outputId);
                    const mapping = tableMappings.get(src.tableId);
                    const headerRow = mapping ? mapping.headerRow : 1;
                    const expectedTable = mapping ? mapping.outputTableIndex : tableOrdinal.get(src.tableId);
                    const expectedRow = src.rowIndex < headerRow ? 0 : src.rowIndex - headerRow + 1;
                    const expectedCol = src.colIndex;
                    const structuralMatch = src.kind === 'cell' &&
                        out.kind === 'cell' && Number.isInteger(expectedTable) &&
                        out.tableIndex === expectedTable && out.rowIndex === expectedRow &&
                        out.colIndex === expectedCol &&
                        (!out.sourceTableId || out.sourceTableId === src.tableId);
                    if (!structuralMatch) {
                        status = 'AMBIGUOUS'; reason = 'Table, row or column moved without verified structural transformation';
                    } else if (used.has(out.outputId) && !shared) {
                        status = 'AMBIGUOUS'; reason = 'Output occurrence already consumed';
                    } else if (shared && !hasTransform) {
                        status = 'AMBIGUOUS'; reason = 'Multi-source output without transformation evidence';
                    } else {
                        used.add(out.outputId);
                        const comparison = textStatus(src.textOriginal, out.text, cfg);
                        status = trustedProvenance ? comparison : 'CANDIDATE_MATCH';
                        reason = trustedProvenance ?
                            'Source-ID and structural correspondence supported by emission provenance' :
                            'Post-hoc source ID is not independently verified; text agreement is only a candidate';
                        if (shared && trustedProvenance && status === 'PRESERVED_EXACT') status = 'ALTERED';
                    }
                } else if (candidates.length > 1) {
                    status = 'AMBIGUOUS'; reason = 'Source ID emitted more than once';
                }
            } else {
                let candidates;
                if (src.kind === 'cell') candidates = byPosition.get('c|'+tableOrdinal.get(src.tableId)+'|'+src.rowIndex+'|'+src.colIndex) || [];
                else {
                    candidates = byPosition.get('p|'+paragraphCursor) || [];
                    paragraphCursor++;
                }
                if (candidates.length === 1 && !used.has(candidates[0].outputId)) {
                    out = candidates[0];
                    const match = textStatus(src.textOriginal, out.text, cfg);
                    if (match === 'PRESERVED_EXACT' || match === 'PRESERVED_NORMALIZED') {
                        status = 'CANDIDATE_MATCH';
                        reason = 'Text at source-table-number/row/column hint; candidate only, not identity proof';
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
        const represented = new Set(outputLedger.sourceTableNumberHints || []);
        const omittedSourceTables = mode === 'companion' && outputLedger.reportProfile ?
            (sourceLedger.tables || []).filter(t=>!t.parentTableId)
                .map((t,i)=>({sourceTableId:t.tableId,tableNumber:i+1}))
                .filter(t=>!represented.has(t.tableNumber)) : [];
        return {
            schemaVersion:1, mode, rows, statuses, sourceTotal:source.length,
            tableCount:(sourceLedger.tables || []).length,
            outputTotal:target.length, extraOutput:extras, diagnostics,
            omittedSourceTables, targetPresentation:outputLedger.presentation || null,
            reportFilterClaim: outputLedger.reportFilterClaim || null,
            dispositionCoverage:total === source.length ? 1 : 0,
            qualified:trustedProvenance && diagnostics.length === 0 &&
                !statuses.CANDIDATE_MATCH && !statuses.AMBIGUOUS &&
                !statuses.UNSUPPORTED && !statuses.ERROR && !statuses.MISSING &&
                !statuses.ALTERED && !statuses.FILTERED && !extras.length
        };
    }
    function sourceTableOrdinal(ledger, id) {
        return (ledger.tables || []).filter(t => !t.parentTableId).findIndex(t => t.tableId === id);
    }
    const api = {compare, norm, textStatus, STATUSES};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return api;
})();