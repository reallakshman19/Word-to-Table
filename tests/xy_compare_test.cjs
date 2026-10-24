// Independent small cases: no private fixtures or browser dependencies.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const context = vm.createContext({console});
const current = path.join(root, 'prototype/js/xy_compare.js');
let compare;
if (fs.existsSync(current)) {
    vm.runInContext(fs.readFileSync(current, 'utf8'), context);
    compare = vm.runInContext('XYCompare.compare', context);
} else {
    // Exercise actual pre-integration engine, not a simulated RED implementation.
    vm.runInContext(fs.readFileSync(path.join(root, 'js/diff_engine.js'), 'utf8'), context);
    const legacy = vm.runInContext('DiffEngine.run', context);
    compare = (sources, outputs) => {
        const tables = [...new Set(sources.map(s => s.table))].map(table => ({
            tableIndex: table, rows: 1, cols: sources.length, pageNumber: 1,
            headers: sources.filter(s => s.table === table).map(s => s.text), dataRows: []
        }));
        const html = outputs.map(o => `<table><tr><td>${o.text}</td></tr></table>`).join('');
        const result = legacy({tables}, html, {normalizeWhitespace:true});
        return {items: result.pages[1].tables.flatMap(t => t.cells)};
    };
}
const s = (id, text, table = 1, col = 0) => ({id, text, table, row:0, col, kind:'cell'});
const o = (id, text, table = 1, col = 0) => ({id, text, table, row:0, col, kind:'cell', sources:[]});
const tests = [
    ['same-row equal cells stay distinct', () => {
        assert.equal(compare([s('a','same'),s('b','same',1,1)], [o('x','same')]).items.length,2);
    }],
    ['no target occurrence reused', () => {
        const r=compare([s('a','same'),s('b','same',1,1)], [o('x','same')]);
        assert.equal(r.items.filter(x => x.outputId).length,1);
        assert.equal(r.items[1].status,'MISSING');
    }],
    ['wrong-table text is not preservation', () => {
        assert.equal(compare([s('a','needle',1)], [o('x','needle',2)]).items[0].status,'MISSING');
    }],
    ['substring is an alteration, never exact', () => {
        assert.equal(compare([s('a','cat')], [o('x','catalog')]).items[0].status,'CANDIDATE_ALTERED');
    }],
    ['empty canonical cell gets a disposition', () => {
        assert.equal(compare([s('a','')], []).items[0].status,'MISSING');
    }],
    ['equal companion value remains candidate', () => {
        assert.equal(compare([s('a','A&B')], [o('x','A&B')]).items[0].status,'CANDIDATE_EXACT');
    }],
    ['missing placeholder is not guessed altered', () => {
        assert.equal(compare([s('a','---')], []).items[0].status,'MISSING');
    }],
    ['one source can retain all observed output locations',()=>{
        const targets=[{...o('x','same'),eventId:'e1',sources:['a']},{...o('y','same',1,1),eventId:'e2',sources:['a']}];
        const r=compare([s('a','same')],targets,{events:[{id:'e1',inputs:['a'],rule:'repeat'},{id:'e2',inputs:['a'],rule:'repeat'}]});
        assert.equal(r.items[0].outputLinks.length,2);assert.equal(r.extras.length,0);
    }],
    ['unsupported merge cannot earn an observed fidelity status',()=>{
        const r=compare([{...s('a','same'),vMerge:true}],[{...o('x','same'),eventId:'e',sources:['a']}],{events:[{id:'e',inputs:['a']}]});
        assert.equal(r.items[0].status,'UNSUPPORTED');
    }],
    ['output extras are separate from source denominator', () => {
        const r=compare([s('a','x')], [o('x','x'),o('y','extra',1,1)]);
        assert.equal(r.items.length,1); assert.equal(r.extras.length,1);
    }]
];
let failures=0;
for (const [name, test] of tests) {
    try {test();console.log('PASS '+name);} catch(e) {failures++;console.log('FAIL '+name+': '+e.message);}
}
console.log(`${tests.length-failures}/${tests.length} passed`);
process.exitCode=failures?1:0;
