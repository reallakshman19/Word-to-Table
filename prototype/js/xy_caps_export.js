/* Provisional output is current computed data; reference qualification is a separate claim. */
const XYCapsExport=(()=>{
    function cell(value){
        if(value===null||value===undefined)return '';
        let text=String(value);
        // Quoting alone does not stop spreadsheet formulas. Raw values stay in the evidence JSON.
        if(typeof value==='string'&&/^[\s]*[=+@-]/u.test(text))text="'"+text;
        return '"'+text.replace(/"/g,'""')+'"';
    }
    function csv(records){
        return '\uFEFF'+XYCapsColumns.join(',')+'\n'+records.map(row=>XYCapsColumns.map(c=>cell(row[c])).join(',')+'\n').join('');
    }
    function prepare(state,{fresh,acknowledged}){
        if(!fresh||!state)throw Error('Stale input or configuration — regenerate before exporting.');
        if(!acknowledged)throw Error('Please acknowledge that this CSV is provisional and unapproved.');
        const records=state.data?.records;
        if(!Array.isArray(records)||!records.length)throw Error('No CAPS rows to export. Choose a supported table or run the full batch first.');
        for(const row of records)for(const column of XYCapsColumns){
            if(!Object.hasOwn(row,column))throw Error('Incomplete output schema: '+column+'. Export the evidence for review.');
            const value=row[column];
            if(typeof value==='number'&&!Number.isFinite(value))throw Error('Output contains a non-finite number in '+column+'. Review the evidence.');
            if(value!==null&&!['string','number','boolean'].includes(typeof value))throw Error('Unsupported value in '+column+'. Review the evidence.');
        }
        return {csv:state.referenceBinding&&state.provisionalEligible?state.csv:csv(records),name:'CAPS_PROVISIONAL_UNAPPROVED.csv',rows:records.length};
    }
    return {csv,prepare};
})();
