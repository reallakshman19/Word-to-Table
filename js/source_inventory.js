/* Independent, pre-heuristic OOXML inventory. No physical-page claims. */
const SourceInventory = (() => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    function children(node, name) {
        return Array.from(node.children || []).filter(x => !name || x.localName === name);
    }
    function desc(node, name) {
        return Array.from(node.getElementsByTagNameNS(W, name));
    }
    function attr(node, name) {
        return node.getAttributeNS(W, name) || node.getAttribute('w:' + name) || node.getAttribute(name);
    }
    const REVISION_TAGS = ['ins','del','moveFrom','moveTo','pPrChange','rPrChange',
        'tblPrChange','trPrChange','tcPrChange','cellIns','cellDel','cellMerge'];
    function containsRevision(node) {
        return REVISION_TAGS.some(tag => desc(node,tag).length > 0);
    }
    function paragraphText(p) {
        // Text extraction is not revision acceptance. Changes are recorded as
        // UNSUPPORTED below until an explicit revision disposition is chosen.
        const out = [];
        function walk(node) {
            if (node.localName === 'del' || node.localName === 'moveFrom') return;
            if (node.localName === 't') { out.push(node.textContent || ''); return; }
            if (node.localName === 'tab') { out.push('\t'); return; }
            if (node.localName === 'br' || node.localName === 'cr') { out.push('\n'); return; }
            // Recurse through runs, hyperlinks and change wrappers, so an
            // inserted visible run is never silently returned as empty text.
            children(node).forEach(walk);
        }
        children(p).forEach(walk);
        return out.join('');
    }
    function nodeId(path) { return 'src:word/document.xml:' + path; }
    function build(xmlDoc, packageParts) {
        const errors = xmlDoc.getElementsByTagName('parsererror');
        if (errors.length) throw new Error('Invalid Word document.xml');
        const body = xmlDoc.getElementsByTagNameNS(W, 'body')[0];
        if (!body) throw new Error('Missing Word document body');
        const occurrences = [];
        const tables = [];
        const diagnostics = [];
        let order = 0;
        function add(kind, path, text, extra) {
            const obj = Object.assign({
                sourceId: nodeId(path), sourcePart: 'word/document.xml',
                sourcePath: path, kind, textOriginal: text,
                logicalOrder: ++order, pageHint: null, coverage: 'SUPPORTED'
            }, extra || {});
            occurrences.push(obj);
            return obj;
        }
        function walkTable(tbl, path, parentTableId) {
            const tableId = nodeId(path);
            const entry = {tableId, sourcePath: path, parentTableId: parentTableId || null, grid: [], cells: []};
            tables.push(entry);
            children(tbl, 'tr').forEach((tr, ri) => {
                const rowPath = path + '/tr[' + (ri + 1) + ']';
                const row = [];
                children(tr, 'tc').forEach((tc, ci) => {
                    const cellPath = rowPath + '/tc[' + (ci + 1) + ']';
                    const pr = children(tc, 'tcPr')[0];
                    const gs = pr ? children(pr, 'gridSpan')[0] : null;
                    const vm = pr ? children(pr, 'vMerge')[0] : null;
                    const span = gs ? Math.max(1, Math.min(1000, Number(attr(gs, 'val')) || 1)) : 1;
                    const merge = vm ? (attr(vm, 'val') || 'continue') : null;
                    const para = children(tc, 'p');
                    const paragraphs = para.map((p, pi) => ({
                        path: cellPath + '/p[' + (pi + 1) + ']',
                        text: paragraphText(p)
                    }));
                    const text = paragraphs.map(p => p.text).join('\n');
                    const occurrence = add('cell', cellPath, text, {
                        tableId, rowIndex: ri, cellIndex: ci,
                        colIndex: row.length, gridSpan: span,
                        vMerge: merge, paragraphs, structuralEmpty: !text,
                        coverage: containsRevision(tc) ? 'UNSUPPORTED' : 'SUPPORTED'
                    });
                    entry.cells.push(occurrence.sourceId);
                    row.push(occurrence.sourceId);
                    for (let si = 1; si < span; si++) row.push(null);
                    children(tc, 'tbl').forEach((nested, ti) => {
                        walkTable(nested, cellPath + '/tbl[' + (ti + 1) + ']', tableId);
                    });
                });
                entry.grid.push(row);
            });
        }
        let pi = 0, ti = 0;
        for (const el of children(body)) {
            if (el.localName === 'p') {
                pi++;
                add('paragraph', '/body/p[' + pi + ']', paragraphText(el), {
                    coverage: containsRevision(el) ? 'UNSUPPORTED' : 'SUPPORTED'
                });
            } else if (el.localName === 'tbl') {
                ti++;
                walkTable(el, '/body/tbl[' + ti + ']', null);
            } else if (el.localName !== 'sectPr' && el.localName !== 'bookmarkStart' && el.localName !== 'bookmarkEnd') {
                diagnostics.push({kind:'UNSUPPORTED_SOURCE_FEATURE', part:'word/document.xml', feature:el.localName});
            }
        }
        const unsupportedTags = ['drawing','pict','object','txbxContent','oMath','oMathPara','altChunk','fldSimple','instrText','footnoteReference','endnoteReference','commentReference','sdt',...REVISION_TAGS];
        unsupportedTags.forEach(tag => {
            desc(body, tag).forEach((node, i) => diagnostics.push({
                kind:'UNSUPPORTED_SOURCE_FEATURE', part:'word/document.xml',
                feature:tag, occurrence:i + 1
            }));
        });
        const extraParts = (packageParts || []).filter(path =>
            /^word\/(header\d+|footer\d+|footnotes|endnotes|comments|glossary\/document)\.xml$/i.test(path));
        extraParts.forEach(path => diagnostics.push({
            kind:'UNSUPPORTED_SOURCE_PART', part:path, feature:'separate DOCX story'
        }));
        const seen = new Set();
        for (const o of occurrences) {
            if (seen.has(o.sourceId)) throw new Error('Duplicate source ID: ' + o.sourceId);
            seen.add(o.sourceId);
        }
        return {
            schemaVersion: 1, occurrences, tables, diagnostics,
            scope: 'document.xml top-level paragraphs and canonical table cells (including nested tables)',
            supportedCount: occurrences.length,
            hasCoverageExceptions: diagnostics.length > 0
        };
    }
    async function fromArrayBuffer(buffer) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
        const zip = await JSZip.loadAsync(buffer);
        const doc = zip.file('word/document.xml');
        if (!doc) throw new Error('Invalid .docx: word/document.xml absent');
        const xml = await doc.async('string');
        const parsed = new DOMParser().parseFromString(xml, 'application/xml');
        return build(parsed, Object.keys(zip.files));
    }
    const api = {build, fromArrayBuffer, paragraphText};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return api;
})();