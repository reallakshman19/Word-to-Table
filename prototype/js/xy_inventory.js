/* Independent OOXML and inert HTML inventories. Canonical cells, not grid slots. */
const XYInventory = (() => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const esc = value => String(value ?? '').replace(/[&<>"']/g,
        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function hash(bytes) {
        if (!crypto.subtle) throw Error('SHA-256 unavailable; use a secure browser context.');
        const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
            .map(x => x.toString(16).padStart(2,'0')).join('');
    }
    function path(el) {
        const parts=[];
        for (let e=el; e?.nodeType===1; e=e.parentElement) {
            const siblings=Array.from(e.parentElement?.children || [e])
                .filter(s => s.namespaceURI===e.namespaceURI && s.localName===e.localName);
            parts.unshift(`${e.prefix?e.prefix+':':''}${e.localName}[${siblings.indexOf(e)+1}]`);
        }
        return '/'+parts.join('/');
    }
    function nearest(el, name) {
        for (let e=el.parentElement;e;e=e.parentElement) {
            if (e.namespaceURI===W && e.localName===name) return e;
        }
        return null;
    }
    function wordText(el, owner) {
        const values=[];
        const walk=node => {
            for (const child of node.children) {
                if (child.namespaceURI!==W) continue;
                if (child.localName==='tbl' || (child.localName==='tc' && child!==owner)) continue;
                if (child.localName==='t' || child.localName==='delText') values.push(child.textContent);
                else if (child.localName==='tab') values.push('\t');
                else if (['br','cr'].includes(child.localName)) values.push('\n');
                else {walk(child); if(child.localName==='p') values.push('\n');}
            }
        };
        walk(el);
        // Paragraph separators are structural; text/whitespace within runs stays exact.
        return el.localName==='p'?values.join(''):values.join('').replace(/\n$/, '');
    }
    function cells(xml, sha) {
        const items=[];
        const tables=Array.from(xml.getElementsByTagNameNS(W,'tbl'));
        for (const [ti, table] of tables.entries()) {
            const rows=Array.from(table.getElementsByTagNameNS(W,'tr')).filter(r=>nearest(r,'tbl')===table);
            for (const [ri,row] of rows.entries()) {
                let gridCol=0;
                const cols=Array.from(row.getElementsByTagNameNS(W,'tc')).filter(c=>nearest(c,'tr')===row);
                for (const [ci,cell] of cols.entries()) {
                    const span=Number(cell.getElementsByTagNameNS(W,'gridSpan')[0]?.getAttributeNS(W,'val') || 1);
                    const loc=path(cell);
                    items.push({id:sha+':word/document.xml:'+loc,path:loc,kind:'cell',
                        text:wordText(cell,cell),table:ti+1,row:ri,col:ci,gridCol,span,
                        nested:!!nearest(table,'tbl'),vMerge:cell.getElementsByTagNameNS(W,'vMerge').length>0});
                    gridCol+=span;
                }
            }
        }
        for (const p of xml.getElementsByTagNameNS(W,'p')) {
            if (nearest(p,'tc')) continue;
            const loc=path(p);
            items.push({id:sha+':word/document.xml:'+loc,path:loc,kind:'paragraph',
                text:wordText(p),table:null,row:null,col:null,
                unsupported:!!nearest(p,'txbxContent')});
        }
        return items;
    }
    async function source(buffer) {
        if (buffer.byteLength>50*1024*1024) throw Error('DOCX exceeds 50 MiB limit.');
        const sha=await hash(buffer);
        const zip=await JSZip.loadAsync(buffer);
        const main=zip.file('word/document.xml');
        if(!main) throw Error('DOCX lacks word/document.xml.');
        const xmlText=await main.async('string');
        if(xmlText.length>25*1024*1024) throw Error('Main XML exceeds inventory limit.');
        const xml=new DOMParser().parseFromString(xmlText,'application/xml');
        if(xml.querySelector('parsererror')) throw Error('Malformed main document XML.');
        const diagnostics=[];
        for (const name of Object.keys(zip.files)) {
            if (/word\/(header|footer|footnotes|endnotes|comments|embeddings|media)/i.test(name))
                diagnostics.push({kind:'UNSUPPORTED_PART',part:name});
        }
        for (const kind of ['drawing','pict','txbxContent','fldChar','altChunk','del','ins','object']) {
            const count=xml.getElementsByTagNameNS(W,kind).length;
            if(count) diagnostics.push({kind:'UNSUPPORTED_FEATURE',feature:kind,count});
        }
        const items=cells(xml,sha);
        return {sha,items,diagnostics,parts:Object.keys(zip.files),
            scope:'word/document.xml canonical cells + paragraphs outside cells; no rendering/page guarantee'};
    }
    function inert(html) {
        if(html.length>25*1024*1024) throw Error('HTML exceeds 25 MiB limit.');
        const doc=new DOMParser().parseFromString(html,'text/html');
        doc.querySelectorAll('script,style,template,noscript,iframe,object,embed,svg,[hidden],[aria-hidden="true"]')
            .forEach(e=>e.remove());
        doc.querySelectorAll('[style]').forEach(e=>{
            if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test(e.getAttribute('style'))) e.remove();
        });
        return doc;
    }
    function output(html, sha) {
        const doc=inert(html), items=[];
        const tables=Array.from(doc.querySelectorAll('table'));
        tables.forEach((table,ti)=>{
            const declared=/^t(\d+)$/.exec(table.closest('section')?.id||'');
            const tableIndex=declared?Number(declared[1]):ti+1;
            const rows=Array.from(table.rows).filter(row=>row.closest('table')===table);
            rows.forEach((row,ri)=>Array.from(row.cells).filter(c=>!c.classList.contains('row-idx')).forEach((cell,ci)=>{
                const clone=cell.cloneNode(true);clone.querySelectorAll('table').forEach(e=>e.remove());
                items.push({id:sha+':'+path(cell),path:path(cell),text:clone.textContent,
                    kind:'cell',table:tableIndex,row:ri,col:ci,
                    eventId:cell.getAttribute('data-xy-event'),sources:(cell.getAttribute('data-xy-sources')||'').split(' ').filter(Boolean)});
            }));
        });
        doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6').forEach(e=>{
            if(e.closest('table')) return;
            items.push({id:sha+':'+path(e),path:path(e),kind:'paragraph',text:e.textContent,
                table:null,row:null,col:null,sources:[]});
        });
        return items;
    }
    return {W,esc,hash,path,nearest,source,inert,output};
})();
