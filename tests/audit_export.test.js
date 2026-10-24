const test=require('node:test');
const assert=require('node:assert/strict');
const AuditExport=require('../js/audit_export.js');
const audit={meta:{filename:'fixture.docx'},result:{
  sourceTotal:2,extraOutput:[],diagnostics:[],
  rows:[
    {sourceId:'a',sourcePath:'a',kind:'cell',sourceText:'=SUM(1,2)',
      outputId:'x',outputLocation:'x',outputText:'Hello,<script>alert(1)</script>',
      status:'ALTERED',reason:'test'},
    {sourceId:'b',sourcePath:'b',kind:'cell',sourceText:'plain',
      outputId:null,outputLocation:null,outputText:null,status:'MISSING',reason:'unmapped'}
  ]
}};
test('CSV is properly quoted and formula-neutralized',()=>{
  const csv=AuditExport.csv(audit);
  assert.equal(csv.charCodeAt(0),0xFEFF);
  assert.ok(csv.includes("\"'=SUM(1,2)\""));
  assert.ok(csv.includes('"Hello,<script>alert(1)</script>"'));
  assert.ok(csv.includes('MISSING'));
});
test('standalone HTML contains all records and no external dependency',()=>{
  const html=AuditExport.standalone(audit);
  assert.ok(html.includes('audit-data'));
  assert.ok(html.includes('script type="application/json"'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('src:')===false);
  assert.ok(!html.includes('https://'));
});
