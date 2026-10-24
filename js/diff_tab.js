/* Complete v3.1 QA dashboard, using textContent for all document-derived data. */
const DiffTab = (() => {
    const state={section:'Summary',filter:'All',search:'',page:0};
    const sections=['Summary','Pages','Exceptions','Provenance'];
    const options=['All','Issues','PRESERVED_EXACT','PRESERVED_NORMALIZED','ALTERED','CANDIDATE_MATCH','FILTERED','MISSING','AMBIGUOUS','UNSUPPORTED','ERROR'];
    const add=(parent,tag,text,cls) => {
        const n=document.createElement(tag);if(cls)n.className=cls;
        if(text!==undefined)n.textContent=String(text);parent.appendChild(n);return n;
    };
    function render() {
        const el=document.getElementById('tab-diffhtml');
        if(!el)return;
        el.replaceChildren();
        const h=add(el,'h2','Source-to-output diffhtml QA');
        const audit=appState.audit;
        if(!audit) {
            add(el,'p','Extract a DOCX, then use Run Diff & QA. Unsupported content is reported explicitly.');
            return;
        }
        const meta=add(el,'p','Comparison mode: '+audit.meta.mode+' · '+(audit.meta.sourceSha256||'source hash unavailable'),'audit-muted');
        add(el,'p','Source-fidelity HOLD: compares '+audit.meta.artifactScope+
            '. Exact export bytes may be verified against selected table grids, not original DOCX occurrences.','audit-warning');
        const exports=appState.exportManifests||[];
        if(exports.length){
            add(el,'h3','Output artifact attestations');
            exports.forEach(m=>{
                add(el,'p',m.mode.toUpperCase()+' selected ['+m.selectedIndices.join(', ')+'] · '+
                    (m.preparedBytesVerified?'PRE-DOWNLOAD BYTES VERIFIED':'UNVERIFIED')+
                    ' · final disk bytes: NOT VERIFIED','audit-muted');
                m.files.forEach(item=>add(el,'p',item.filename+' · SHA-256 '+item.sha256+
                    ' · '+item.byteLength+' bytes','audit-muted'));
            });
        }
        const nav=add(el,'div',undefined,'audit-actions');
        sections.forEach(section=>{
            const b=add(nav,'button',section+(state.section===section?' ●':''));
            b.type='button';b.addEventListener('click',()=>{state.section=section;state.page=0;render();});
        });
        const results=audit.result;
        const statuses=results.statuses;
        if(state.section==='Summary') {
            const summary=add(el,'div',undefined,'audit-summary');
            [['Inventoried',results.sourceTotal],['Disposition coverage',(results.dispositionCoverage*100)+'%'],
                ['Extra output',results.extraOutput.length],['Unsupported features',results.diagnostics.length]]
                .concat(Object.entries(statuses)).forEach(pair=>{
                    const card=add(summary,'div',undefined,'audit-metric');
                    add(card,'strong',pair[1]);add(card,'span',pair[0]);
                });
            if(!results.qualified || !audit.meta.sourceSha256) {
                add(el,'p','HOLD: this report does not establish full source fidelity. Examine unresolved, unsupported and extra output.','audit-warning');
            }
        }
        if(state.section==='Pages') {
            add(el,'p','Source page hints only; Word physical pagination is not independently verified. Use source IDs and logical order.');
        }
        if(state.section==='Provenance') {
            add(el,'p','Every record shows source and target IDs. Repeated text never establishes identity by itself.');
        }
        if(results.diagnostics.length) {
            const diag=add(el,'details',undefined,'audit-diagnostics');
            add(diag,'summary','Source coverage exceptions: '+results.diagnostics.length);
            results.diagnostics.forEach(x=>add(diag,'div',(x.part||'source')+' · '+(x.feature||x.kind)));
        }
        const actions=add(el,'div',undefined,'audit-actions');
        for(const type of ['json','csv','html']) {
            const b=add(actions,'button','Export '+type.toUpperCase());b.type='button';
            b.addEventListener('click',()=>AuditExport.download(audit,type));
        }
        const filter=add(actions,'select');
        filter.setAttribute('aria-label','Audit status filter');
        options.forEach(x=>{const opt=add(filter,'option',x);opt.value=x;});
        filter.value=state.filter;
        filter.addEventListener('change',()=>{state.filter=filter.value;state.page=0;render();});
        const search=add(actions,'input');search.placeholder='Search text, source ID or status';
        search.setAttribute('aria-label','Search audit');search.value=state.search;
        search.addEventListener('input',()=>{state.search=search.value;state.page=0;drawRows();});
        const rows=add(el,'div',undefined,'audit-records');
        const footer=add(el,'div',undefined,'audit-actions');
        const prev=add(footer,'button','Previous');
        const count=add(footer,'span','');
        const next=add(footer,'button','Next');
        prev.addEventListener('click',()=>{state.page--;drawRows();});
        next.addEventListener('click',()=>{state.page++;drawRows();});
        function drawRows() {
            let filtered=results.rows;
            if(state.section==='Exceptions') filtered=filtered.filter(r=>!r.status.startsWith('PRESERVED'));
            if(state.section==='Provenance') filtered=filtered.filter(r=>r.outputId);
            if(state.filter!=='All')filtered=filtered.filter(r=>state.filter==='Issues'?
                !r.status.startsWith('PRESERVED'):r.status===state.filter);
            const q=state.search.toLowerCase();
            if(q)filtered=filtered.filter(r=>[r.sourceId,r.sourceText,r.outputText,r.status,r.reason]
                .some(v=>String(v||'').toLowerCase().includes(q)));
            const pages=Math.max(1,Math.ceil(filtered.length/100));
            state.page=Math.min(Math.max(0,state.page),pages-1);
            count.textContent='Page '+(state.page+1)+' of '+pages+' · '+filtered.length+' occurrences';
            prev.disabled=state.page===0;next.disabled=state.page===pages-1;
            rows.replaceChildren();
            filtered.slice(state.page*100,(state.page+1)*100).forEach(r=>{
                const card=add(rows,'article',undefined,'audit-record');
                add(card,'strong',r.status+' · '+r.sourceId);
                const grid=add(card,'div',undefined,'audit-pair');
                const left=add(grid,'div',undefined);
                add(left,'small','SOURCE · '+r.sourcePath);
                add(left,'pre',r.sourceText);
                const right=add(grid,'div',undefined);
                add(right,'small','OUTPUT · '+(r.outputId||'none'));
                add(right,'pre',r.outputText===null?'[No verified target]':r.outputText);
                add(card,'small',r.reason,'audit-muted');
            });
        }
        drawRows();
    }
    return {render,state};
})();