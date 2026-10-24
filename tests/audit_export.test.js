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


test('G1/G2: CSV and offline viewer retain all source dispositions and inverse exceptions',()=>{
 const input={meta:{filename:'fixture.docx'},result:{
    sourceTotal:3,statuses:{OMITTED_UNVERIFIED:1,OUT_OF_EXPORT_SCOPE:1,EMPTY_STRUCTURE_UNVERIFIED:1},
    extraOutput:[{outputId:'UNATTRIBUTED_A',text:'Unknown target',rowIndex:3,colIndex:1}],
    diagnostics:[{part:'word/header1.xml',feature:'separate DOCX story'}],
    rows:[
      {sourceId:'table2',sourcePath:'/body/tbl[2]/tr[1]/tc[1]',kind:'cell',
       tableId:'T2',rowIndex:0,colIndex:0,sourceText:'Notes',outputId:null,
       outputLocation:null,outputText:null,status:'OMITTED_UNVERIFIED',reason:'No filter'},
      {sourceId:'para1',sourcePath:'/body/p[1]',kind:'paragraph',sourceText:'Intro',outputId:null,
       outputLocation:null,outputText:null,status:'OUT_OF_EXPORT_SCOPE',reason:'Tables only'},
      {sourceId:'empty1',sourcePath:'/body/tbl[1]/tr[1]/tc[2]',kind:'cell',
       sourceText:'',outputId:null,outputLocation:null,outputText:null,
       status:'EMPTY_STRUCTURE_UNVERIFIED',reason:'Unverified structure'}
    ]
 }};
 const records=AuditExport.reportRows(input);
 assert.equal(records.length,5);
 assert.deepEqual(records.map(x=>x.status),[
   'OMITTED_UNVERIFIED','OUT_OF_EXPORT_SCOPE','EMPTY_STRUCTURE_UNVERIFIED',
   'EXTRA_OUTPUT','COVERAGE_EXCEPTION']);
 const exported=AuditExport.csv(input);
 for(const value of ['OMITTED_UNVERIFIED','OUT_OF_EXPORT_SCOPE','EMPTY_STRUCTURE_UNVERIFIED',
                     'UNATTRIBUTED_A','COVERAGE_EXCEPTION','word/header1.xml']){
   assert.ok(exported.includes(value),value);
 }
 const html=AuditExport.standalone(input);
 for(const value of ['OMITTED_UNVERIFIED','OUT_OF_EXPORT_SCOPE','EMPTY_STRUCTURE_UNVERIFIED',
                     'UNATTRIBUTED_A','COVERAGE_EXCEPTION']){
   assert.ok(html.includes(value),value);
 }
});
