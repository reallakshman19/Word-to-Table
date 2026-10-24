/* Native CSV/HTML serialization receipts. Source identities come from independent OOXML. */
const XYEmission=(()=>{
    const esc=XYInventory.esc;
    function csvRows(text){
        const rows=[];let row=[],field='',quoted=false;
        for(let i=0;i<text.length;i++){
            const c=text[i];
            if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
            else if(!quoted&&[',','\r','\n'].includes(c)){
                row.push(field);field='';if(c!==','){rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
            }else field+=c;
        }
        if(quoted)throw Error('Unclosed CSV quote.');
        if(field||row.length){row.push(field);rows.push(row);}return rows;
    }
    function contributors(p,table,headerRows,options,inventory){
        if(!p||p.placeholder)return [];
        let refs=p.sourceCells?.length?p.sourceCells.map(s=>({table:s.tableIndex??p.sourceTableIndex,row:s.rowIndex,col:s.cellIndex})):
            [{table:p.sourceTableIndex,row:p.sourceRowIndex,col:p.sourceCellIndex}];
        if(p.isHeader&&!options.refined&&!options.recovered&&headerRows===2){
            const c=table.grid[1]?.[p.csvCol];
            if(c&&!c.spanned)refs.push({table:table.physicalIndex,row:1,col:c.provenance.cellIndex});
        }
        const f=p.foldedFrom;
        if(f)refs.push({table:f.sourceTableIndex??table.physicalIndex,row:f.sourceRowIndex??f.rowIndex,col:f.sourceCellIndex??f.cellIndex});
        return inventory.items.filter(s=>s.kind==='cell'&&!s.nested&&!s.vMerge&&!s.unsupported&&
            refs.some(r=>s.table===r.table&&s.row===r.row&&s.col===r.col));
    }
    function annotate(cell,p,ctx,table,headerRows,options){
        const sources=contributors(p,table,headerRows,options,ctx.inventory);
        if(!sources.length)return;
        const id='emit-'+ctx.events.length;
        cell.setAttribute('data-xy-event',id);cell.setAttribute('data-xy-sources',sources.map(s=>s.id).join(' '));
        ctx.events.push({id,inputs:sources.map(s=>s.id),outputText:cell.textContent,
            rule:'native-csv-serialization/v1',action:p.derived?'DERIVED':p.isHeader?'HEADER_TRANSFORM':'EMITTED'});
    }
    function selection(result,table,headerRows,options,inventory){
        const values=csvRows(result.csv),ctx={inventory,events:[]};
        const doc=new DOMParser().parseFromString(`<section class="table-section" id="t${table.physicalIndex}"><table><thead></thead><tbody></tbody></table></section>`,'text/html');
        values.forEach((row,ri)=>{
            const tr=doc.createElement('tr');
            row.forEach((value,ci)=>{
                const cell=doc.createElement(ri===0?'th':'td');cell.textContent=value;
                annotate(cell,result.provenance.find(p=>p.csvRow===ri&&p.csvCol===ci),ctx,table,headerRows,options);tr.append(cell);
            });doc.querySelector(ri===0?'thead':'tbody').append(tr);
        });
        return {html:doc.body.innerHTML,events:ctx.events,sourceSha:inventory.sha,inventory};
    }
    function batch(html,results,inventory,exporter){
        const doc=new DOMParser().parseFromString(html,'text/html'),ctx={inventory,events:[]};
        for(const res of results){
            if(res.status!=='OK')continue;
            const table=doc.getElementById('t'+res.table.physicalIndex)?.querySelector('table');
            if(!table)continue;
            const options={refined:res.recovered?.success?null:res.refined,recovered:res.recovered};
            const csv=exporter.exportTable(res.table,1,0,options),values=csvRows(csv.csv);
            Array.from(table.rows).forEach((row,ri)=>Array.from(row.cells).slice(1).forEach((cell,ci)=>{
                // Mismatched native serializers earn no observed link.
                if(cell.textContent!==values[ri]?.[ci])return;
                annotate(cell,csv.provenance.find(p=>p.csvRow===ri&&p.csvCol===ci),ctx,res.table,1,options);
            }));
        }
        return {html:'<!doctype html>\n'+doc.documentElement.outerHTML,events:ctx.events,sourceSha:inventory.sha,inventory};
    }
    return {selection,batch,csvRows};
})();
