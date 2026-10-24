const test = require('node:test');
const assert = require('node:assert/strict');
const DiffEngine = require('../js/diff_engine.js');
function s(id,text,kind='cell',row=0,col=0,table='T') {
    return {sourceId:id,sourcePath:id,sourcePart:'word/document.xml',kind,textOriginal:text,
        tableId:table,rowIndex:row,colIndex:col,coverage:'SUPPORTED'};
}
function o(id,text,sids=[],row=0,col=0,table=0) {
    return {outputId:id,kind:'cell',text,sourceIds:sids,tableIndex:table,rowIndex:row,colIndex:col,location:id};
}
function run(src,out,mode='generated',events=[]) {
    return DiffEngine.compare({occurrences:src,tables:[{tableId:'T',parentTableId:null}],diagnostics:[]},
        {events,provenanceVerified:mode==='generated'}, {mode,occurrences:out,visibilityVerified:true}, {});
}
test('N01: duplicate source does not reuse one output', () => {
    const r=run([s('a','SAME'),s('b','SAME', 'cell',0,1)],[o('x','SAME',['a'])]);
    assert.equal(r.statuses.PRESERVED_EXACT,1); assert.equal(r.statuses.MISSING,1);
});
test('N02: moved companion text is not globally preserved', () => {
    const r=run([s('a','A'),s('b','B','cell',0,1)],[o('x','B',[],0,0),o('y','A',[],0,1)],'companion');
    assert.equal(r.statuses.PRESERVED_EXACT,0);
});
test('N04: substring is not a preservation match', () => {
    const r=run([s('a','AB')],[o('x','LONG AB VALUE')],'companion');
    assert.equal(r.statuses.AMBIGUOUS,1);
});
test('N05: equal distinct cells retain both identities', () => {
    const r=run([s('a','X'),s('b','X','cell',0,1)],[o('x','X',['a']),o('y','X',['b'],0,1)]);
    assert.equal(r.sourceTotal,2);assert.equal(r.statuses.PRESERVED_EXACT,2);
});
test('N10: FILTERED requires actual event', () => {
    const yes=run([s('a','X')],[], 'generated', [{sourceId:'a',action:'FILTERED',ruleId:'MIN_ROWS'}]);
    const no=run([s('a','X')],[]);
    assert.equal(yes.statuses.FILTERED,1);assert.equal(no.statuses.MISSING,1);
});
test('N14: lost placeholder is MISSING', () => {
    assert.equal(run([s('a','---')],[]).statuses.MISSING,1);
});
test('N15: accounting always reconciles', () => {
    const r=run([s('a','A'),s('b','B','cell',0,1)],[o('x','A',['a'])]);
    assert.equal(Object.values(r.statuses).reduce((a,b)=>a+b,0),r.sourceTotal);
});
test('reused source ID yields AMBIGUOUS', () => {
    const r=run([s('a','A')],[o('x','A',['a']),o('y','A',['a'],0,1)]);
    assert.equal(r.statuses.AMBIGUOUS,1);
});


test('F1: identical unrelated companion cell cannot certify preservation', () => {
    const a=s('unrelated-doc-source','IDENTICAL');
    const r=DiffEngine.compare({occurrences:[a],tables:[{tableId:'T',parentTableId:null}],diagnostics:[]},
       {events:[],provenanceVerified:false},
       {mode:'companion',visibilityVerified:false,occurrences:[o('external-cell','IDENTICAL',[],0,0)]},{});
    assert.equal(r.statuses.PRESERVED_EXACT,0);
    assert.equal(r.statuses.CANDIDATE_MATCH,1);
    assert.equal(r.qualified,false);
});
test('F2: swapped generated rows cannot qualify even with correct IDs', () => {
    const r=DiffEngine.compare({occurrences:[s('a','FIRST'),s('b','SECOND','cell',1,0)],tables:[{tableId:'T',parentTableId:null}],diagnostics:[]},
       {events:[],provenanceVerified:true,tables:[{sourceTableId:'T',outputTableIndex:0,headerRow:1}]},
       {mode:'generated',visibilityVerified:true,occurrences:[
          o('r1','SECOND',['b'],0,0),o('r2','FIRST',['a'],1,0)]},{});
    assert.equal(r.statuses.PRESERVED_EXACT,0);
    assert.equal(r.statuses.AMBIGUOUS,2);
    assert.equal(r.qualified,false);
});
test('F0: post-hoc source IDs cannot certify a generated output', () => {
    const r=DiffEngine.compare({occurrences:[s('a','A')],tables:[{tableId:'T',parentTableId:null}],diagnostics:[]},
        {events:[],verified:true},
        {mode:'generated',visibilityVerified:true,occurrences:[o('out','A',['a'])]},{});
    assert.equal(r.statuses.PRESERVED_EXACT,0);
    assert.equal(r.statuses.CANDIDATE_MATCH,1);
    assert.equal(r.qualified,false);
});


