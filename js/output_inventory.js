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
        // DOMParser does not calculate stylesheets or computed visibility.
        // An external or embedded CSS rule may conceal classed content.
        // Browser-based companion comparisons therefore remain candidates,
        // never verified visible-source preservation.
        const visibilityRisk = Boolean(doc.querySelector('style,link[rel~="stylesheet"]'));
        const visibilityVerified = mode === 'generated' && !visibilityRisk;
        const tables = Array.from(doc.querySelectorAll('table')).filter(t => !isHidden(t));
        tables.forEach((table, ti) => {
            const trs = Array.from(table.querySelectorAll('tr'))
                .filter(tr => tr.closest('table') === table && !isHidden(tr));
            trs.forEach((tr, ri) => {
                const cells = Array.from(tr.children)
                    .filter(c => (c.localName === 'td' || c.localName === 'th') && !isHidden(c));
                cells.forEach((cell, ci) => {
                    const outputId = 'out:table[' + (ti+1) + ']/tr[' + (ri+1) + ']/cell[' + (ci+1) + ']';
                    const dataIds = mode === 'generated' ?
                        String(cell.getAttribute('data-source-ids') || cell.getAttribute('data-source-id') || '')
                            .split('|').filter(Boolean) : [];
                    occurrences.push({
                        outputId, kind:'cell', text:cell.textContent || '',
                        tableIndex:ti, rowIndex:ri, colIndex:ci,
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
            visibilityRisk, visibilityVerified,
            visibilityBasis:visibilityRisk ? 'STYLESHEET_NOT_EVALUATED' :
                (mode === 'generated' ? 'INERT_GENERATED_DOM' : 'COMPANION_DOM_ONLY')};
    }
    const api = {parse};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return api;
})();