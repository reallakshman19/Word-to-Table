const test=require('node:test');
const assert=require('node:assert/strict');
const OutputInventory=require('../js/output_inventory.js');
test('F4: a CSS-hidden target cannot be claimed visually verified',()=>{
 const table={localName:'table',nodeType:1,parentElement:null,
   hasAttribute(){return false},getAttribute(){return null}};
 const tr={localName:'tr',nodeType:1,parentElement:table,
   hasAttribute(){return false},getAttribute(){return null},closest(k){return k==='table'?table:null}};
 const cell={localName:'td',nodeType:1,parentElement:tr,textContent:'HIDDEN',
   hasAttribute(){return false},getAttribute(k){return k==='class'?'concealed':null}};
 tr.children=[cell];
 table.querySelectorAll=(q)=>q==='tr'?[tr]:[];
 const css={localName:'style',textContent:'.concealed{display:none}'};
 const doc={
    querySelectorAll(q){if(q==='table')return [table];return []},
    querySelector(q){return q.includes('style')?css:null}
 };
 const prev=global.DOMParser;
 global.DOMParser=class{parseFromString(){return doc}};
 try {
   const out=OutputInventory.parse('<style>.concealed{display:none}</style>','companion');
   assert.equal(out.visibilityVerified,false);
   assert.equal(out.visibilityRisk,true);
   assert.equal(out.occurrences.length,1);
 } finally { global.DOMParser=prev; }
});
