/* Evidence strengths deliberately separate operation receipts from candidate matches. */
const XYCompare = (() => {
    const normalize = value => String(value).replace(/\s+/gu,' ').trim();
    const samePlace=(s,o)=>s.kind===o.kind && s.table===o.table && s.row===o.row && s.col===o.col;
    function compare(sources, outputs, receipt=null) {
        const used=new Set(), items=[];
        for (const source of sources) {
            let target=null,event=null,links=[];
            const unsupported=source.nested||source.vMerge||source.unsupported;
            if(receipt&&!unsupported) {
                for(const e of receipt.events.filter(e=>e.inputs.includes(source.id)))
                    for(const o of outputs.filter(o=>o.eventId===e.id&&o.sources.includes(source.id)))
                        links.push({outputId:o.id,outputPath:o.path,targetText:o.text,eventId:e.id,rule:e.rule});
                if(links.length){const first=links[0];event=receipt.events.find(e=>e.id===first.eventId);target=outputs.find(o=>o.id===first.outputId);}
            }
            let status, evidence='CANDIDATE', reason='No target at the original structural location';
            if(target && event) {
                status=links.every(link=>source.text===link.targetText)?'VERIFIED_EXACT':'VERIFIED_TRANSFORM';
                evidence='OBSERVED_EMISSION'; reason=event.rule;
            } else if(unsupported) {
                status='UNSUPPORTED';reason='Nested/vertical-merge/textbox semantics not qualified';
            } else {
                const options=outputs.filter(o=>!used.has(o.id) && samePlace(source,o));
                target=options.length===1?options[0]:null;
                if(options.length>1) status='AMBIGUOUS';
                else if(!target) status='MISSING';
                else if(source.text===target.text) status='CANDIDATE_EXACT';
                else if(normalize(source.text)===normalize(target.text)) status='CANDIDATE_NORMALIZED';
                else status='CANDIDATE_ALTERED';
                if(target) reason='Structural position only; no authenticated conversion event';
            }
            if(target) used.add(target.id);
            links.forEach(link=>used.add(link.outputId));
            if(target&&!links.length)links=[{outputId:target.id,outputPath:target.path,targetText:target.text,eventId:null}];
            items.push({...source,status,evidence,reason,outputId:target?.id||null,
                outputPath:target?.path||null,targetText:target?.text??null,eventId:event?.id||null,outputLinks:links});
        }
        const counts={}; items.forEach(s=>counts[s.status]=(counts[s.status]||0)+1);
        return {items,extras:outputs.filter(o=>!used.has(o.id)),counts,
            sourceTotal:items.length,countUnit:'canonical cell or outside-cell paragraph occurrence'};
    }
    return {compare,normalize};
})();
