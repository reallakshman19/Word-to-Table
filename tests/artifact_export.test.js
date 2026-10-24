const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash,webcrypto}=require('node:crypto');
globalThis.crypto ||= webcrypto;
const ArtifactExport=require('../js/artifact_export.js');
function table(name, csv, rows=[['A'],['B']]) {
 return {tableName:name,headers:rows[0],dataRows:rows.slice(1),csv,tableIndex:1};
}
test('F6-CSV: exact exported bytes hash and selected-grid parity',async()=>{
 const data=[table('Only_First','A\nB'),table('Excluded','Z\nY',[['Z'],['Y']])];
 const res=await ArtifactExport.prepare(data,[0],'individual',false,{tables:[]});
 assert.equal(res.files.length,1);
 assert.equal(res.files[0].name,'Only_First.csv');
 assert.deepEqual(ArtifactExport.csvRows(new TextDecoder().decode(res.files[0].bytes)),[['A'],['B']]);
 const observed=createHash('sha256').update(res.files[0].bytes).digest('hex');
 assert.equal(res.manifest.files[0].sha256,observed);
 assert.deepEqual(res.manifest.selectedIndices,[0]);
 assert.equal(res.manifest.preparedBytesVerified,true);
 assert.equal(res.manifest.deliveredFileBytesVerified,false);
 assert.equal(res.manifest.originalDocxFidelityVerified,false);
});
test('F6-TAMPER: stale cached CSV is not exported or falsely accepted as current',async()=>{
 const data=[table('Corrupt','A\nSOME_OTHER_VALUE')];
 const result=await ArtifactExport.prepare(data,[0],'individual',false);
 assert.equal(result.manifest.files[0].legacyCsvRegenerated,true);
 const bytes=new TextDecoder().decode(result.files[0].bytes);
 assert.deepEqual(ArtifactExport.csvRows(bytes),[['A'],['B']]);
 assert.ok(!bytes.includes('SOME_OTHER_VALUE'));
});
test('F6-MUTATION: changed file bytes fail hash before browser download',async()=>{
 const result=await ArtifactExport.prepare([table('Good','A\nB')],[0],'individual',false);
 result.files[0].bytes[3]^=1;
 await assert.rejects(()=>ArtifactExport.download(result),/buffer changed/);
});
test('F6-SELECTION: repeated/out-of-range indices cannot export',async()=>{
 const data=[table('Good','A\nB')];
 await assert.rejects(()=>ArtifactExport.prepare(data,[0,0],'individual',false),/Invalid or repeated/);
 await assert.rejects(()=>ArtifactExport.prepare(data,[5],'individual',false),/Invalid or repeated/);
});
test('F6-CSV: quoting, embedded LF and CRLF retain rows on byte readback',async()=>{
 const rows=[['A','B'],['x,y','z"\nq']];
 const src='A,B\r\n"x,y","z""\nq"';
 const got=await ArtifactExport.prepare([table('Q',src,rows)],[0],'individual',false);
 assert.deepEqual(ArtifactExport.csvRows(new TextDecoder().decode(got.files[0].bytes)),rows);
});
test('F6-NAME: collisions get distinct CSV filenames',async()=>{
 const data=[table('Same','A\nB'),table('Same','A\nB')];
 const got=await ArtifactExport.prepare(data,[0,1],'individual',false);
 assert.deepEqual(got.files.map(x=>x.name),['Same.csv','Same_2.csv']);
});
