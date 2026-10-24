const test = require('node:test');
const assert = require('node:assert/strict');
const DiffEngine = require('../js/diff_engine.js');
function s(id,text,kind='cell',row=0,col=0,table='T') {
    return {sourceId:id,sourcePath:id,sourcePart:'word/document.xml',kind,textOriginal:text,
        tableId:table,rowIndex:row,colIndex:col};
}
function o(id,text,sids=[],row=0,col=0,table=0) {
    return {outputId:id,kind:'cell',text,sourceIds:sids,tableIndex:table,rowIndex:row,colIndex:col,location:id};
}
function run(src,out,mode='generated',events=[]) {
    return DiffEngine.compare({occurrences:src,tables:[{tableId:'T',parentTableId:null}],diagnostics:[]},
        {events}, {mode,occurrences:out}, {});
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
