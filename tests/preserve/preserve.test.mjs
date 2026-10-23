// Deterministic SYNTHETIC controls. Real-browser IndexedDB and original documents are separate evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identify, PreserveError } from '../../js/core/identity.js';
import { inventoryZip } from '../../js/core/package_inventory.js';
import { createPreserveSession, openPreserveStore } from '../../js/core/artifacts.js';

function zip(specs) {
  const out = [], central = [], enc = new TextEncoder();
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const put = (...parts) => parts.forEach(p => out.push(...p));
  for (const s of specs) {
    const name = s.rawName || enc.encode(s.name), body = enc.encode(s.value || ''), offset = out.length;
    const flags = s.flags ?? 0x800, method = s.method ?? 0;
    put(u32(0x04034b50), u16(20), u16(s.localFlags ?? flags), u16(method),u16(0),u16(0),u32(0),
      u32(body.length),u32(body.length),u16(name.length),u16(0), name,body);
    central.push({ name, body, offset, flags, method });
  }
  const centralOffset=out.length;
  for (const x of central) {
    put(u32(0x02014b50),u16(20),u16(20),u16(x.flags),u16(x.method),u16(0),u16(0),u32(0),
      u32(x.body.length),u32(x.body.length),u16(x.name.length),u16(0),u16(0),u16(0),u16(0),
      u32(0),u32(x.offset),x.name);
  }
  const centralSize=out.length-centralOffset;
  put(u32(0x06054b50),u16(0),u16(0),u16(central.length),u16(central.length),
    u32(centralSize),u32(centralOffset),u16(0));
  return new Uint8Array(out);
}
const file=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
function memoryDB() {
  const records = new Map();
  let generation=0, reservation=null, selected=null;
  // Shared by several sessions. Serial ordering and CAS simulate one IndexedDB metadata transaction.
  const store=()=>({
    async reserve(attemptId) {generation++;reservation={attemptId,generation};return generation;},
    async save(record,attemptId,number,signal) {
      if(signal?.aborted)throw new PreserveError('CANCELLED','aborted');
      if(reservation.attemptId!==attemptId||generation!==number)throw new PreserveError('STALE_STORAGE','stale');
      records.set(record.id, structuredClone(record));selected={id:record.id,attemptId};
    },
    async clearSelectedIf(attemptId){if(selected?.attemptId===attemptId)selected=null;},
    async getSelected(){return selected?structuredClone(records.get(selected.id)):null;},
    async getStored(id){return records.has(id)?structuredClone(records.get(id)):null;},
    async list(){return [...records.values()].map(({bytes,...metadata})=>structuredClone(metadata));},
    mutateSelectedBytes(transform){const r=records.get(selected.id);r.bytes=transform(r.bytes);},
    mutateSelectedInventory(transform){const r=records.get(selected.id);r.inventory=transform(r.inventory);},
    get pointer(){return selected;}
  });
  return store;
}
const one=()=>zip([{name:'word/document.xml',value:'one'}]);
const two=()=>zip([{name:'word/document.xml',value:'two'}]);

// Original regressions, with test titles limited to what was actually exercised.
test('synthetic: SHA-256, immutable custody and duplicate central-directory occurrences',async()=>{
  const bytes=zip([{name:'x',value:'1'},{name:'x',value:'2'},{name:'y',value:'3'}]);
  const inv=await inventoryZip(bytes), id=await identify(bytes);
  assert.equal(inv.occurrenceCount,3);assert.equal(inv.entries[1].duplicateOf,0);
  assert.match(id.sha256,/^[a-f0-9]{64}$/);
  const db=memoryDB(),session=createPreserveSession(db());
  assert.equal((await session.select(file('x.docx',bytes))).status,'stored-unverified');
  bytes[0]^=255;
  assert.equal((await session.reopen()).status,'reopened-unverified');
});
test('synthetic: method 99 is unsupported compression, NOT an encryption control',async()=>{
  const opaque=await inventoryZip(zip([{name:'x',value:'1',method:99}]));
  assert.equal(opaque.entries[0].status,'opaque');
  assert.equal(opaque.entries[0].problem,'UNSUPPORTED_COMPRESSION');
  const corrupt=one();corrupt[0]=0;
  const broken=await inventoryZip(corrupt);
  assert.equal(broken.entries[0].status,'read-error');
  assert.equal(broken.entries[0].problem,'LOCAL_HEADER_MISSING');
  await assert.rejects(inventoryZip(corrupt.subarray(0,corrupt.length-3)),e=>e.code==='ZIP_EOCD_MISSING');
});
test('synthetic: missing/denied/quota adapter fails without durable claim',async()=>{
  await assert.rejects(openPreserveStore(null),e=>e.code==='STORAGE_MISSING');
  for (const name of ['QuotaExceededError','SecurityError']) {
    const db=memoryDB()();db.save=async()=>{throw Object.assign(new Error('denied'),{name})};
    assert.equal((await createPreserveSession(db).select(file('x.docx',one()))).status,'failed');
  }
});
test('synthetic: delayed input after cancel cannot override a newer selection',async()=>{
  const db=memoryDB(),session=createPreserveSession(db());let resume;
  const old=session.select({name:'x.docx',arrayBuffer:()=>new Promise(r=>resume=()=>r(one().buffer))});
  // Reservation finishes before delayed input is read.
  await new Promise(resolve=>setImmediate(resolve));
  session.cancel();const newer=await session.select(file('new.docx',two()));resume();
  assert.equal((await old).status,'stale');assert.equal(newer.status,'stored-unverified');
});
test('synthetic: durable byte tampering is detected on reopen',async()=>{
  const db=memoryDB()(),session=createPreserveSession(db);
  await session.select(file('x.docx',one()));
  db.mutateSelectedBytes(b=>{const v=new Uint8Array(b.slice(0));v[0]^=1;return v.buffer;});
  assert.equal((await session.reopen()).error.code,'STORED_SOURCE_CHANGED');
});
test('synthetic: .doc and non-ZIP fail closed',async()=>{
  const session=createPreserveSession(memoryDB()());
  assert.equal((await session.select(file('legacy.doc',one()))).error.code,'DOCX_ONLY');
  assert.equal((await session.select(file('none.docx',new Uint8Array([1,2])))).error.code,'ZIP_TRUNCATED');
});

