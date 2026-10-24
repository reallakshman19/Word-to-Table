/* CAPS workspace presentation, adapted from the supplied Studio; all figures use the live run. */
const XYCapsView=(()=>{
    const esc=XYInventory.esc;
    let search='',group='ALL',type='ALL',size='ALL',pageSize=25,active='catalog';
    const names=[['catalog','Catalog explorer'],['quality','Quality & evidence'],['collisions','Collision review'],['config','Configuration'],['source','Input sections']];
    const order=['Comp Group','Short name','Short name bolts','Comp Description','Comp Description bolts','Size 1 (DN)','Size 1 (NPS)','Size 2 (DN)','Size 2 (NPS)',
        ...XYCapsColumns.filter(c=>!['Comp Group','Short name','Short name bolts','Comp Description','Comp Description bolts','Size 1 (DN)','Size 1 (NPS)','Size 2 (DN)','Size 2 (NPS)'].includes(c))];
    const fileInput=(id,accept)=>`<input class="xy-file-input" id="${id}" type="file" accept="${accept}">`;
    function configFields(cfg){
        return [['general','Component code'],['appl_code_defaults','Application codes'],['dn_to_nps_map','DN → NPS lookup']].map(([key,label])=>
            `<div class="caps-config-card"><h3>${label}</h3><div class="caps-config-grid">${Object.entries(cfg[key]).filter(([k,v])=>k!=='description'&&typeof v!=='object').map(([k,v])=>
                `<label>${esc(k.replace(/_/g,' '))}<input data-cfg-group="${key}" data-cfg-key="${esc(k)}" value="${esc(v)}"></label>`).join('')}</div></div>`).join('');
    }
    function shell(cfg){
        return `<div class="caps-studio"><header class="caps-hero"><div class="caps-brand-mark">ϟ</div><div class="caps-brand"><span class="caps-eyebrow">DOC2TABLE · CATALOG WORKSPACE</span><h2>CAPS Transformation Studio</h2><p>HTML tables → 30-column catalog → source & field review</p><div class="caps-file-meta"><span>Input <strong id="caps-input-name">No file selected</strong></span><span class="caps-local">● Runs locally</span></div></div>
            <div class="caps-hero-actions"><label class="caps-button caps-primary">↑ Upload HTML${fileInput('caps-upload','.html,.htm')}</label><button id="caps-evidence">↓ Evidence JSON</button><button id="caps-csv">↓ Provisional CSV</button></div></header>
            <div class="caps-review-banner"><span class="caps-review-dot"></span><div><strong>Review required</strong><p id="caps-state">Choose HTML or use an output from the Word workspace.</p></div><label class="caps-ack"><input type="checkbox" id="caps-ack"> I understand this CSV is provisional and unapproved</label></div>
            <div class="caps-intake"><div class="caps-upload-icon">⇧</div><strong>Bring your tables into the catalog</strong><p>Upload Compare / After HTML, or continue with your Word output.</p><div><button id="caps-generated">Use current Word output</button><button id="caps-audit">Use current comparison target</button></div></div>
            <div id="caps-kpis" class="caps-kpis"></div><nav class="caps-work-tabs">${names.map(([id,label])=>`<button data-caps-tab="${id}" aria-selected="${id==='catalog'}">${label}<span id="caps-count-${id}"></span></button>`).join('')}</nav>
            <section class="caps-pane" id="caps-pane-catalog"><div id="caps-results"></div></section>
            <section class="caps-pane" id="caps-pane-quality" hidden><div id="caps-quality"></div></section>
            <section class="caps-pane" id="caps-pane-collisions" hidden><div id="caps-collisions"></div></section>
            <section class="caps-pane" id="caps-pane-config" hidden><div class="caps-section-title"><h3>Configuration & explicit rules</h3><p>Edits take effect when applied. Source-specific metadata stays blank until supplied.</p></div>${configFields(cfg)}
                <div class="caps-config-card"><h3>Private reference profile</h3><p>Optionally load the frozen CSV to compare every computed value and retain its exact serialization. It remains unapproved reference data.</p><label class="caps-button">Choose private reference CSV${fileInput('caps-reference','.csv')}</label></div>
                <details class="caps-config-card"><summary>Transformation config / explicit metadata defaults</summary><p>Advanced JSON includes metadata defaults, bolting mappings and every lookup.</p><textarea id="caps-config" aria-label="CAPS configuration">${esc(JSON.stringify(cfg,null,2))}</textarea></details>
                <div class="caps-config-actions"><button id="caps-config-apply" class="caps-primary">Apply & re-transform</button><button id="caps-config-reset">Reset config / private profile</button></div></section>
            <section class="caps-pane" id="caps-pane-source" hidden><div id="caps-sections"></div><details class="caps-config-card"><summary>Original input HTML</summary><p>Preview shows up to 20,000 characters; download preserves all original bytes.</p><button id="caps-original">↓ Original input HTML</button><pre id="caps-raw-preview"></pre></details></section>
            <aside id="caps-inspector" class="caps-inspector" hidden><header><span>FIELD & SOURCE INSPECTION</span><button id="caps-close-inspector" aria-label="Close field inspector">×</button></header><div id="caps-field"></div><div id="caps-word-links"></div></aside></div>`;
    }
    function activate(name){
        active=name;names.forEach(([id])=>{document.getElementById('caps-pane-'+id).hidden=id!==name;});
        document.querySelectorAll('[data-caps-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.capsTab===name)));
    }
    function bindShell(){
        document.querySelectorAll('[data-caps-tab]').forEach(b=>b.onclick=()=>activate(b.dataset.capsTab));
        document.getElementById('caps-close-inspector').onclick=()=>{document.getElementById('caps-inspector').hidden=true;};
        document.querySelectorAll('[data-cfg-group]').forEach(input=>input.oninput=()=>{
            const editor=document.getElementById('caps-config');
            try{const cfg=JSON.parse(editor.value),key=input.dataset.cfgKey,obj=cfg[input.dataset.cfgGroup];
                obj[key]=typeof obj[key]==='number'?Number(input.value):input.value;editor.value=JSON.stringify(cfg,null,2);
                document.getElementById('caps-state').textContent='Configuration changed. Apply & re-transform to refresh results.';
            }catch(e){document.getElementById('caps-state').textContent='Correct the advanced JSON before changing individual fields.';}
        });activate(active);
    }
    function indices(state){
        return state.data.records.flatMap((r,i)=>(group==='ALL'||r['Comp Group']===group)&&(size==='ALL'||String(r['Size 1 (DN)'])===size)&&
            (type==='ALL'||(type==='BOLTING'?!!r['Short name bolts']:!r['Short name bolts']))&&
            XYCapsColumns.map(c=>String(r[c]??'')).join(' ').toLowerCase().includes(search.toLowerCase())?[i]:[]);
    }
    function options(values,selected){return values.map(v=>`<option value="${esc(v)}" ${String(v)===selected?'selected':''}>${esc(v)}</option>`).join('');}
    function catalog(state,start){
        const records=state.data.records,list=indices(state),groups=[...new Set(records.map(r=>r['Comp Group']).filter(Boolean))].sort();
        const sizes=[...new Set(records.map(r=>r['Size 1 (DN)']).filter(v=>v!==null&&v!==''))].sort((a,b)=>a-b);
        return `<div class="caps-catalog-toolbar"><input id="caps-search" aria-label="Search catalog" placeholder="Search description, short name, MESC…" value="${esc(search)}">
            <select id="caps-group-filter" aria-label="Component group"><option value="ALL">All component groups</option>${options(groups,group)}</select>
            <select id="caps-type-filter" aria-label="Item type"><option value="ALL">All item types</option><option value="INLINE" ${type==='INLINE'?'selected':''}>Inline components</option><option value="BOLTING" ${type==='BOLTING'?'selected':''}>Bolting</option></select>
            <select id="caps-size-filter" aria-label="Primary size"><option value="ALL">All primary sizes</option>${options(sizes,size)}</select><button id="caps-reset-filters">↺ Reset</button>
            <span>${list.length?start+1:0}–${Math.min(start+pageSize,list.length)} of ${list.length} records</span></div>
            <div class="caps-catalog-scroll"><table class="caps-catalog-table"><thead><tr><th>#</th>${order.map(c=>'<th>'+esc(c)+'</th>').join('')}</tr></thead><tbody>${list.slice(start,start+pageSize).map(i=>
                `<tr><td class="caps-row-number">${i+1}</td>${order.map(c=>`<td><button class="caps-value ${c==='Comp Group'?'caps-group-badge':''}" data-row="${i}" data-col="${XYCapsColumns.indexOf(c)}">${records[i][c]===null||records[i][c]===''?'<span class="caps-blank">—</span>':esc(records[i][c])}</button></td>`).join('')}</tr>`).join('')}</tbody></table>
            ${list.length?'':'<div class="caps-empty">No matching catalog records. Try a different filter.</div>'}</div>
            <footer class="caps-pagination"><span>All 30 fields available · select a value to inspect evidence</span><label>Rows <select id="caps-page-size">${options([25,50,100],String(pageSize))}</select></label><button id="caps-prev">← Previous</button><button id="caps-next">Next →</button></footer>`;
    }
    function bindCatalog(onChange){
        const bindings=[['caps-search',v=>search=v,'oninput'],['caps-group-filter',v=>group=v,'onchange'],['caps-type-filter',v=>type=v,'onchange'],['caps-size-filter',v=>size=v,'onchange'],['caps-page-size',v=>pageSize=Number(v),'onchange']];
        for(const [id,set,event] of bindings)document.getElementById(id)[event]=e=>{
            const input=e.target,pos=input.selectionStart;set(input.value);onChange();
            if(event==='oninput'){const next=document.getElementById(id);next.focus();next.setSelectionRange(pos,pos);}
        };
        document.getElementById('caps-reset-filters').onclick=()=>{search='';group=type=size='ALL';onChange();};
    }
    function summary(state){
        const d=state?.data,records=d?.records||[],groups=[...new Set(records.map(r=>r['Comp Group']).filter(Boolean))];
        const bolts=records.filter(r=>r['Short name bolts']).length,valid=records.filter(r=>/^\d{10}$/.test(String(r['MESC number']))).length;
        const cards=[['CAPS records',d?records.length.toLocaleString():'—',d?`${records.length-bolts} inline + ${bolts} bolting`:'Awaiting selected HTML'],['Component groups',d?groups.length:'—',groups.join(' · ')||'From the current transformation'],
            ['10-digit MESC format',d&&records.length?`${(100*valid/records.length).toFixed(1)}%`:'—','Format check · not source certification'],['Suppressed records',d?d.legacy_collisions:'—',d?'All original values retained for review':'Collision evidence stays visible']];
        document.getElementById('caps-kpis').innerHTML=cards.map(([label,n,detail])=>`<article class="caps-kpi-card"><label>${label}</label><strong>${n}</strong><small>${esc(detail)}</small></article>`).join('');
        document.getElementById('caps-input-name').textContent=state?.identity.inputName||'No file selected';
        document.getElementById('caps-count-catalog').textContent=d?' '+records.length:'';
        document.getElementById('caps-count-source').textContent=d?' '+d.sections.length:'';
    }
    function quality(state){
        return `<div class="caps-section-title"><h3>Quality & field evidence</h3><p>These are measured dispositions from this run. They do not certify engineering values.</p></div>
            <div class="caps-quality-grid">${Object.entries(state.fieldCounts).map(([k,v])=>`<article class="caps-config-card"><label>${esc(k.replace(/_/g,' '))}</label><strong>${v.toLocaleString()}</strong></article>`).join('')}</div>
            <div class="caps-config-card"><h3>Export status</h3><p><strong>Validated export blocked.</strong> Provisional CSV exports all current computed rows after acknowledgement. Unresolved fields and suppressed alternatives remain in the evidence JSON. ${state.referenceBinding&&state.provisionalEligible?'The private frozen reference also matches this run.':'No frozen-reference qualification is claimed for this run.'}</p>
            <details><summary>Run identity and limitations</summary><pre>${esc(JSON.stringify({identity:state.identity,referenceBinding:state.referenceBinding,limitations:state.adapter.limitations},null,2))}</pre></details></div>`;
    }
    function collisions(state){
        const groups=new Map();state.data.raw_audit.filter(r=>r.disposition==='SUPPRESSED_UNRESOLVED').forEach(r=>{
            const k=JSON.stringify(r.retained_source);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);
        });document.getElementById('caps-count-collisions').textContent=' '+groups.size;
        return `<div class="caps-section-title"><h3>Collision review</h3><p>${groups.size} groups · ${state.data.legacy_collisions} suppressed records. No business ruling or automatic merge has been applied.</p></div>`+
            [...groups.values()].map((rows,i)=>`<details class="caps-collision-card"><summary><span>Group ${i+1}</span><strong>${esc(rows[0].record['Short name']||'Component')} · MESC ${esc(rows[0].record['MESC number'])}</strong><span>${rows.length} suppressed</span></summary>
                <p>Every suppressed record retains its values and source. Compare alternatives before deciding.</p>${rows.map(r=>`<pre>${esc(JSON.stringify(r,null,2))}</pre>`).join('')}</details>`).join('')||'<div class="caps-empty">No suppressed records in this run.</div>';
    }
    function sections(state){
        return `<div class="caps-section-title"><h3>Input sections</h3><p>${state.adapter.beforeAvailable?'Compare wrapper with Before and After panels':'After-only input · Before evidence was not supplied'}. All selected original HTML remains downloadable.</p></div>
            <div class="caps-catalog-scroll"><table class="caps-catalog-table"><thead><tr><th>Section</th><th>Classification</th><th>Header rows</th><th>Body rows</th><th>Raw HTML cells</th></tr></thead><tbody>${state.data.sections.map(s=>
                `<tr><td>${esc(s.id)}</td><td><span class="caps-group-badge">${esc(s.archetype)}</span></td><td>${s.thead_rows||0}</td><td>${s.tbody_rows||0}</td><td>${state.adapter.links.filter(l=>l.section_id===s.id).length}</td></tr>`).join('')}</tbody></table></div>`;
    }
    function field(e){
        document.getElementById('caps-inspector').hidden=false;
        document.getElementById('caps-field').innerHTML=`<h3>${esc(e.column)}</h3><div class="caps-inspector-value">${esc(e.value??'Blank')}</div><span class="caps-evidence-status">${esc(e.status.replace(/_/g,' '))}</span>
            <h4>Primary source context</h4><p>${e.primaryContext?esc(e.primaryContext.text):'No qualified source link for this field.'}</p>
            <h4>Rule & dependencies</h4><pre>${esc(JSON.stringify(e.dependencies,null,2))}</pre><details><summary>Complete field evidence</summary><pre>${esc(JSON.stringify(e,null,2))}</pre></details>`;
    }
    return {shell,bindShell,activate,indices,catalog,bindCatalog,summary,quality,collisions,sections,field,pageSize:()=>pageSize,
        reset:()=>{search='';group=type=size='ALL';}};
})();
