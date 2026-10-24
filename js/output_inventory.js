/* Inert HTML inventory. Never mount companion HTML in the live app. */
const OutputInventory = (() => {
    function isHidden(el) {
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const tag = n.localName;
            if (['script','style','template','noscript','svg'].includes(tag)) return true;
            if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') return true;
            const style = (n.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
            if (style.includes('display:none') || style.includes('visibility:hidden')) return true;
        }
        return false;
    }
    function parse(html, mode) {
        if (typeof DOMParser === 'undefined') throw new Error('DOMParser unavailable');
        const doc = new DOMParser().parseFromString(String(html), 'text/html');
        const occurrences = [];
        const presentation = {rowIndexCells:0,derivedGroupCells:0,reportHeadings:0};
        const reportTables = new Set();
        const metadata = {structuredTableNumbers:[],claim:null};
        // DOMParser does not calculate stylesheets or computed visibility.
        // An external or embedded CSS rule may conceal classed content.
        // Browser-based companion comparisons therefore remain candidates,
        // never verified visible-source preservation.
        const visibilityRisk = Boolean(doc.querySelector('style,link[rel~="stylesheet"]'));
        const visibilityVerified = mode === 'generated' && !visibilityRisk;
        const tables = Array.from(doc.querySelectorAll('table')).filter(t => !isHidden(t));
        // The "After Batch" report uses source table identifiers t1, t3 ... t45.
        // These anchors are only untrusted table-number hints, NOT proof of provenance.
        const reportProfile = mode === 'companion' && tables.length > 0 &&
            tables.every(t => {
                const sec = t.closest && t.closest('section.table-section[id]');
                return Boolean(sec && /^t[1-9][0-9]*$/.test(sec.id));
            });
        if(reportProfile){
            const meta=doc.querySelector('.doc-meta');
            metadata.claim=meta ? String(meta.textContent || '').replace(/\s+/g,' ').trim() : null;
        }
        tables.forEach((table, ti) => {
            const section=reportProfile?table.closest('section.table-section[id]'):null;
            const declaredNumber=section ? Number(section.id.slice(1)) : null;
            if(declaredNumber!==null){
                if(reportTables.has(declaredNumber))throw new Error('Repeated companion source-table anchor '+declaredNumber);
                reportTables.add(declaredNumber);
                metadata.structuredTableNumbers.push(declaredNumber);
            }
            const trs = Array.from(table.querySelectorAll('tr'))
                .filter(tr => tr.closest('table') === table && !isHidden(tr));
            trs.forEach((tr, ri) => {
                const cells = Array.from(tr.children)
                    .filter(c => (c.localName === 'td' || c.localName === 'th') && !isHidden(c));
                const rowMarker = reportProfile ? cells.find(c => c.classList.contains('row-idx')) : null;
                const match = rowMarker && String(rowMarker.getAttribute('title') || '').match(/^Source row\s+(\d+)$/);
                const sourceRowHint = match ? Number(match[1]) : null;
                const dataCells = reportProfile ? cells.filter(c=>!c.classList.contains('row-idx')) : cells;
                const grouped = reportProfile && dataCells[0] &&
                    (dataCells[0].classList.contains('group-cell') ||
                    (ri === 0 && dataCells[0].textContent.trim() === 'Group'));
                cells.forEach((cell, ci) => {
                    if(reportProfile && cell.classList.contains('row-idx')){
                        presentation.rowIndexCells++;
                        return;
                    }
                    const semanticColIndex=dataCells.indexOf(cell);
                    const derivedGroup=reportProfile && semanticColIndex===0 && grouped;
                    if(derivedGroup){
                        presentation.derivedGroupCells++;
                        return;
                    }
                    const outputId = 'out:table[' + (ti+1) + ']/tr[' + (ri+1) + ']/cell[' + (ci+1) + ']';
                    const dataIds = mode === 'generated' ?
                        String(cell.getAttribute('data-source-ids') || cell.getAttribute('data-source-id') || '')
                            .split('|').filter(Boolean) : [];
                    occurrences.push({
                        outputId, kind:'cell', text:cell.textContent || '',
                        tableIndex: reportProfile ? declaredNumber-1 : ti,
                        displayTableIndex:ti, declaredSourceTableNumber:declaredNumber,
                        rowIndex:reportProfile && sourceRowHint!==null ? sourceRowHint : ri,
                        displayRowIndex:ri, sourceRowHint:sourceRowHint,
                        colIndex: reportProfile ? semanticColIndex - (grouped ? 1 : 0) : ci,
                        displayColIndex:ci,
                        sourceIds:dataIds, sourceTableId: mode === 'generated' ? table.getAttribute('data-source-table-id') : null,
                        location:outputId
                    });
                });
            });
        });
        const nodes = Array.from(doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li'));
        let paraIndex = 0;
        nodes.forEach(el => {
            if (el.closest('table') || isHidden(el)) return;
            if (reportProfile) { presentation.reportHeadings++; return; }
            paraIndex++;
            const outputId = 'out:paragraph[' + paraIndex + ']';
            occurrences.push({
                outputId, kind:'paragraph', text:el.textContent || '',
                paraIndex:paraIndex-1, location:outputId,
                sourceIds:mode === 'generated' ?
                    String(el.getAttribute('data-source-id') || '').split('|').filter(Boolean) : []
            });
        });
        return {schemaVersion:1, mode, occurrences, tableCount:tables.length,
            reportProfile:reportProfile ? 'R5_REFINED_TABLES' : null,
            sourceTableNumberHints: metadata.structuredTableNumbers,
            reportFilterClaim: metadata.claim,
            presentation, visibilityRisk, visibilityVerified,
            visibilityBasis:visibilityRisk ? 'STYLESHEET_NOT_EVALUATED' :
                (mode === 'generated' ? 'INERT_GENERATED_DOM' : 'COMPANION_DOM_ONLY')};
    }
    const api = {parse};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return api;
})();