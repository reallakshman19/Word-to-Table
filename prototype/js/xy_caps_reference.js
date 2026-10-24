/* Optional PRIVATE reference loaded by the user, never bundled with Pages. */
const XYCapsReference = (() => {
    const expected='12f075fa873ac937fe8e07e60d0481b2caf3356467d9879a2ca4cac532d1a282';
    function parse(text) {
        const rows=[];let row=[],field='',quoted=false;
        text=text.replace(/^\uFEFF/,'');
        for(let i=0;i<text.length;i++) {
            const c=text[i];
            if(c==='"') {
                if(quoted && text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
            } else if(!quoted && (c===',' || c==='\n' || c==='\r')) {
                row.push(field);field='';
                if(c!==','){rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
            } else field+=c;
        }
        if(quoted)throw Error('Unclosed CSV quote.');
        if(field || row.length){row.push(field);rows.push(row);}
        return rows;
    }
    async function load(file) {
        if(file.size>2*1024*1024)throw Error('Reference exceeds 2 MiB limit.');
        const bytes=await file.arrayBuffer();
        if(await XYInventory.hash(bytes)!==expected)throw Error('Reference CSV hash does not match the frozen registered reference.');
        const text=new TextDecoder('utf-8',{ignoreBOM:true}).decode(bytes);
        const [columns,...rows]=parse(text);
        if(JSON.stringify(columns)!==JSON.stringify(XYCapsColumns) || rows.length!==458 || rows.some(r=>r.length!==30))
            throw Error('Registered CSV shape mismatch.');
        return {text,rows,sha:expected};
    }
    function profile(base,reference) {
        const cfg=JSON.parse(JSON.stringify(base));
        const keys=['class_number','mat_description','ca_mm','ca_in','rating','rev'];
        cfg.spec_meta_defaults={};
        keys.forEach((key,i)=>{
            if(reference.rows.some(r=>r[i]!==reference.rows[0][i]))throw Error('Inconsistent reference metadata.');
            const value=reference.rows[0][i];
            cfg.spec_meta_defaults[key]=[0,2,3,4].includes(i)&&value!==''?Number(value):value;
        });
        return cfg;
    }
    function reconcile(records,reference) {
        // Frozen CSV uses e.g. 15.0 where the browser computes numeric 15.
        // Only declared numeric measures normalize formatting; MESC/other identifiers remain exact text.
        const numeric=new Set([0,2,3,4,12,14,20,23,25]);
        const scalar=(value,i)=>{
            const text=String(value??'');
            return numeric.has(i) && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
                && Number.isFinite(Number(text))?String(Number(text)):text;
        };
        const key=row=>JSON.stringify(row.map(scalar));
        const queue=new Map();
        records.forEach((record,index)=>{
            const k=key(XYCapsColumns.map(c=>record[c]));
            if(!queue.has(k))queue.set(k,[]);
            queue.get(k).push(index);
        });
        const order=reference.rows.map(row=>{
            const index=queue.get(key(row))?.shift();
            if(index===undefined) {
                const near=records.find(r=>String(r['MESC number'])===row[26] && String(r['Short name'])===row[6]);
                const differences=near?XYCapsColumns.filter((c,i)=>scalar(near[c],i)!==scalar(row[i],i)):['record occurrence'];
                throw Error('Computed CAPS values differ in '+differences.join(', ')+'. CSV remains blocked.');
            }
            return index;
        });
        if(order.length!==records.length || [...queue.values()].some(q=>q.length))throw Error('Computed/reference record counts differ.');
        return order;
    }
    return {load,profile,reconcile,parse};
})();
