const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const context=vm.createContext({TextDecoder,console});
for(const file of ['xy_caps_config.js','xy_caps_reference.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../prototype/js',file),'utf8'),context);
const api=vm.runInContext('XYCapsReference',context);
const columns=vm.runInContext('XYCapsColumns',context);
const record=(id,value)=>Object.fromEntries(columns.map(c=>[c,c==='MESC number'?id:c==='Comp. code'?value:'']));
const row=r=>columns.map(c=>String(r[c]??''));
const a=record('1000000001','A'),b=record('1000000002','B');
const tests=[
    ['reference reorders computed records without replacing values',()=>{
        assert.equal(JSON.stringify(api.reconcile([a,b],{rows:[row(b),row(a)]})),'[1,0]');
        assert.equal(a['Comp. code'],'A');
    }],
    ['reference cannot hide one changed field',()=>{
        const changed={...a,'Comp. code':'WRONG'};
        assert.throws(()=>api.reconcile([changed,b],{rows:[row(a),row(b)]}),/Comp\. code/);
    }],
    ['reference cannot reuse one computed occurrence twice',()=>{
        assert.throws(()=>api.reconcile([a,b],{rows:[row(a),row(a)]}),/differ/);
    }],
    ['reference parser preserves multiline and escaped quotes',()=>{
        assert.equal(JSON.stringify(api.parse('a,b\r\n"x\r\ny","q""r"\r\n')),
            JSON.stringify([['a','b'],['x\r\ny','q"r']]));
    }]
    ,['numeric measure formatting is distinct from identifier identity',()=>{
        const numeric={...a,'Size 1 (DN)':15};const expected=row(numeric);expected[12]='15.0';
        assert.equal(JSON.stringify(api.reconcile([numeric],{rows:[expected]})),'[0]');
        expected[26]='0'+expected[26];
        assert.throws(()=>api.reconcile([numeric],{rows:[expected]}),/differ/);
    }]
];
let failures=0;
for(const [name,test]of tests){try{test();console.log('PASS '+name);}catch(e){failures++;console.log('FAIL '+name+': '+e.message);}}
console.log(`${tests.length-failures}/${tests.length} passed`);process.exitCode=failures?1:0;
