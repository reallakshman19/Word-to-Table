/* Real input boundary: compare wrapper or an explicit After-only adapter. */
const XYCapsAdapter = (() => {
    const esc=XYInventory.esc;
    function adapt(html) {
        const doc=XYInventory.inert(html);
        const wrappers=Array.from(doc.querySelectorAll('section.table-section'));
        const compare=wrappers.some(s=>s.querySelectorAll('.compare-col').length>=2);
        const sections=[], links=[];
        const tables=compare?wrappers.map(s=>({
            id:s.id,table:s.querySelectorAll('.compare-col')[1]?.querySelector('table'),section:s,
            title:s.querySelectorAll('.compare-col')[1]?.querySelector('.compare-col-title')?.textContent||''
        })).filter(s=>s.table && /after/i.test(s.title)):
            Array.from(doc.querySelectorAll('table')).filter(t=>!t.parentElement.closest('table'))
                .map((table,i)=>({id:table.closest('section')?.id||'xy-table-'+(i+1),table}));
        const ids=new Set();
        for(const entry of tables) {
            if(!entry.id||ids.has(entry.id)) throw Error('Duplicate or missing section identity.');
            ids.add(entry.id);
            const table=entry.table;
            if(table.querySelector('table')) throw Error('Nested HTML tables require a qualified adapter.');
            if(compare) {
                sections.push(entry.section.outerHTML);
                collect(entry,links,true);
            } else {
                sections.push(afterOnly(entry,links));
            }
        }
        if(!tables.length) throw Error('No supported After tables found.');
        return {html:sections.join('\n'),links,mode:compare?'COMPARE_WRAPPER':'AFTER_ONLY',
            beforeAvailable:compare,sections:tables.length,
            limitations:compare?[]:['Before source was not supplied; empty adapter column is a position marker, not invented Before evidence.']};
    }
    function collect(entry,links,hasMarker) {
        for(const region of ['thead','tbody']) {
            const rows=Array.from(entry.table.querySelectorAll(region+' > tr'));
            rows.forEach((row,ri)=>{
                const cells=Array.from(row.cells);
                const shift=hasMarker && /^(H|\d+)$/.test(cells[0]?.textContent.trim())?1:0;
                cells.slice(shift).forEach((cell,ci)=>links.push({section_id:entry.id,region,row:ri,column:ci,
                    text:cell.textContent,htmlPath:XYInventory.path(cell),
                    sourceIds:(cell.getAttribute('data-xy-sources')||'').split(' ').filter(Boolean)}));
            });
        }
    }
    function afterOnly(entry,links) {
        let header='',body='';
        let hr=0,br=0;
        for(const row of entry.table.rows) {
            const isHeader=row.parentElement.tagName==='THEAD';
            const ri=isHeader?hr++:br++,region=isHeader?'thead':'tbody';
            const cells=Array.from(row.cells).filter(c=>!c.classList.contains('row-idx'));
            const out='<tr><td>'+ (isHeader?'H':ri+1)+'</td>'+cells.map((cell,ci)=>{
                links.push({section_id:entry.id,region,row:ri,column:ci,text:cell.textContent,
                    htmlPath:XYInventory.path(cell),sourceIds:(cell.getAttribute('data-xy-sources')||'').split(' ').filter(Boolean)});
                return '<td>'+esc(cell.textContent)+'</td>';
            }).join('')+'</tr>';
            if(isHeader) header+=out;else body+=out;
        }
        return `<section class="table-section" id="${esc(entry.id)}"><div class="compare-col"><div class="compare-col-title">Before not supplied</div></div>`+
            `<div class="compare-col"><div class="compare-col-title">After</div><table><thead>${header}</thead><tbody>${body}</tbody></table></div></section>`;
    }
    function primary(link,adapter) {
        return adapter.links.find(s=>s.section_id===link?.section_id && s.region===link.region && s.row===link.row && s.column===link.column)||null;
    }
    function field(row,column,link,adapter,cfg,audit) {
        const origin=primary(link,adapter);
        const evidence={column,value:row[column],status:'UNRESOLVED_FIELD_LINEAGE',rule:link?.rule_id||null,
            primaryContext:origin,wordSources:[],dependencies:[]};
        if(column==='MESC number' && origin) {
            let expected=origin.text.trim();
            const inputs=[origin];
            if(link.rule_id==='MATRIX_PREFIX_SUFFIX/v1') {
                const prefix=primary({...link,column:2},adapter);
                if(prefix) {const p=prefix.text.replace(/\s+/g,'');expected=p+expected.padStart(10-p.length,'0');inputs.push(prefix);}
            }
            if(/^\d{10}$/.test(expected) && expected===String(row[column])) {
                evidence.status='OBSERVED_HTML_DERIVATION';evidence.dependencies=inputs;
                // Imported attributes are not trusted; only the exact current Y target/run can authenticate them.
                if(audit?.receipt && audit.isFresh()) {
                    const ids=inputs.flatMap(x=>x.sourceIds);
                    evidence.wordSources=audit.items.filter(s=>ids.includes(s.id)&&s.evidence==='OBSERVED_EMISSION');
                }
            }
        } else if(column==='Comp. code' && row[column]===(cfg.general.comp_code_default||'E&P')) {
            evidence.status='OBSERVED_CONFIG_DERIVATION';
            evidence.dependencies=[{path:'general.comp_code_default',value:cfg.general.comp_code_default}];
        } else if(column==='Size 1 (DN)' && link?.rule_id==='THERMOWELL_FIXED_DN50/v1' && row[column]===50) {
            evidence.status='OBSERVED_RULE_DERIVATION';
            evidence.dependencies=[{rule:link.rule_id,parameter:'fixed_dn',value:50}];
        } else if(column==='Size 1 (NPS)' && row[column]===cfg.dn_to_nps_map[String(row['Size 1 (DN)'])]) {
            const fixed=link?.rule_id==='THERMOWELL_FIXED_DN50/v1' && row['Size 1 (DN)']===50;
            evidence.status=fixed?'OBSERVED_RULE_AND_CONFIG_LOOKUP':'CONFIG_LOOKUP_INPUT_LINEAGE_UNRESOLVED';
            evidence.dependencies=[{path:'dn_to_nps_map.'+row['Size 1 (DN)'],value:row[column]},
                {field:'Size 1 (DN)',value:row['Size 1 (DN)'],rule:fixed?link.rule_id:null,status:fixed?'RULE_CONSTANT':'UPSTREAM_UNVERIFIED'}];
        }
        return evidence;
    }
    return {adapt,primary,field};
})();
