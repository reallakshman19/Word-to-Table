/* CAPS integration: supplied engine, explicit input/config identity, visible unresolved fields. */
const XYCaps = (() => {
    let state=null, generation=0, input=null, start=0, reference=null;
    let cfg=JSON.parse(JSON.stringify(XYCapsDefaults));
    const esc=XYInventory.esc;
    const referenceInput='f4bf84a65812bd84299289e550a804e6ab0f006fc327a6ceeaa6e2a90b350175';
    const referenceCSV='12f075fa873ac937fe8e07e60d0481b2caf3356467d9879a2ca4cac532d1a282';
    function render() {
        const host=document.getElementById('tab-caps');
        host.innerHTML=XYCapsView.shell(cfg);XYCapsView.bindShell();
        host.querySelector('#caps-generated').onclick=()=>fromCurrent(false);
        host.querySelector('#caps-original').onclick=()=>{if(input)XYAuditUI.download(new Blob([input.bytes]),'caps_original_input.html','text/html');};
        host.querySelector('#caps-audit').onclick=()=>fromCurrent(true);
        host.querySelector('#caps-upload').onchange=async e=>{
            const f=e.target.files[0];if(!f) return;
            if(f.size>25*1024*1024) return message('HTML exceeds 25 MiB limit.');
            const token=++generation;state=null;
            const bytes=await f.arrayBuffer();if(token!==generation)return;
            input={text:new TextDecoder().decode(bytes),bytes,name:f.name,audit:null,source:'UPLOAD'};
            await run();
        };
        const drop=host.querySelector('.caps-intake');
        drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag-over');};
        drop.ondragleave=()=>drop.classList.remove('drag-over');
        drop.ondrop=e=>{
            drop.classList.remove('drag-over');
            if(!/\.html?$/i.test(e.dataTransfer.files[0]?.name||''))return;
            e.preventDefault();e.stopPropagation();host.querySelector('#caps-upload').onchange({target:{files:e.dataTransfer.files}});
        };
        host.querySelector('#caps-config-apply').onclick=()=>{
            try {const next=JSON.parse(host.querySelector('#caps-config').value);validate(next);cfg=next;state=null;run();}
            catch(error){state=null;show();message(error.message);}
        };
        host.querySelector('#caps-config-reset').onclick=()=>{
            reference=null;cfg=JSON.parse(JSON.stringify(XYCapsDefaults));invalidate();render();
        };
        host.querySelector('#caps-reference').onchange=async e=>{
            const file=e.target.files[0];if(!file)return;
            const token=++generation;state=null;show();
            try {
                const loaded=await XYCapsReference.load(file);if(token!==generation)return;
                reference=loaded;cfg=XYCapsReference.profile(cfg,loaded);
                host.querySelector('#caps-config').value=JSON.stringify(cfg,null,2);await run();
            } catch(error){if(token===generation)message('Reference rejected: '+error.message);}
        };
        show();
    }
    function validate(c) {
        if(!c || typeof c!=='object' || Array.isArray(c)) throw Error('Config must be an object.');
        for(const key of ['general','dn_to_nps_map','bolt_fractions_map','bolt_length_mm_to_in_map','appl_code_defaults','bolting_rules']) {
            if(!c[key]||typeof c[key]!=='object'||Array.isArray(c[key])) throw Error('Missing config object: '+key);
        }
        if(!Array.isArray(c.bolting_rules.type_mappings)) throw Error('Bolting type mappings must be a list.');
    }
    async function fromCurrent(useAudit) {
        const audit=useAudit?XYAuditUI.get():null;
        if(useAudit && (!audit || !audit.isFresh())) return message('Run Word/HTML diff with the current inputs first.');
        const text=audit?audit.targetHtml:XYIntegration.generated();
        if(!text) return message('Generate table HTML first or upload HTML.');
        const possible=XYAuditUI.get();
        const bytes=audit?.targetFile?await audit.targetFile.arrayBuffer():new TextEncoder().encode(text);
        input={text,bytes,name:useAudit?'Word/HTML diff target':'Current generated HTML',
            audit:audit||(possible?.isFresh()&&possible.targetHtml===text?possible:null),source:useAudit?'Y':'GENERATED'};
        run();
    }
    function fresh() {
        if(!state || state.configText!==JSON.stringify(cfg)) return false;
        if(state.input.source==='Y') return state.input.audit?.isFresh()===true;
        if(state.input.source==='GENERATED') return state.input.text===XYIntegration.generated();
        return true;
    }
    async function run() {
        if(!input) return message('Choose HTML first.');
        const token=++generation, selected=input, configText=JSON.stringify(cfg);
        state=null;message('Transforming selected HTML…');
        try {
            const adapter=XYCapsAdapter.adapt(selected.text);
            const digest=await XYInventory.hash(selected.bytes);
            if(reference && digest!==referenceInput)throw Error('Private reference profile belongs to the registered input. Reset config before using another source.');
            const cfgHash=await XYInventory.hash(configText);
            // The exact registered wrapper retains the supplied engine's original entity handling.
            // Its bytes are hashed first and processed as a string, never executed or injected.
            const data=XYCapsEngine.transform(digest===referenceInput?selected.text:adapter.html,cfg);
            if(token!==generation || input!==selected || configText!==JSON.stringify(cfg)) return;
            let csv=canonicalCSV(data.records),referenceBinding=null;
            if(reference && digest===referenceInput) {
                const order=XYCapsReference.reconcile(data.records,reference);
                data.records=order.map(i=>data.records[i]);
                data.source_links=order.map(i=>data.source_links[i]);
                csv=reference.text;
                referenceBinding={sha:reference.sha,method:'computed 30-field multiset equality; declared numeric measures normalize 15/15.0 formatting, identifiers stay exact; reference ordering/serialization, no values replaced'};
            }
            const csvHash=await XYInventory.hash(csv);
            if(token!==generation || input!==selected || configText!==JSON.stringify(cfg)) return;
            start=0;state={input:selected,configText,adapter,data,csv,referenceBinding,
                identity:{schema:'xy-caps/v1',inputSha:digest,configSha:cfgHash,outputSha:csvHash,
                    inputName:selected.name,adapter:adapter.mode,validated:false,time:new Date().toISOString()},
                provisionalEligible:digest===referenceInput && csvHash===referenceCSV};
            document.getElementById('caps-ack').checked=false;
            XYCapsView.reset();XYCapsView.activate('catalog');show();
        } catch(error) {if(token===generation){state=null;show();message('Transformation failed: '+error.message);}}
    }
    function message(text) {const el=document.getElementById('caps-state');if(el)el.textContent=text;}
    function show() {
        const host=document.getElementById('caps-results');if(!host)return;
        const root=document.getElementById('tab-caps');
        const raw=document.getElementById('caps-raw-preview');if(raw)raw.textContent=input?.text.slice(0,20000)||'No input selected.';
        XYCapsView.summary(state);
        if(!state){
            for(const id of ['caps-results','caps-quality','caps-collisions','caps-sections'])
                document.getElementById(id).innerHTML='<div class="caps-empty">Choose HTML or continue with your Word output to explore the catalog.</div>';
            document.getElementById('caps-inspector').hidden=true;return;
        }
        if(!state.fieldCounts){
            const counts={};
            state.data.records.forEach((row,i)=>XYCapsColumns.forEach(column=>{
                const e=XYCapsAdapter.field(row,column,state.data.source_links[i],state.adapter,cfg,state.input.audit);
                const key=e.status==='UNRESOLVED_FIELD_LINEAGE'?(row[column]===null||row[column]===''?'UNTRACED_BLANK':'UNTRACED_POPULATED'):e.status;
                counts[key]=(counts[key]||0)+1;
            }));state.fieldCounts=counts;
        }
        const list=XYCapsView.indices(state),pageSize=XYCapsView.pageSize();
        start=Math.min(start,Math.max(0,Math.ceil(list.length/pageSize)-1)*pageSize);
        host.innerHTML=XYCapsView.catalog(state,start);
        document.getElementById('caps-quality').innerHTML=XYCapsView.quality(state);
        document.getElementById('caps-collisions').innerHTML=XYCapsView.collisions(state);
        document.getElementById('caps-sections').innerHTML=XYCapsView.sections(state);
        message(`${state.data.records.length} records · ${state.data.legacy_collisions} suppressed · ${state.adapter.beforeAvailable?'Compare HTML':'After-only HTML'}. Validated export blocked.`);
        XYCapsView.bindCatalog(()=>{start=0;show();});
        host.querySelector('#caps-prev').onclick=()=>{start=Math.max(0,start-pageSize);show();};
        host.querySelector('#caps-next').onclick=()=>{start+=pageSize;show();};
        host.querySelectorAll('.caps-value').forEach(b=>b.onclick=()=>select(Number(b.dataset.row),Number(b.dataset.col)));
        root.querySelector('#caps-evidence').onclick=()=>{if(checkFresh())XYAuditUI.download(JSON.stringify(evidence(),null,2),'CAPS_REVIEW_REQUIRED_evidence.json','application/json');};
        root.querySelector('#caps-csv').onclick=()=>{
            if(!checkFresh())return;
            try{
                const file=XYCapsExport.prepare(state,{fresh:true,acknowledged:root.querySelector('#caps-ack').checked});
                XYAuditUI.download(file.csv,file.name,'text/csv');
                message(`Downloaded provisional CSV: ${file.rows} rows. Unresolved fields and ${state.data.legacy_collisions} suppressed records remain in Evidence JSON. Validated export blocked.`);
            }catch(error){message('CSV blocked: '+error.message);}
        };
    }
    function checkFresh() {
        const editing=document.getElementById('caps-config');
        if(!fresh() || (editing && editing.value!==JSON.stringify(cfg,null,2))) {
            message('Stale input/config — apply config or transform again.');return false;
        }
        return true;
    }
    function select(i,j) {
        if(!checkFresh())return;
        const e=XYCapsAdapter.field(state.data.records[i],XYCapsColumns[j],state.data.source_links[i],state.adapter,cfg,state.input.audit);
        XYCapsView.field(e);
        const links=document.getElementById('caps-word-links');links.replaceChildren();
        for(const source of e.wordSources) {
            const button=document.createElement('button');button.textContent='Open original Word evidence';
            button.onclick=()=>XYAuditUI.focus(source.id);links.append(button);
        }
    }
    function evidence() {
        const fields=state.data.records.flatMap((r,i)=>XYCapsColumns.map(c=>({row:i,...XYCapsAdapter.field(r,c,state.data.source_links[i],state.adapter,cfg,state.input.audit)})));
        const sourceDispositions=state.adapter.links.map(s=>{
            const referencingRows=state.data.source_links.flatMap((link,i)=>
                XYCapsAdapter.primary(link,state.adapter)===s?[i]:[]);
            return {...s,status:referencingRows.length?'PRIMARY_RECORD_CONTEXT':'UNCLASSIFIED_RAW',referencingRows};
        });
        return {identity:state.identity,referenceBinding:state.referenceBinding,config:cfg,columns:XYCapsColumns,records:state.data.records,fields,
            native:state.data,adapter:state.adapter,sourceDispositions,rawInput:state.input.text,
            review:'REVIEW_REQUIRED; not certified engineering values; blanks and upstream gaps retained'};
    }
    function canonicalCSV(records) {
        return XYCapsExport.csv(records);
    }
    function invalidate() {generation++;state=null;if(document.getElementById('caps-results'))show();}
    return {render,invalidate,get:()=>state,evidence,canonicalCSV};
})();
