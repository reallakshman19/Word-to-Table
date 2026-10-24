/* Full-model audit rendering and offline exports; uploaded markup is never injected. */
const XYAuditUI = (() => {
    let model=null, search='', filter='ALL', start=0, group='ALL', tableFilter='ALL';
    const pageSize=25;
    const esc=XYInventory.esc;
    function render(next) {
        if(next) {model=next;search='';filter=group=tableFilter='ALL';start=0;}
        const host=document.getElementById('xy-audit');
        if(!model) {host.innerHTML='<div class="xy-empty"><strong>Every source occurrence has a place here</strong><p>Open a Word document, then audit the current table, last batch, or uploaded HTML.</p></div>';return;}
        host.innerHTML=XYAuditView.shell(model);
        host.querySelectorAll('[data-audit-filter]').forEach(button=>button.onclick=()=>{
            group=button.dataset.auditFilter;filter='ALL';start=0;
            host.querySelector('#xy-status').value='ALL';refresh();
        });
        host.querySelector('#xy-table-filter').onchange=e=>{tableFilter=e.target.value;start=0;refresh();};
        host.querySelector('#xy-status').onchange=e=>{filter=e.target.value;group='ALL';start=0;refresh();};
        host.querySelector('#xy-search').oninput=e=>{search=e.target.value;start=0;refresh();};
        host.querySelector('#xy-prev').onclick=()=>{start=Math.max(0,start-pageSize);refresh();};
        host.querySelector('#xy-next').onclick=()=>{start+=pageSize;refresh();};
        host.querySelector('#xy-json').onclick=()=>guard(()=>download(JSON.stringify(model,null,2),'audit.json','application/json'));
        host.querySelector('#xy-csv').onclick=()=>guard(()=>download(csv(model),'audit.csv','text/csv'));
        host.querySelector('#xy-report').onclick=()=>guard(()=>download(report(model),'audit.html','text/html'));
        host.querySelector('#xy-source').onclick=()=>guard(()=>download(model.sourceFile,'original.docx','application/octet-stream'));
        host.querySelector('#xy-target').onclick=()=>guard(()=>download(model.targetFile||model.targetHtml,'target.html','text/html'));
        host.querySelector('#xy-generated').onclick=()=>XYIntegration.clearCompanion();
        refresh();
    }
    function guard(action) {
        if(!model?.isFresh()) {model=null;render();XYIntegration.message('Audit stale — run Word diff again.');return;}
        action();
    }
    function refresh() {
        const list=model.items.filter(s=>(filter==='ALL'||s.status===filter)&&
            (group==='ALL'||(group==='ISSUES'?['missing','unsupported','changed'].includes(XYAuditView.category(s)):XYAuditView.category(s)===group))&&
            (tableFilter==='ALL'||(tableFilter==='PARAGRAPHS'?s.kind==='paragraph':s.table===Number(tableFilter)))&&
            [s.id,s.text,s.targetText,s.path,s.status].join(' ').toLowerCase().includes(search.toLowerCase()));
        start=Math.min(start,Math.max(0,Math.ceil(list.length/pageSize)-1)*pageSize);
        document.getElementById('xy-visible').textContent=`${list.length?start+1:0}–${Math.min(list.length,start+pageSize)} of ${list.length} · exports: all ${model.sourceTotal}`;
        document.getElementById('xy-items').innerHTML=XYAuditView.cards(list.slice(start,start+pageSize));
        document.querySelectorAll('[data-audit-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.auditFilter===group)));
    }
    function safeCSV(value) {
        const s=String(value??'');
        return '"'+(/^[\s]*[=+@-]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';
    }
    function csv(data) {
        const keys=['id','kind','status','text','targetText','path','outputId','outputPath','evidence','reason','outputLinks'];
        return '\uFEFF'+[keys,...data.items.map(s=>keys.map(k=>k==='outputLinks'?JSON.stringify(s[k]):s[k]))].map(r=>r.map(safeCSV).join(',')).join('\r\n');
    }
    function download(content,name,type) {
        const url=URL.createObjectURL(content instanceof Blob?content:new Blob([content],{type}));
        const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function report(data) {
        // Data is JSON escaped for a script element; UI builds only textContent nodes.
        const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
        const code=`const m=JSON.parse(document.getElementById('data').textContent);
            const q=document.getElementById('search'),s=document.getElementById('status'),body=document.getElementById('rows');
            for(const status of Object.keys(m.counts)){const o=document.createElement('option');o.textContent=status;s.append(o);}
            function draw(){body.replaceChildren();let n=0;for(const r of m.items){
                if(s.value!=='ALL'&&r.status!==s.value)continue;
                if(![r.text,r.targetText,r.path,r.status].join(' ').toLowerCase().includes(q.value.toLowerCase()))continue;
                n++;const tr=document.createElement('tr');
                for(const key of ['status','path','text','targetText','evidence','reason','outputLinks']){const td=document.createElement('td');td.textContent=key==='outputLinks'?JSON.stringify(r[key]):r[key]??'[no target]';tr.append(td);}body.append(tr);}
                document.getElementById('count').textContent=n+' / '+m.sourceTotal+' source occurrences; '+m.extras.length+' output extras';}
            q.oninput=draw;s.onchange=draw;draw();
            document.getElementById('identity').textContent=JSON.stringify({identity:m.identity,scope:m.inventory.scope,diagnostics:m.inventory.diagnostics,extras:m.extras},null,2);`;
        return `<!doctype html><meta charset="utf-8"><title>Word diff audit — REVIEW_REQUIRED</title>
            <style>body{font:14px system-ui;padding:20px}td,th{border:1px solid #bbb;padding:6px;white-space:pre-wrap;word-break:break-word}table{border-collapse:collapse;width:100%}pre{white-space:pre-wrap}</style>
            <h1>Word diff · REVIEW_REQUIRED</h1><p>Occurrence accounting is not certified source completeness or engineering approval.</p>
            <input id="search" placeholder="Search"><select id="status"><option>ALL</option></select><p id="count"></p>
            <table><thead><tr><th>Status<th>Source<th>Original<th>Target<th>Evidence<th>Reason<th>All output links</tr></thead><tbody id="rows"></tbody></table>
            <details><summary>Identity, coverage and output extras</summary><pre id="identity"></pre></details>
            <script type="application/json" id="data">${json}</script><script>${code}</script>`;
    }
    function focus(id) {
        if(!model?.isFresh()) return;
        XYIntegration.view('diffhtml');
        filter=group=tableFilter='ALL';search=id;start=0;
        document.getElementById('xy-table-filter').value='ALL';
        document.getElementById('xy-search').value=id;
        document.getElementById('xy-status').value='ALL';refresh();
    }
    return {render,focus,download,csv,report,get:()=>model,clear:()=>{model=null;}};
})();