// Oracle TO8 decisive interleavings.
test('A: successful delayed reopen never overwrites newer select',async()=>{
  const db=memoryDB(),store=db(),session=createPreserveSession(store);
  await session.select(file('first.docx',one()));
  let release, reached;const barrier=new Promise(r=>release=r);
  const entered=new Promise(r=>reached=r);
  store.getSelected=async()=>{reached();await barrier;return null;};
  const slow=session.reopen();await entered;
  const newer=await session.select(file('second.docx',two()));release();
  assert.equal(newer.status,'stored-unverified');
  assert.equal((await slow).status,'stale');
  assert.equal(session.state.record.filename,'second.docx');
});
test('A: delayed failed reopen cannot overwrite cancel',async()=>{
  const store=memoryDB()(),session=createPreserveSession(store);
  let release,entered;const barrier=new Promise(r=>release=r), waiting=new Promise(r=>entered=r);
  store.getSelected=async()=>{entered();await barrier;throw new PreserveError('STORAGE_FAILED','simulated');};
  const slow=session.reopen();await waiting;
  session.cancel();release();
  assert.equal((await slow).status,'stale');assert.equal(session.state.status,'cancelled');
});
test('B: older session A slow save cannot replace session B pointer',async()=>{
  const store=memoryDB();
  const a=createPreserveSession(store()),b=createPreserveSession(store());
  let release,entered;const barrier=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
  const delayed={name:'old.docx',arrayBuffer:async()=>{entered();await barrier;return one().buffer;}};
  const old=a.select(delayed);await waiting;
  const good=await b.select(file('new.docx',two()));release();
  const stale=await old;
  assert.equal(good.status,'stored-unverified');
  assert.equal(stale.status,'failed');assert.equal(stale.error.code,'STALE_STORAGE');
  assert.equal((await b.reopen()).record.filename,'new.docx');
});
test('B: canceled after in-flight save does not leave false selected success',async()=>{
  const store=memoryDB()(),session=createPreserveSession(store);
  let release, entered;const barrier=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
  const save=store.save.bind(store);
  store.save=async (...args)=>{entered();await barrier;return save(...args);};
  const slow=session.select(file('x.docx',one()));await waiting;
  session.cancel();release();
  assert.equal((await slow).status,'stale');
  assert.equal((await session.reopen()).status,'empty');
});
test('C: new session recovers each of two distinct stored source IDs',async()=>{
  const factory=memoryDB(),old=createPreserveSession(factory());
  const first=await old.select(file('first.docx',one()));
  const second=await old.select(file('second.docx',two()));
  const reopened=createPreserveSession(factory());
  const result=await reopened.recoverAll();
  assert.equal(result.status,'recovered-all');assert.equal(result.results.length,2);
  assert.deepEqual(result.results.map(r=>r.record.sha256).sort(),[first.record.sha256,second.record.sha256].sort());
  assert.equal(result.results.every(r=>r.record.verification==='byte-and-inventory-verified'),true);
});
test('C: per-source recovery reports altered source without concealing another verified source',async()=>{
  const factory=memoryDB(),original=factory(),old=createPreserveSession(original);
  await old.select(file('first.docx',one())); await old.select(file('second.docx',two()));
  original.mutateSelectedBytes(b=>{const v=new Uint8Array(b.slice(0));v[0]^=1;return v.buffer;});
  const check=await createPreserveSession(factory()).recoverAll();
  assert.equal(check.status,'recovery-incomplete');
  assert.equal(check.results.filter(r=>r.status==='verified').length,1);
  assert.equal(check.results.filter(r=>r.status==='failed').length,1);
});
test('D: malformed UTF-8 raw filename survives with explicit independent decoding problem',async()=>{
  const result=await inventoryZip(zip([{rawName:new Uint8Array([0xc3,0x28]),flags:0x800,value:'x'}]));
  assert.equal(result.occurrenceCount,1);
  assert.equal(result.status,'indexed-unextracted');
  assert.equal(result.entries[0].name,null);
  assert.equal(result.entries[0].nameBytesHex,'c328');
  assert.equal(result.entries[0].decodingProblem,'INVALID_UTF8_NAME');
  assert.equal(result.entries[0].status,'indexed');
});
test('D: mismatched central/local flags explicitly fail member access without losing occurrence',async()=>{
  const result=await inventoryZip(zip([{name:'x',flags:0x800,localFlags:0}]));
  assert.equal(result.occurrenceCount,1);
  assert.equal(result.entries[0].status,'read-error');
  assert.equal(result.entries[0].problem,'LOCAL_DATA_MISMATCH');
});
