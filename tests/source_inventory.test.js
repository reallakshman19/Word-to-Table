const test=require('node:test');
const assert=require('node:assert/strict');
const SourceInventory=require('../js/source_inventory.js');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function el(localName,kids=[],value=''){
    const el={localName,children:kids,textContent:value,
      getAttribute(){return null;},getAttributeNS(){return null;},
      getElementsByTagNameNS(ns,name){
        const out=[];function visit(node){for(const ch of node.children||[]){
          if(ch.localName===name)out.push(ch);visit(ch);
        }}visit(this);return out;
      }};
    return el;
}
function makeDoc(body) {
    return {getElementsByTagName(){return []},
       getElementsByTagNameNS(ns,tag){return tag==='body'?[body]:[]}};
}
test('F3: inserted tracked-change run is inventoried and flagged',()=>{
   const body=el('body',[el('p',[el('ins',[el('r',[el('t',[],'VISIBLE INSERTION')])])])]);
   const r=SourceInventory.build(makeDoc(body),[]);
   assert.equal(r.occurrences[0].textOriginal,'VISIBLE INSERTION');
   assert.equal(r.hasCoverageExceptions,true);
   assert.ok(r.diagnostics.some(x=>x.feature==='ins'));
});
test('F3b: deletions are not silently treated as ordinary live text',()=>{
   const body=el('body',[el('p',[el('del',[el('r',[el('delText',[],'REMOVED')])]),
     el('r',[el('t',[],'RETAINED')])])]);
   const r=SourceInventory.build(makeDoc(body),[]);
   assert.equal(r.occurrences[0].textOriginal,'RETAINED');
   assert.equal(r.hasCoverageExceptions,true);
});

test('F5: nested table emits an explicit unsupported-conversion diagnostic',()=>{
   const p=(s)=>el('p',[el('r',[el('t',[],s)])]);
   const nested=el('tbl',[el('tr',[el('tc',[p('INNER')])])]);
   const outer=el('tbl',[el('tr',[el('tc',[p('OUTER'),nested])])]);
   const ledger=SourceInventory.build(makeDoc(el('body',[outer])),[]);
   assert.equal(ledger.tables.length,2);
   assert.ok(ledger.diagnostics.some(d=>d.feature==='nestedTable'));
   assert.equal(ledger.hasCoverageExceptions,true);
});

test('R5-hyphen: OOXML nonbreaking-hyphen run retains character and does not look preserved when removed',()=>{
    const doc=makeDoc(el('body',[el('p',[el('r',[el('t',[],'ASTM A234'),el('noBreakHyphen'),el('t',[],'WPB')])])]));
    const ledger=SourceInventory.build(doc,[]);
    assert.equal(ledger.occurrences[0].textOriginal,'ASTM A234\u2011WPB');
    assert.notEqual(ledger.occurrences[0].textOriginal,'ASTM A234WPB');
});
