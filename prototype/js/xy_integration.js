/* Additive bridge for the S1.3 prototype. Existing parser and refinement remain authoritative. */
const XYIntegration=(()=>{
    let source=null,selection=null,batch=null,companion=null,epoch=0,runId=0,busy=false,mode='CURRENT_SELECTION';
    const esc=XYInventory.esc;
    function message(text){document.getElementById('xy-message').textContent=text;}
    function view(name){
        document.querySelector('.app-body').style.display=name==='tables'?'':'none';
        document.body.classList.toggle('caps-mode',name==='caps');
        for(const id of ['diffhtml','caps'])document.getElementById('tab-'+id).hidden=name!==id;
        document.querySelectorAll('.xy-tab').forEach(b=>b.setAttribute('aria-selected',String(b.id==='xy-tab-'+name)));
    }
    function generated(){return (mode==='LAST_BATCH'?batch:selection)?.html||'';}
    function invalidate(){
        epoch++;runId++;source=selection=batch=companion=null;XYAuditUI.clear();
        if(typeof XYCaps!=='undefined')XYCaps.invalidate();
        document.getElementById('xy-audit').textContent='Source changed. Generate or select a target after parsing.';
    }
    function install(){
        const parse=DocxTableParser.prototype.parse;
        DocxTableParser.prototype.parse=async function(buffer,hash){
            const token=++epoch;source=selection=batch=companion=null;XYAuditUI.clear();
            const result=await parse.call(this,buffer,hash);
            try{
                const inventory=await XYInventory.source(buffer);
                if(token===epoch)source={inventory,bytes:buffer,result};
            }catch(e){message('Source inventory unavailable: '+e.message);}
            return result;
        };
        const exportTable=CsvExporter.prototype.exportTable;
        CsvExporter.prototype.exportTable=function(table,headerRows,dataStart,options={}){
            const result=exportTable.call(this,table,headerRows,dataStart,options);
            if(!busy&&source&&table.sourceFileHash===source.inventory.sha)
                selection=XYEmission.selection(result,table,headerRows,options,source.inventory);
            return result;
        };
        const after=BatchExporter.generateAfterHtml;
        BatchExporter.generateAfterHtml=function(results,name){
            const html=after.call(this,results,name);
            if(!source)return html;
            busy=true;
            try{batch=XYEmission.batch(html,results,source.inventory,new CsvExporter());return batch.html;}
            finally{busy=false;}
        };
    }
    async function run(nextMode){
        if(nextMode){mode=nextMode;companion=null;}
        const origin=source,chosen=companion||(mode==='LAST_BATCH'?batch:selection),token=++runId;
        if(!origin)return message('Open a DOCX in Tables first.');
        if(!chosen)return message(mode==='LAST_BATCH'?'Run Batch in Tables first.':'Select a table in Tables first.');
        message('Reconciling original occurrences…');
        try{
            const targetHtml=chosen.html,targetSha=await XYInventory.hash(chosen.bytes||targetHtml);
            if(token!==runId||source!==origin)return;
            const receipt=companion?null:chosen;
            const result=XYCompare.compare(origin.inventory.items,XYInventory.output(targetHtml,targetSha),receipt);
            const currentMode=companion?'UPLOADED_HTML':mode;
            const model={...result,receipt,inventory:origin.inventory,targetHtml,targetFile:chosen.file||null,
                sourceFile:new Blob([origin.bytes]),mode:currentMode,
                identity:{schema:'xy-audit/v2',sourceSha:origin.inventory.sha,targetSha,mode:currentMode,time:new Date().toISOString()},
                isFresh:()=>source===origin&&(companion||((mode==='LAST_BATCH'?batch:selection)))===chosen};
            XYAuditUI.render(model);message('Audit ready. Unrepresented source content remains in the raw ledger.');
        }catch(e){if(token===runId)message('Audit failed: '+e.message);}
    }
    async function upload(file){
        if(!file)return;
        if(file.size>25*1024*1024)return message('HTML exceeds 25 MiB limit.');
        const token=++runId,origin=source;XYAuditUI.clear();
        try{
            const bytes=await file.arrayBuffer();if(token!==runId||origin!==source)return;
            companion={bytes,html:new TextDecoder().decode(bytes),file};await run();
        }catch(e){if(token===runId)message('HTML read failed: '+e.message);}
    }
    function init(){
        const nav=document.createElement('nav');nav.className='xy-tabs';
        nav.innerHTML=[['tables','Tables'],['caps','CAPS'],['diffhtml','Word/HTML diff']].map(([name,label],i)=>`<button class="xy-tab" id="xy-tab-${name}" aria-selected="${i===0}">${label}</button>`).join('');
        document.querySelector('.status-bar').after(nav);
        const y=document.createElement('section');y.id='tab-diffhtml';y.hidden=true;
        y.innerHTML='<div class="xy-panel"><div class="xy-workspace-header"><div><span class="xy-eyebrow">DOC2TABLE · WORD EVIDENCE</span><h2>Trace the source. Review the result.</h2><p>Compare your original Word document with the actual HTML output.</p></div><div class="xy-workspace-actions">'+
            '<button id="xy-run-selected" class="xy-primary">↗ Audit current table</button><button id="xy-run-batch">Audit last batch</button>'+
            '<label class="xy-upload-button">＋ Target HTML<input id="xy-upload" class="xy-file-input" type="file" accept=".html,.htm"></label></div></div>'+
            '<p id="xy-message">Open a DOCX in Tables, then choose the output to inspect.</p></div><div id="xy-audit"></div>';
        nav.after(y);const x=document.createElement('section');x.id='tab-caps';x.hidden=true;y.after(x);
        ['tables','diffhtml','caps'].forEach(name=>document.getElementById('xy-tab-'+name).onclick=()=>view(name));
        document.getElementById('xy-run-selected').onclick=()=>run('CURRENT_SELECTION');
        document.getElementById('xy-run-batch').onclick=()=>run('LAST_BATCH');
        document.getElementById('xy-upload').onchange=e=>upload(e.target.files[0]);
        document.getElementById('fileInput').addEventListener('change',invalidate,true);
        document.body.addEventListener('drop',e=>{if(Array.from(e.dataTransfer.files).some(f=>/\.docx$/i.test(f.name)))invalidate();},true);
        install();XYAuditUI.render();
        if(typeof XYCaps!=='undefined')XYCaps.render();
    }
    init();return {run,generated,view,message,source:()=>source,clearCompanion:()=>{companion=null;run();}};
})();
