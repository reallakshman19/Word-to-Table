// Real Chrome; fixture content is synthetic. Private source paths are runtime inputs only.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(process.env.XY_SITE_ROOT||path.join(__dirname,'../prototype'));
const report={checks:[],errors:[]};
function check(name,value){assert.ok(value,name);report.checks.push(name);}
async function load(page,body,name='synthetic.docx'){
    const data=await page.evaluate(async body=>{
        const zip=new JSZip();zip.file('word/document.xml',
            `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
        return zip.generateAsync({type:'base64'});
    },body);
    await page.setInputFiles('#fileInput',{name,mimeType:'application/octet-stream',buffer:Buffer.from(data,'base64')});
    await page.waitForFunction(()=>document.querySelector('#statusMsg').textContent.startsWith('Done'));
}
const cell=text=>`<w:tc><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
const row=(...text)=>'<w:tr>'+text.map(cell).join('')+'</w:tr>';
async function checkY(page,browser){
        const body='<w:p><w:r><w:t>unstructured note</w:t></w:r></w:p><w:tbl>'+row('First','Second')+row('same','same')+row('031','A&amp;B')+'</w:tbl>';
        await load(page,body);
        await page.click('#xy-tab-diffhtml');await page.click('#xy-run-selected');
        await page.waitForSelector('#xy-json');
        let audit=await page.evaluate(()=>XYAuditUI.get());
        check('all six canonical cells and raw paragraph retained',audit.sourceTotal===7);
        check('same-text source cells remain separate',audit.items.filter(s=>s.text==='same').length===2);
        check('raw paragraph remains a visible orphan',audit.items.some(s=>s.kind==='paragraph'&&s.status==='MISSING'));
        check('actual selected serialization has observed links',audit.items.filter(s=>s.evidence==='OBSERVED_EMISSION').length===6);
        check('Word dashboard summarizes live audit counts',await page.locator('.xy-stat-card').count()===5);
        await page.click('[data-audit-filter="missing"]');
        check('Not represented filter isolates raw orphan text',await page.locator('#xy-items .xy-record-card').count()===1&&(await page.textContent('#xy-items')).includes('unstructured note'));
        await page.click('[data-audit-filter="ALL"]');
        if(process.env.XY_REPORT_DIR)await page.screenshot({path:path.join(process.env.XY_REPORT_DIR,'y-workspace.png'),fullPage:true});
        await page.fill('#xy-search','unstructured');
        const download=page.waitForEvent('download');await page.click('#xy-report');
        const saved=await download;const exportPath=path.join(process.env.XY_REPORT_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'d2t-audit-')),'offline-audit.html');
        await saved.saveAs(exportPath);
        const offline=await browser.newPage();await offline.goto('file:///'+exportPath.replace(/\\/g,'/'));
        check('filtered export reopens with all seven items',await offline.locator('#rows tr').count()===7);await offline.close();
        await page.setInputFiles('#xy-upload',{name:'companion.html',mimeType:'text/html',buffer:Buffer.from('<table><tr><td>First</td><td>Second</td></tr><tr><td>catalog</td><td>same</td></tr></table><script>window.injected=true</script>')});
        await page.waitForFunction(()=>XYAuditUI.get()?.mode==='UPLOADED_HTML');
        audit=await page.evaluate(()=>XYAuditUI.get());
        check('uploaded companion cannot claim observed emissions',audit.items.every(s=>s.evidence!=='OBSERVED_EMISSION'));
        check('hostile uploaded script stays inert',!await page.evaluate(()=>window.injected));
        await page.click('#xy-generated');await page.waitForFunction(()=>XYAuditUI.get()?.mode==='CURRENT_SELECTION');
        await page.click('#xy-tab-tables');
        await page.selectOption('#headerRows','2');await page.click('#xy-tab-diffhtml');
        check('manual header changes invalidate previous audit',await page.evaluate(()=>!XYAuditUI.get()?.isFresh()));
        await page.click('#xy-run-selected');await page.waitForFunction(()=>XYAuditUI.get()?.isFresh());
        check('both manual header contributors have output links',await page.evaluate(()=>XYAuditUI.get().items.filter(s=>s.row===1).every(s=>s.evidence==='OBSERVED_EMISSION')));
        await page.click('#xy-tab-tables');await page.click('#btnBatchRun');await page.click('#xy-tab-diffhtml');await page.click('#xy-run-batch');
        await page.waitForFunction(()=>XYAuditUI.get()?.mode==='LAST_BATCH');
        check('batch output joins the same audit workflow',await page.evaluate(()=>XYAuditUI.get().receipt.events.length>0));
}
async function checkX(page){
        await page.click('#xy-tab-tables');
        await load(page,'<w:tbl>'+row('Thermowell','MESC')+row('100','1000000001')+row('200','1000000002')+'</w:tbl>','thermowell.docx');
        await page.click('#xy-tab-diffhtml');await page.click('#xy-run-selected');
        await page.waitForFunction(()=>XYAuditUI.get()?.isFresh());
        await page.click('#xy-tab-caps');await page.click('#caps-audit');await page.waitForFunction(()=>!!XYCaps.get());
        let caps=await page.evaluate(()=>XYCaps.evidence());
        check('Word -> current table -> Y -> CAPS produces records',caps.records.length===2&&caps.columns.length===30);
        check('CAPS direct field links to original Word',caps.fields.find(f=>f.column==='MESC number').wordSources.length===1);
        check('CAPS unresolved fields and raw HTML cells remain inspectable',caps.fields.some(f=>f.status==='UNRESOLVED_FIELD_LINEAGE')&&caps.sourceDispositions.some(s=>s.status==='UNCLASSIFIED_RAW'));
        check('After-only adapter never invents Before evidence',!caps.adapter.beforeAvailable);
        check('CAPS restores summary cards and five functional workspaces',await page.locator('.caps-kpi-card').count()===4&&await page.locator('[data-caps-tab]').count()===5);
        await page.fill('#caps-search','1000000002');
        check('catalog search filters actual component rows',await page.locator('#caps-results .caps-catalog-table tbody tr').count()===1);
        await page.click('#caps-reset-filters');
        check('catalog reset restores all component rows',await page.locator('#caps-results .caps-catalog-table tbody tr').count()===2);
        await page.click('[data-caps-tab="source"]');
        check('Input sections displays actual header/body counts',(await page.textContent('#caps-sections')).includes('After-only input')&&await page.locator('#caps-sections tbody td').nth(3).textContent()==='2');
        await page.click('[data-caps-tab="catalog"]');
        if(process.env.XY_REPORT_DIR)await page.screenshot({path:path.join(process.env.XY_REPORT_DIR,'x-workspace.png'),fullPage:true});
        await page.click('.caps-value[data-row="0"][data-col="26"]');
        await page.getByText('Open original Word evidence',{exact:true}).click();
        check('CAPS field navigates to exact source occurrence',await page.locator('#xy-items .xy-record-card').count()===1);
        await checkCatalogControls(page);
        await checkCurrentCSV(page);
        if(process.env.XY_PRIVATE_COMPARE){
            await page.click('#xy-tab-caps');await page.setInputFiles('#caps-upload',process.env.XY_PRIVATE_COMPARE);
            await page.waitForFunction(()=>XYCaps.get()?.input.source==='UPLOAD');
            caps=await page.evaluate(()=>XYCaps.evidence());
            check('registered input retains 458 records plus 29 suppressions',caps.records.length===458&&caps.native.raw_audit.length===487&&caps.native.legacy_collisions===29);
            check('all 13740 emitted field slots have dispositions',caps.fields.length===13740);
            const suppressed=caps.native.raw_audit.filter(r=>r.disposition==='SUPPRESSED_UNRESOLVED');
            check('all suppressed occurrences retain original values and source evidence',suppressed.length===29&&suppressed.every(r=>r.source&&Object.keys(r.record).length===30));
            await page.click('#caps-csv');
            check('provisional CSV is blocked without acknowledgement',(await page.textContent('#caps-state')).includes('blocked'));
            const evidenceDownload=page.waitForEvent('download');await page.click('#caps-evidence');
            const evidence=JSON.parse(fs.readFileSync(await(await evidenceDownload).path(),'utf8'));
            check('CAPS export includes all field slots and original raw input',evidence.fields.length===13740&&evidence.rawInput.length>100000);
            if(process.env.XY_PRIVATE_CSV){
                await page.setInputFiles('#caps-reference',process.env.XY_PRIVATE_CSV);
                await page.waitForFunction(()=>XYCaps.get()?.provisionalEligible||/failed|rejected/.test(document.getElementById('caps-state').textContent));
                check('private frozen reference matches newly computed values',await page.evaluate(()=>XYCaps.get()?.provisionalEligible===true));
                await page.check('#caps-ack');const csvDownload=page.waitForEvent('download');await page.click('#caps-csv');
                const actual=fs.readFileSync(await(await csvDownload).path());
                check('explicit provisional CSV preserves frozen bytes',require('node:crypto').createHash('sha256').update(actual).digest('hex')==='12f075fa873ac937fe8e07e60d0481b2caf3356467d9879a2ca4cac532d1a282');
            }
            await checkResponsive(page);await page.setViewportSize({width:1440,height:1000});await page.click('#xy-tab-caps');
            await page.click('[data-caps-tab="config"]');
            await page.getByText('Transformation config / explicit metadata defaults',{exact:true}).click();
            await page.fill('#caps-config','{}');await page.click('#caps-config-apply');
            check('invalid config clears prior CAPS result',await page.evaluate(()=>XYCaps.get()===null));
        }
}
async function checkCatalogControls(page){
    await page.click('#xy-tab-caps');await page.click('#caps-close-inspector');
    await page.click('[data-caps-tab="config"]');
    const code='[data-cfg-group="general"][data-cfg-key="comp_code_default"]';
    await page.fill(code,'CUSTOM');await page.click('#caps-csv');
    check('structured config edits block stale exports',(await page.textContent('#caps-state')).includes('Stale'));
    await page.click('#caps-config-apply');
    await page.waitForFunction(()=>XYCaps.get()?.data.records.every(r=>r['Comp. code']==='CUSTOM'));
    check('structured config changes reach the real transformer',await page.evaluate(()=>XYCaps.get().data.records.length===2));
    await page.click('[data-caps-tab="config"]');await page.fill(code,'E&P');await page.click('#caps-config-apply');
    await page.waitForFunction(()=>XYCaps.get()?.data.records.every(r=>r['Comp. code']==='E&P'));
    const sha=await page.evaluate(()=>XYIntegration.source().inventory.sha);
    await page.evaluate(()=>{
        const html='<table><thead><tr><th>Thermowell</th><th>MESC</th></tr></thead><tbody><tr><td>100</td><td>1000000001</td></tr><tr><td>200</td><td>1000000002</td></tr></tbody></table>';
        const transfer=new DataTransfer();transfer.items.add(new File([html],'synthetic_after.html',{type:'text/html'}));
        document.querySelector('.caps-intake').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
    });
    await page.waitForFunction(()=>XYCaps.get()?.input.name==='synthetic_after.html');
    check('CAPS HTML drop retains the existing Word evidence',await page.evaluate(sha=>XYIntegration.source().inventory.sha===sha&&XYAuditUI.get().isFresh(),sha));
}
async function checkCurrentCSV(page){
    await page.click('#caps-generated');await page.waitForFunction(()=>XYCaps.get()?.input.source==='GENERATED');
    await page.click('#caps-csv');
    check('current generated CSV still requires acknowledgement',(await page.textContent('#caps-state')).includes('acknowledge'));
    await page.fill('#caps-search','1000000002');await page.check('#caps-ack');
    const pending=page.waitForEvent('download');await page.click('#caps-csv');const download=await pending;
    const text=fs.readFileSync(await download.path(),'utf8');
    const parsed=await page.evaluate(text=>XYCapsReference.parse(text),text);
    check('generated HTML downloads a complete 30-column provisional CSV',parsed.length===3&&parsed.every(r=>r.length===30));
    check('filtered catalog export retains every computed row',parsed.slice(1).some(r=>r[26]==='1000000001')&&parsed.slice(1).some(r=>r[26]==='1000000002'));
    check('download remains visibly provisional and unapproved',download.suggestedFilename().includes('PROVISIONAL_UNAPPROVED')&&(await page.textContent('#caps-state')).includes('Downloaded provisional CSV'));
    check('generic download does not enable validated export',await page.evaluate(()=>XYCaps.get().identity.validated===false&&XYCaps.get().data.traceability.validated_export_allowed===false));
    await page.click('#caps-reset-filters');
}
async function checkResponsive(page){
    for(const [width,height] of [[1440,1000],[390,844]]){
        await page.setViewportSize({width,height});
        for(const view of ['caps','diffhtml']){
            await page.click('#xy-tab-'+view);
            const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
            check(`${view} workspace contains horizontal scrolling at ${width}px`,!overflow);
            if(process.env.XY_REPORT_DIR)await page.screenshot({path:path.join(process.env.XY_REPORT_DIR,`${view}-${width}.png`)});
        }
    }
}
async function checkPrivateSource(page){
        if(process.env.XY_PRIVATE_DOCX){
            await page.click('#xy-tab-tables');
            await page.setInputFiles('#fileInput',process.env.XY_PRIVATE_DOCX);
            await page.waitForFunction(()=>document.querySelector('#statusMsg').textContent.startsWith('Done'));
            await page.click('#xy-tab-diffhtml');await page.setInputFiles('#xy-upload',process.env.XY_PRIVATE_AFTER);
            await page.waitForFunction(()=>XYAuditUI.get()?.mode==='UPLOADED_HTML');
            const counts=await page.evaluate(()=>({cells:XYAuditUI.get().items.filter(s=>s.kind==='cell').length,paragraphs:XYAuditUI.get().items.filter(s=>s.kind==='paragraph').length,sha:XYAuditUI.get().identity.sourceSha}));
            check('private inventory preserves canonical cells and additional unsupported paragraphs',counts.cells===2751&&counts.paragraphs===210);
            check('omitted source table remains explicitly unlinked',await page.evaluate(()=>XYAuditUI.get().items.filter(s=>s.table===2).every(s=>!s.outputId)));
            report.privateInventory=counts;
        }
}
async function checkNative(page){
    if(!process.env.XY_NATIVE_DOCX||!process.env.XY_NATIVE_EXPECTED)return;
    await page.click('#xy-tab-tables');await page.setInputFiles('#fileInput',process.env.XY_NATIVE_DOCX);
    await page.waitForFunction(()=>document.querySelector('#statusMsg').textContent.startsWith('Done'));
    const expected=JSON.parse(fs.readFileSync(process.env.XY_NATIVE_EXPECTED,'utf8').replace(/^\uFEFF/,''));
    const actual=await page.evaluate(expected=>{
        const tables=XYIntegration.source().result.tables;
        const mismatches=[];let recovered=0,unchanged=0,without=0,undo=true;
        for(const [key,exp] of Object.entries(expected.tables)){
            const index=Number(key.replace('#','')),table=tables.find(t=>t.physicalIndex===index);
            const desired=(exp.title_path||[]).map(({source,text,section})=>({source,text,section}));
            app.selectTableByPhysicalIndex(index);app.applyAutoHeader();app.applyRefineTableForm();
            const hr=document.getElementById('headerRows').value,ds=document.getElementById('dataStart').value;
            app.applyRecoverHeader();
            const shown=(table.titlePath||[]).map(({source,text,section})=>({source,text,section}));
            if(JSON.stringify(shown)!==JSON.stringify(desired)||Boolean(table.titleInherited)!==exp.title_inherited)mismatches.push(index);
            if(app.getCurrentRecovered()){
                recovered++;
                if(recovered===1){
                    app.undoRecoverHeader();app.undoRecoverHeader();
                    undo=document.getElementById('headerRows').value===hr&&document.getElementById('dataStart').value===ds&&!app.getCurrentRecovered();
                }
            }else if(Number(hr)>0)unchanged++;else without++;
        }
        return {tables:tables.length,titleMismatches:mismatches,recovered,unchanged,without,undo};
    },expected);
    check('real Chrome retains native table inventory',actual.tables===140);
    if(process.env.XY_NATIVE_BASELINE){
        const baseline=JSON.parse(fs.readFileSync(process.env.XY_NATIVE_BASELINE,'utf8')).baseline;
        check('native title-path discrepancies match untouched baseline',JSON.stringify(actual.titleMismatches)===JSON.stringify(baseline.after));
        report.knownIssues=[{kind:'PREEXISTING_TITLE_PATH_DISCREPANCIES',count:actual.titleMismatches.length,scope:'after native Auto / Refine / Recover; not introduced by X/Y'}];
    }else check('real Chrome title paths match private expectations',actual.titleMismatches.length===0);
    check('real Chrome preserves 15 recoveries, 25 without, 10 existing headers',actual.recovered===15&&actual.without===25&&actual.unchanged===10);
    check('real Chrome repeated Undo restores recovered header controls',actual.undo);
    report.native=actual;
}
async function main(){
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try{
        const page=await browser.newPage({acceptDownloads:true});page.on('pageerror',e=>report.errors.push(e.message));
        await page.route('https://example.test/Word-to-Table/**',async route=>{
            const rel=new URL(route.request().url()).pathname.replace('/Word-to-Table/','')||'index.html';
            const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep))return route.abort();
            if(!fs.existsSync(file))return route.fulfill({status:404,body:'Missing'});
            const contentType=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html';
            await route.fulfill({body:fs.readFileSync(file),contentType});
        });
        await page.goto('https://example.test/Word-to-Table/');
        check('Y workspace is integrated in active prototype',await page.locator('#xy-tab-diffhtml').count()===1);
        await checkY(page,browser);
        await checkX(page);
        await checkPrivateSource(page);
        await checkNative(page);
        await checkResponsive(page);
        check('no real Chrome page errors',report.errors.length===0);
    }finally{await browser.close();}
}
main().then(()=>{console.log(JSON.stringify(report,null,2));if(process.env.XY_REPORT_DIR)fs.writeFileSync(path.join(process.env.XY_REPORT_DIR,'browser.json'),JSON.stringify(report,null,2));}).catch(e=>{console.error(e);console.error(JSON.stringify(report));process.exitCode=1;});
