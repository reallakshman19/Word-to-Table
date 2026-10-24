/* Capture actual browser output and its source-emission events. */
const ConversionLedger = (() => {
    function build(sourceLedger, appTables, mode) {
        const events = [], snippets = [], unsupportedSourceIds = [], tableMappings = [];
        if (mode !== 'browser') {
            // The Python service has not established occurrence provenance.
            return {events, html:'', unsupportedSourceIds:sourceLedger.occurrences.map(x => x.sourceId),
                verified:false, provenanceVerified:false, tables:[],
                reason:'Local server response has no source-occurrence contract'};
        }
        const topTables = (sourceLedger.tables || []).filter(t => !t.parentTableId);
        (appTables || []).forEach((t, ti) => {
            const source = topTables[(t.tableIndex || (ti+1)) - 1];
            if (!source || !t.html) return;
            const doc = new DOMParser().parseFromString(String(t.html),'text/html');
            const table = doc.querySelector('table');
            if (!table) return;
            table.setAttribute('data-source-table-id', source.tableId);
            const rows = Array.from(table.querySelectorAll('tr')).filter(tr=>tr.closest('table')===table);
            const headerRow = Number.isInteger(t.headerRow) ? t.headerRow : 1;
            tableMappings.push({sourceTableId:source.tableId, outputTableIndex:ti, headerRow});
            const idFor = (r,c) => (source.grid[r] && source.grid[r][c]) || null;
            rows.forEach((tr, ri) => {
                const cells = Array.from(tr.children).filter(c=>c.localName==='td'||c.localName==='th');
                cells.forEach((cell, ci) => {
                    let ids = [];
                    if (ri === 0) {
                        for (let r=0;r<headerRow;r++) {
                            const id=idFor(r,ci);
                            if (id && !ids.includes(id)) ids.push(id);
                        }
                    } else {
                        const id=idFor(headerRow+ri-1,ci);
                        if (id) ids=[id];
                    }
                    const outputId='out:table['+(ti+1)+']/tr['+(ri+1)+']/cell['+(ci+1)+']';
                    if (ids.length) cell.setAttribute('data-source-ids',ids.join('|'));
                    ids.forEach(id => events.push({
                        sourceId:id, outputId, action:ri===0?'TRANSFORMED':'EMITTED',
                        ruleId:ri===0?'HEADER_PROMOTION':'TABLE_CELL_SERIALIZATION',
                        evidence:'Actual serialized HTML cell', runId:null
                    }));
                });
            });
            snippets.push(table.outerHTML);
        });
        const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
            snippets.join('\n') + '</body></html>';
        return {events, html, unsupportedSourceIds, tables:tableMappings,
            verified:false, provenanceVerified:false,
            reason:'Source IDs annotated post-serialization by inferred positions; no trusted emission-bound provenance'};
    }
    const api = {build};
    if (typeof module!=='undefined' && module.exports) module.exports=api;
    return api;
})();