test('G1: R5-style tables-only companion accounts for source notes, paragraphs and empty structures',()=>{
 const cells=[
   {...s('t1-value','AAA','cell',0,0,'T1'),structuralEmpty:false},
   {...s('t1-empty','','cell',0,1,'T1'),structuralEmpty:true},
   {...s('t2-heading','Notes','cell',0,0,'T2'),structuralEmpty:false},
   {...s('t2-body','Engineering requirements','cell',0,1,'T2'),structuralEmpty:false},
   {...s('t3-value','BBB','cell',0,0,'T3'),structuralEmpty:false},
   {sourceId:'p1',sourcePath:'/body/p[1]',sourcePart:'word/document.xml',
    kind:'paragraph',textOriginal:'Introduction',coverage:'SUPPORTED'},
   {sourceId:'p2',sourcePath:'/body/p[2]',sourcePart:'word/document.xml',
    kind:'paragraph',textOriginal:'',coverage:'SUPPORTED'}
 ];
 const source={occurrences:cells,tables:['T1','T2','T3'].map(id=>({tableId:id,parentTableId:null})),diagnostics:[],
   scope:'top-level paragraphs and canonical table cells'};
 const output={mode:'companion',reportProfile:'R5_REFINED_TABLES',
   sourceTableNumberHints:[1,3],reportFilterClaim:'Only Tables with data',
   occurrences:[
      {...o('out1','AAA',[],0,0,0),sourceTableId:null},
      {...o('out3','BBB',[],0,0,2),sourceTableId:null},
      {...o('orphan','UNKNOWN',[],1,0,2),sourceTableId:null}
   ]};
 const result=DiffEngine.compare(source,{events:[]},output,{});
 assert.deepEqual(result.omittedSourceTables.map(x=>x.tableNumber),[2]);
 assert.equal(result.statuses.OMITTED_UNVERIFIED,2);
 assert.equal(result.statuses.OUT_OF_EXPORT_SCOPE,2);
 assert.equal(result.statuses.EMPTY_STRUCTURE_UNVERIFIED,1);
 assert.equal(result.statuses.CANDIDATE_MATCH,2);
 assert.equal(result.extraOutput.length,1);
 assert.equal(result.sourceTotal,7);
 assert.equal(result.sourceParagraphs,2);
 assert.equal(result.sourceEmptyCells,1);
 assert.equal(Object.values(result.statuses).reduce((a,b)=>a+b,0),7);
 assert.equal(result.qualified,false);
 assert.equal(result.traceabilityVerified,false);
 assert.equal(result.statuses.FILTERED,0); // HTML claim is not an authorized filter event
});
test('G2: explicit converter filter event supersedes omission but not a claim string',()=>{
 const src=s('notes','Notes','cell',0,0,'T1');
 const led={occurrences:[src],tables:[{tableId:'T1',parentTableId:null}],diagnostics:[]};
 const output={mode:'companion',reportProfile:'R5_REFINED_TABLES',reportFilterClaim:'Only Tables with data',
   sourceTableNumberHints:[],occurrences:[]};
 const unverified=DiffEngine.compare(led,{events:[]},output,{});
 assert.equal(unverified.statuses.OMITTED_UNVERIFIED,1);
 const accepted=DiffEngine.compare(led,{events:[{sourceId:'notes',action:'FILTERED',ruleId:'EXPLICIT_DECISION'}]},output,{});
 assert.equal(accepted.statuses.FILTERED,1);
 assert.equal(accepted.qualified,false);
});
