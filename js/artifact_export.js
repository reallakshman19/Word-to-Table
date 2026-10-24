/* Export attestation: verifies actual, selected CSV/XLSX byte buffers.
   IMPORTANT: output byte verification is NOT source DOCX fidelity. */
const ArtifactExport = (() => {
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const encoder = () => new TextEncoder();
    function escapeXml(v) {
        return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    }
    function grid(table) {
        if (!table || !Array.isArray(table.headers) || !Array.isArray(table.dataRows))
            throw new Error('Table has no exportable header/data grid');
        const n=table.headers.length;
        return [table.headers,...table.dataRows].map(row=>{
            if (!Array.isArray(row) || row.length!==n) throw new Error('Inconsistent grid width');
            return row.map(v=>String(v==null?'':v));
        });
    }
    function csvRows(raw) {
        const txt=String(raw).replace(/^\uFEFF/,'');
        let rows=[],row=[],cell='',quoted=false;
        for(let i=0;i<txt.length;i++){
            const ch=txt[i];
            if(quoted){
                if(ch==='"' && txt[i+1]==='"'){cell+='"';i++;}
                else if(ch==='"')quoted=false;
                else cell+=ch;
            }else if(ch==='"'){
                if(cell!=='')throw new Error('Invalid CSV quote');
                quoted=true;
            }else if(ch===','){row.push(cell);cell='';}
            else if(ch==='\n' || ch==='\r'){
                if(ch==='\r'&&txt[i+1]==='\n')i++;
                row.push(cell);rows.push(row);row=[];cell='';
            }else cell+=ch;
        }
        if(quoted)throw new Error('Unterminated CSV quote');
        if(row.length || cell!=='') {row.push(cell);rows.push(row);}
        return rows;
    }
    function csvText(rows) {
        return rows.map(row=>row.map(v=>{
            const s=String(v == null ? '' : v);
            return /[",\r\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
        }).join(',')).join('\r\n');
    }
    function equalRows(actual, expected) {
        return actual.length===expected.length && actual.every((r,i)=>
            r.length===expected[i].length && r.every((c,j)=>c===expected[i][j]));
    }
    function column(n) {
        let out='';n++;
        while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}
        return out;
    }
    function safeName(name) {
        return String(name||'Table').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')
            .replace(/\s+/g,'_').replace(/^\.+/,'').slice(0,70)||'Table';
    }
    function unique(base,seen,maxLen) {
        const trimmed=base.slice(0,maxLen);
        let result=trimmed,n=2;
        while(seen.has(result.toLowerCase())){
            const suffix='_'+n++;
            result=trimmed.slice(0,maxLen-suffix.length)+suffix;
        }
        seen.add(result.toLowerCase());return result;
    }
    function worksheetXml(rows) {
        let s='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
            '<worksheet xmlns="'+NS+'"><sheetData>';
        rows.forEach((row,i)=>{
            s+='<row r="'+(i+1)+'">';
            row.forEach((value,j)=>{
                // All user values are inlineStrings. Never interpret formulas.
                s+='<c r="'+column(j)+(i+1)+'" t="inlineStr"><is><t xml:space="preserve">'+
                    escapeXml(value)+'</t></is></c>';
            });
            s+='</row>';
        });
        return s+'</sheetData></worksheet>';
    }
    function workbookParts(entries,includeLogs) {
        const sheets=entries.map((e,i)=>({name:e.sheetName,xml:worksheetXml(e.rows),index:i+1}));
        if(includeLogs)sheets.push({
            name:unique('Processing_Log',new Set(sheets.map(x=>x.name.toLowerCase())),31),
            xml:worksheetXml([['Log'],['Exported '+entries.length+' selected tables']]),
            index:sheets.length+1,log:true
        });
        const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
            '<workbook xmlns="'+NS+'" xmlns:r="'+REL+'"><sheets>'+
            sheets.map(s=>'<sheet name="'+escapeXml(s.name)+'" sheetId="'+s.index+
                '" r:id="rId'+s.index+'"/>').join('')+'</sheets></workbook>';
        const rel='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
            sheets.map(s=>'<Relationship Id="rId'+s.index+
                '" Type="'+REL+'/worksheet" Target="worksheets/sheet'+s.index+'.xml"/>').join('')+
            '</Relationships>';
        const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
            '<Default Extension="xml" ContentType="application/xml"/>'+
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
            sheets.map(s=>'<Override PartName="/xl/worksheets/sheet'+s.index+
                '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+
            '</Types>';
        const rootRel='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
            '<Relationship Id="rId1" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/>'+
            '</Relationships>';
        return {sheets,workbook,rel,types,rootRel};
    }
    function xmlCheck(xml) {
        const document=new DOMParser().parseFromString(xml,'application/xml');
        if(document.getElementsByTagName('parsererror').length)
            throw new Error('Generated XLSX contains invalid XML');
        return document;
    }
    async function sha256(bytes) {
        if(!globalThis.crypto || !globalThis.crypto.subtle)
            throw new Error('Secure hashing unavailable; refusing unverifiable export');
        const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
        return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
    }
    function selectedTables(all,indices) {
        if(!Array.isArray(indices)||!indices.length)throw new Error('No tables selected');
        const seen=new Set();
        return indices.map(idx=>{
            if(!Number.isInteger(idx)||seen.has(idx)||!all[idx]) throw new Error('Invalid or repeated selected table');
            seen.add(idx);return {index:idx,table:all[idx],rows:grid(all[idx])};
        });
    }
    async function prepare(all,indices,mode,includeLogs,sourceLedger) {
        if(mode!=='individual'&&mode!=='combined')throw new Error('Unknown export mode');
        const selected=selectedTables(all,indices);
        const files=[],seen=new Set(),sheetNames=new Set();
        if(mode==='individual'){
            for(const item of selected){
                const previous=String(item.table.csv == null?'':item.table.csv);
                const staleLegacyCsv=!equalRows(csvRows(previous),item.rows);
                // Selection's current grid is authoritative; legacy cached CSV
                // may be outdated after header naming or editing.
                const raw=csvText(item.rows);
                const name=unique(safeName(item.table.tableName),seen,65)+'.csv';
                const bytes=encoder().encode('\uFEFF'+raw);
                // Verify the exact bytes prepared for download, not an alternate string.
                const checked=new TextDecoder().decode(bytes);
                if(!equalRows(csvRows(checked),item.rows))throw new Error('CSV exported bytes fail grid parity');
                files.push({name,mime:'text/csv;charset=utf-8',bytes,
                    tableIndices:[item.index],checked:true,legacyCsvRegenerated:staleLegacyCsv});
            }
            if(includeLogs){
                const bytes=encoder().encode('Export Log - '+selected.length+' tables exported.\n');
                files.push({name:'Extraction_Log.txt',mime:'text/plain;charset=utf-8',bytes,
                    tableIndices:selected.map(x=>x.index),checked:true,kind:'log'});
            }
        }else{
            if(typeof JSZip==='undefined')throw new Error('Local JSZip is required for offline XLSX');
            const entries=selected.map(item=>({...item,sheetName:unique(safeName(item.table.tableName),sheetNames,31)}));
            const parts=workbookParts(entries,includeLogs);
            const zip=new JSZip();
            zip.file('[Content_Types].xml',parts.types);
            zip.file('_rels/.rels',parts.rootRel);
            zip.file('xl/workbook.xml',parts.workbook);
            zip.file('xl/_rels/workbook.xml.rels',parts.rel);
            parts.sheets.forEach(s=>zip.file('xl/worksheets/sheet'+s.index+'.xml',s.xml));
            const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
            // Verify the exact XLSX ZIP bytes after serialization. Read back
            // each sheet's actual values in table order and refuse discrepancies.
            const readback=await JSZip.loadAsync(bytes);
            const book=xmlCheck(await readback.file('xl/workbook.xml').async('string'));
            const sheetNodes=Array.from(book.getElementsByTagNameNS(NS,'sheet'));
            if(sheetNodes.length!==parts.sheets.length)throw new Error('XLSX sheets lost or duplicated');
            for(let i=0;i<parts.sheets.length;i++){
                const part=readback.file('xl/worksheets/sheet'+(i+1)+'.xml');
                if(!part)throw new Error('XLSX sheet missing');
                const doc=xmlCheck(await part.async('string'));
                const actual=Array.from(doc.getElementsByTagNameNS(NS,'row')).map(row=>
                    Array.from(row.getElementsByTagNameNS(NS,'c')).map(cell=>{
                        if(cell.getAttribute('t')!=='inlineStr')throw new Error('Unsafe XLSX formula or cell type');
                        return Array.from(cell.getElementsByTagNameNS(NS,'t')).map(x=>x.textContent).join('');
                    }));
                const expected=i<entries.length?entries[i].rows:
                    [['Log'],['Exported '+entries.length+' selected tables']];
                if(!equalRows(actual,expected))throw new Error('XLSX byte-level roundtrip mismatch: '+parts.sheets[i].name);
                if(sheetNodes[i].getAttribute('name')!==parts.sheets[i].name)
                    throw new Error('XLSX sheet-name mismatch');
            }
            files.push({name:'Combined_Tables.xlsx',
                mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                bytes,tableIndices:selected.map(x=>x.index),checked:true,sheets:parts.sheets.map(x=>x.name)});
        }
        const sourceTables=(sourceLedger&&sourceLedger.tables||[]).filter(t=>!t.parentTableId);
        const manifestFiles=[];
        for(const file of files){
            manifestFiles.push({
                filename:file.name,kind:file.kind||mode,mediaType:file.mime,
                sha256:await sha256(file.bytes),byteLength:file.bytes.byteLength,
                tableIndices:file.tableIndices,
                sourceTableIds:file.tableIndices.map(i=>
                    sourceTables[(all[i].tableIndex||i+1)-1]?.tableId||null),
                gridParityVerified:file.checked,
                legacyCsvRegenerated:Boolean(file.legacyCsvRegenerated),
                sheets:file.sheets||null
            });
        }
        const manifest={
            schemaVersion:1,mode,selectedIndices:selected.map(x=>x.index),
            preparedBytesVerified:manifestFiles.every(x=>x.gridParityVerified),
            deliveredFileBytesVerified:false,
            originalDocxFidelityVerified:false,
            proofBoundary:'PRE_DOWNLOAD_EXACT_BYTES_VS_SELECTED_TABLE_GRID',
            files:manifestFiles
        };
        return {files,manifest};
    }
    async function download(prepared) {
        if(!prepared||!prepared.manifest.preparedBytesVerified)
            throw new Error('Export byte verification failed');
        // Rehash the SAME buffers right before the file-save gesture to
        // detect mutations after the original readback verification.
        for(let i=0;i<prepared.files.length;i++){
            if((await sha256(prepared.files[i].bytes))!==prepared.manifest.files[i].sha256)
                throw new Error('Export byte buffer changed after verification');
        }
        for(const f of prepared.files){
            const url=URL.createObjectURL(new Blob([f.bytes],{type:f.mime}));
            const a=document.createElement('a');a.href=url;a.download=f.name;
            document.body.appendChild(a);a.click();a.remove();
            setTimeout(()=>URL.revokeObjectURL(url),1000);
        }
    }
    const api={prepare,download,csvText,csvRows,grid,equalRows,workbookParts,worksheetXml};
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
    return api;
})();