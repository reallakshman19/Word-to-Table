// Provisional export policy is independent of the registered-reference qualification.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx=vm.createContext({});
for(const f of ['xy_caps_config.js','xy_caps_export.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../prototype/js',f),'utf8'),ctx);
const columns=vm.runInContext('XYCapsColumns',ctx),api=vm.runInContext('XYCapsExport',ctx);
const record=Object.fromEntries(columns.map(c=>[c,null]));record['MESC number']='1000000001';record['Size 1 (DN)']=50;
const state={data:{records:[record]},csv:'',referenceBinding:null,provisionalEligible:false};
const checks=[
 ['generated rows export without a frozen reference',()=>assert.ok(api.prepare(state,{fresh:true,acknowledged:true}).csv.includes('1000000001'))],
 ['acknowledgement is still required',()=>assert.throws(()=>api.prepare(state,{fresh:true,acknowledged:false}),/acknowledge/i)],
 ['stale data is still blocked',()=>assert.throws(()=>api.prepare(state,{fresh:false,acknowledged:true}),/stale/i)],
 ['zero computed rows are blocked',()=>assert.throws(()=>api.prepare({...state,data:{records:[]}},{fresh:true,acknowledged:true}),/no CAPS rows/i)],
 ['invalid numeric output is blocked',()=>assert.throws(()=>api.prepare({...state,data:{records:[{...record,'Size 1 (DN)':NaN}]}},{fresh:true,acknowledged:true}),/non-finite/i)],
 ['export has the complete 30-column schema',()=>assert.equal(api.csv([record]).split('\n')[0].replace(/^\uFEFF/,'').split(',').length,30)],
 ['formula-like strings are neutralized and raw records stay unchanged',()=>{
  const r={...record,'Mat Description':'=1+1'};assert.ok(api.csv([r]).includes('"\'=1+1"'));assert.equal(r['Mat Description'],'=1+1');
 }],
 ['quotes, commas and newlines stay valid CSV',()=>assert.ok(api.csv([{...record,'Mat Description':'a,"b"\nc'}]).includes('"a,""b""\nc"'))],
 ['verified frozen serialization is retained',()=>{
  const s={...state,csv:'frozen-serialization',referenceBinding:{sha:'registered'},provisionalEligible:true};
  assert.equal(api.prepare(s,{fresh:true,acknowledged:true}).csv,'frozen-serialization');
 }]
];
let fail=0;for(const [name,test] of checks){try{test();console.log('PASS '+name);}catch(e){fail++;console.error('FAIL '+name+': '+e.message);}}
console.log(`${checks.length-fail}/${checks.length} passed`);process.exitCode=fail?1:0;
