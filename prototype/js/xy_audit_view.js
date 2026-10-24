/* Word audit presentation: live counts, source/output cards, technical detail on demand. */
const XYAuditView=(()=>{
    const esc=XYInventory.esc;
    const category=s=>s.status==='MISSING'?'missing':s.status==='UNSUPPORTED'||s.status==='AMBIGUOUS'?'unsupported':
        s.status==='CANDIDATE_ALTERED'||s.status==='VERIFIED_TRANSFORM'?'changed':s.evidence==='OBSERVED_EMISSION'?'observed':'candidate';
    const labels={VERIFIED_EXACT:'Observed · exact',VERIFIED_TRANSFORM:'Observed · transformed',MISSING:'Not represented',
        UNSUPPORTED:'Unsupported',AMBIGUOUS:'Ambiguous',CANDIDATE_EXACT:'Candidate · exact',CANDIDATE_NORMALIZED:'Candidate · normalized',CANDIDATE_ALTERED:'Candidate · altered'};
    const count=(model,test)=>model.items.filter(test).length;
    function cards(items){
        return items.map(s=>`<article class="xy-record-card ${category(s)}">
            <header><strong>${s.kind==='paragraph'?'¶ Outside-table paragraph':`▦ Table ${s.table} · row ${s.row+1} · cell ${s.col+1}`}</strong>
                <span class="xy-status-chip ${category(s)}">${esc(labels[s.status]||s.status)}</span></header>
            <div class="xy-compare-cells"><div><label>ORIGINAL WORD SOURCE</label><pre>${esc(s.text)||'<span class="xy-muted">Empty source cell</span>'}</pre></div>
                <div><label>ACTUAL HTML OUTPUT</label><pre>${s.targetText===null?'<span class="xy-muted">No linked output</span>':esc(s.targetText)||'<span class="xy-muted">Empty output cell</span>'}</pre></div></div>
            <footer>${esc(s.reason)} <details><summary>Source location &amp; ${s.outputLinks?.length||0} output links</summary>
                <code>${esc(s.path)}</code><pre>${esc(JSON.stringify(s.outputLinks||[],null,2))}</pre></details></footer></article>`).join('')||
            '<div class="xy-empty"><strong>No matching occurrences</strong><p>Change the search or filters. Full exports still include the entire audit.</p></div>';
    }
    function shell(model){
        const observed=count(model,s=>s.evidence==='OBSERVED_EMISSION'),candidate=count(model,s=>s.evidence==='CANDIDATE'&&s.status.startsWith('CANDIDATE'));
        const missing=model.counts.MISSING||0,unsupported=count(model,s=>['UNSUPPORTED','AMBIGUOUS'].includes(s.status));
        const changed=count(model,s=>category(s)==='changed');
        const stats=[['Source occurrences',model.sourceTotal,'Canonical cells + paragraphs','total'],['Observed links',observed,'Recorded during conversion','observed'],
            ['Candidate matches',candidate,'Location-based · unverified','candidate'],['Not represented',missing,'Original raw text retained','missing'],['Unsupported',unsupported,'Requires source review','unsupported']];
        const groups=[['ALL','All',model.sourceTotal],['ISSUES','Needs review',missing+unsupported+changed],['missing','Not represented',missing],['changed','Changed / transformed',changed],['observed','Observed',count(model,s=>category(s)==='observed')]];
        return `<section class="xy-audit-dashboard"><div class="xy-audit-heading"><div><span class="xy-eyebrow">SOURCE RECONCILIATION</span><h2>Word / HTML comparison</h2>
            <p>${model.receipt?'Live conversion receipts':'Uploaded HTML · candidate matching'} · ${model.items.filter(s=>s.kind==='cell').length} cells · ${model.items.filter(s=>s.kind==='paragraph').length} paragraphs</p></div>
            <span class="xy-review-tag">Review required</span></div>
            <div class="xy-stat-grid">${stats.map(([label,n,detail,tone])=>`<div class="xy-stat-card ${tone}"><label>${label}</label><strong>${n.toLocaleString()}</strong><small>${detail}</small></div>`).join('')}</div>
            <div class="xy-audit-toolbar"><div class="xy-filter-pills">${groups.map(([id,label,n])=>`<button data-audit-filter="${id}" aria-pressed="${id==='ALL'}">${label} <span>${n.toLocaleString()}</span></button>`).join('')}</div>
            <input id="xy-search" type="search" aria-label="Search source or output" placeholder="Search text, table or source location…">
            <button id="xy-report" class="xy-primary">↓ Audit HTML</button><button id="xy-csv">↓ CSV</button><button id="xy-json">↓ JSON</button></div>
            <div class="xy-audit-scope"><label>Source <select id="xy-table-filter"><option value="ALL">Whole document</option><option value="PARAGRAPHS">Outside-table paragraphs</option>${[...new Set(model.items.filter(s=>s.table).map(s=>s.table))].map(t=>`<option value="${t}">Table ${t}</option>`).join('')}</select></label>
            <label>Status <select id="xy-status"><option>ALL</option>${Object.keys(model.counts).map(s=>`<option>${esc(s)}</option>`).join('')}</select></label>
            <span id="xy-visible"></span><button id="xy-prev">← Previous</button><button id="xy-next">Next →</button></div>
            <div id="xy-items" class="xy-records"></div><div class="xy-audit-bottom"><button id="xy-source">↓ Original DOCX</button><button id="xy-target">↓ Actual target HTML</button><button id="xy-generated">Use generated HTML</button></div>
            <details class="xy-evidence-details"><summary>Coverage, run identity and unmatched output</summary><p>Observed links document a conversion operation. They do not certify engineering correctness or complete Word rendering.</p>
            <p>${esc(model.inventory.scope)}</p><pre>${esc(JSON.stringify({identity:model.identity,warnings:model.inventory.diagnostics,outputExtras:model.extras},null,2))}</pre></details></section>`;
    }
    return {shell,cards,category};
})();
