/* Deterministic full-ledger exports. No external runtime assets. */
const AuditExport = (() => {
    function safeJson(o) {
        return JSON.stringify(o).replace(/</g,'\\u003c').replace(/>/g,'\\u003e')
            .replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    }
    function csvCell(v) {
        let s=String(v==null?'':v);
        if (/^\s*[=+\-@\t\r]/.test(s)) s="'"+s;
        return '"'+s.replace(/"/g,'""')+'"';
    }
    function csv(audit) {
        const cols=['sourceId','sourcePath','kind','sourceText','outputId','outputLocation','outputText','status','reason'];
        const lines=[cols.map(csvCell).join(',')];
        (audit.result.rows||[]).forEach(row => lines.push(cols.map(k=>csvCell(row[k])).join(',')));
        return '\ufeff'+lines.join('\r\n')+'\r\n';
    }
    function escapeHtml(v) {
        return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function standalone(audit) {
        // Embedded JSON is inert, and escaped against script-element termination.
        const style='body{font:14px system-ui,sans-serif;background:#111827;color:#e5e7eb;margin:0;padding:20px}' +
          'header{max-width:1200px;margin:auto}main{max-width:1200px;margin:15px auto}' +
          'button,input,select{padding:9px;border-radius:6px;background:#243247;color:white;border:1px solid #53627a}' +
          'button{cursor:pointer}article{padding:14px;background:#1f2937;border:1px solid #3b4559;border-radius:9px;margin:8px 0}' +
          '.line{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}.muted{color:#9ca3af}' +
          '.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:650px){.cols{grid-template-columns:1fr}}';
        function client() {
            'use strict';
            const data=JSON.parse(document.getElementById('audit-data').textContent);
            const rows=data.result.rows||[];
            const status=document.getElementById('status');
            status.textContent='Source '+data.result.sourceTotal+' · Extra output '+data.result.extraOutput.length+
                ' · Coverage exceptions '+data.result.diagnostics.length;
            const filter=document.getElementById('status-filter');
            const search=document.getElementById('search');
            const list=document.getElementById('records');
            const info=document.getElementById('page-info');
            let page=0;
            function render() {
                const q=search.value.toLowerCase();
                const matches=rows.filter(r=>(filter.value==='All'||(filter.value==='Issues'?
                    !r.status.startsWith('PRESERVED'):r.status===filter.value)) &&
                    (!q || [r.sourceId,r.sourceText,r.outputText,r.reason,r.status].some(x=>String(x||'').toLowerCase().includes(q))));
                const pages=Math.max(1,Math.ceil(matches.length/100));
                page=Math.max(0,Math.min(page,pages-1));
                info.textContent=(page+1)+' / '+pages+' · '+matches.length+' records';
                list.replaceChildren();
                for (const r of matches.slice(page*100,(page+1)*100)) {
                    const article=document.createElement('article');
                    function line(text,cls) {
                        const el=document.createElement('div');el.className='line '+(cls||'');
                        el.textContent=text;article.appendChild(el);
                    }
                    line(r.status+' · '+r.sourceId);
                    line('Source: '+r.sourceText);
                    line('Target: '+(r.outputText===null?'[No verified occurrence]':r.outputText));
                    line('Output: '+(r.outputId||'none')+' · '+r.reason,'muted');
                    list.appendChild(article);
                }
            }
            filter.addEventListener('change',()=>{page=0;render();});
            search.addEventListener('input',()=>{page=0;render();});
            document.getElementById('prev').addEventListener('click',()=>{page--;render();});
            document.getElementById('next').addEventListener('click',()=>{page++;render();});
            render();
        }
        const options=['All','Issues','PRESERVED_EXACT','PRESERVED_NORMALIZED','ALTERED','FILTERED','MISSING','AMBIGUOUS','UNSUPPORTED','ERROR'];
        return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Word-to-Table Traceability Audit</title><style>'+style+'</style></head><body>' +
            '<header><h1>Source-to-output traceability audit</h1><p id="status"></p>' +
            '<label>Status <select id="status-filter">'+options.map(x=>'<option>'+escapeHtml(x)+'</option>').join('')+
            '</select></label> <input id="search" aria-label="Search audit" placeholder="Search source, output or ID">' +
            '<button id="prev">Previous</button> <span id="page-info"></span> <button id="next">Next</button></header>' +
            '<main id="records"></main><script type="application/json" id="audit-data">' +
            safeJson(audit)+'</script><script>('+client.toString()+')();</script></body></html>';
    }
    function download(audit, kind) {
        if (!audit) throw new Error('No audit to export');
        const base=String(audit.meta.filename||'document').replace(/\.docx$/i,'').replace(/[^a-zA-Z0-9._-]/g,'_');
        const contents=kind==='csv'?csv(audit):kind==='html'?standalone(audit):JSON.stringify(audit,null,2);
        const mime=kind==='html'?'text/html':kind==='csv'?'text/csv':'application/json';
        const url=URL.createObjectURL(new Blob([contents],{type:mime+';charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download=base+'_audit.'+(kind==='html'?'html':kind);
        link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    const api={csv,standalone,download,safeJson};
    if(typeof module!=='undefined'&&module.exports) module.exports=api;
    return api;
})();