import test from 'node:test';
import assert from 'node:assert/strict';
import { identify, PreserveError } from '../../js/core/identity.js';
import { inventoryZip } from '../../js/core/package_inventory.js';
import { createPreserveSession, openPreserveStore } from '../../js/core/artifacts.js';

// SYNTHETIC ZIP builder, intentionally including duplicate occurrence names.
function makeZip(specs) {
  const output = [], directory = [];
  const u16 = x => [x & 255, (x >>> 8) & 255];
  const u32 = x => [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255];
  const append = (...arrays) => arrays.forEach(a => output.push(...a));
  const enc = new TextEncoder();
  for (const s of specs) {
    const name = enc.encode(s.name), payload = enc.encode(s.value || '');
    const offset = output.length, method = s.method ?? 0;
    append(u32(0x04034b50),u16(20),u16(0x800),u16(method),u16(0),u16(0),u32(0),u32(payload.length),u32(payload.length),u16(name.length),u16(0),name,payload);
    directory.push({offset,name,payload,method});
  }
  const centralOffset = output.length;
  for (const x of directory) {
    append(u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(x.method),u16(0),u16(0),u32(0),u32(x.payload.length),u32(x.payload.length),u16(x.name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(x.offset),x.name);
  }
  const centralSize = output.length - centralOffset;
  append(u32(0x06054b50),u16(0),u16(0),u16(directory.length),u16(directory.length),u32(centralSize),u32(centralOffset),u16(0));
  return new Uint8Array(output);
}
const file = (name, bytes) => ({name, size:bytes.length, arrayBuffer:async()=>bytes.slice().buffer});
const memoryStore = () => {
  let records = new Map(), selected;
  return {
    async save(record, attemptId, signal) {
      if (signal?.aborted) throw new PreserveError('CANCELLED', 'abort');
      records.set(record.id, record); selected={id:record.id,attemptId};
    },
    async getSelected() { return selected ? records.get(selected.id) : null; },
    async clearSelectedIf(id) { if (selected?.attemptId === id) selected=undefined; },
    mutateBytes(transform) {
      const r = records.get(selected.id);
      r.bytes=transform(r.bytes);
    },
    get selection() { return selected; }
  };
};

test('synthetic: exact byte SHA-256 and repeated names remain separate occurrences', async () => {
  const bytes = makeZip([{name:'word/document.xml',value:'one'}, {name:'word/document.xml',value:'two'}, {name:'custom/thing.bin',value:'x'}]);
  const original = bytes.slice(), ident = await identify(bytes), inv = await inventoryZip(bytes);
  assert.equal(inv.occurrenceCount, 3);
  assert.equal(inv.entries[0].duplicateOf, null);
  assert.equal(inv.entries[1].duplicateOf, 0);
  assert.equal(inv.entries[2].duplicateOf, null);
  assert.equal(inv.status,'indexed-unextracted');
  assert.equal(ident.byteLength,bytes.length);
  assert.match(ident.sha256,/^[0-9a-f]{64}$/);
  const store=memoryStore(), session=createPreserveSession(store);
  const selected=await session.select(file('synthetic.docx',bytes));
  assert.equal(selected.status,'stored-unverified');
  bytes[0]^=255;
  assert.equal(await session.reopen().then(r=>r.status),'reopened-unverified');
  assert.equal(ident.sha256,(await identify(original)).sha256);
});

test('synthetic: encrypted/unsupported entries are opaque, local failures explicit',async()=>{
  const unsupported=await inventoryZip(makeZip([{name:'opaque.bin',value:'not decoded',method:99}]));
  assert.equal(unsupported.entries[0].status,'opaque');
  assert.equal(unsupported.entries[0].problem,'UNSUPPORTED_COMPRESSION');
  const invalid=makeZip([{name:'a',value:'a'}]);
  invalid[0]=0;
  const broken=await inventoryZip(invalid);
  assert.equal(broken.entries[0].status,'read-error');
  assert.equal(broken.entries[0].problem,'LOCAL_HEADER_MISSING');
  await assert.rejects(inventoryZip(invalid.slice(0,invalid.length-5)),e=>e.code==='ZIP_EOCD_MISSING');
});

test('synthetic: storage missing and denied/quota errors never report durable success',async()=>{
  await assert.rejects(openPreserveStore(null), e=>e.code==='STORAGE_MISSING');
  const bytes=makeZip([{name:'x',value:'a'}]);
  for(const reason of ['QuotaExceededError','SecurityError']) {
    const store=memoryStore(); store.save=async()=>{throw Object.assign(new Error('blocked'),{name:reason})};
    const result=await createPreserveSession(store).select(file('synthetic.docx',bytes));
    assert.equal(result.status,'failed');
    assert.equal(result.error.code,reason);
  }
});

test('synthetic: cancelled/late read cannot select a stale result',async()=>{
  const bytes=makeZip([{name:'x',value:'a'}]);
  let resume;
  const delayed={name:'synthetic.docx',size:bytes.length,arrayBuffer:()=>new Promise(resolve=>{resume=()=>resolve(bytes.slice().buffer)})};
  const store=memoryStore(), session=createPreserveSession(store);
  const old=session.select(delayed);
  session.cancel();
  const fresh=await session.select(file('new.docx',bytes));
  resume();
  assert.equal((await old).status,'stale');
  assert.equal(fresh.status,'stored-unverified');
  assert.equal(store.selection.id,fresh.record.id);
});

test('synthetic: mutation of durable bytes is detected on reopening',async()=>{
  const bytes=makeZip([{name:'x',value:'a'}]);
  const store=memoryStore(), session=createPreserveSession(store);
  await session.select(file('synthetic.docx',bytes));
  store.mutateBytes(b=>{const v=new Uint8Array(b.slice(0));v[0]^=1;return v.buffer});
  const reopened=await session.reopen();
  assert.equal(reopened.status,'failed');
  assert.equal(reopened.error.code,'STORED_SOURCE_CHANGED');
});

test('synthetic: non-ZIP and legacy .doc fail closed',async()=>{
  const store=memoryStore(), session=createPreserveSession(store);
  assert.equal((await session.select(file('legacy.doc',new Uint8Array([1,2])))).error.code,'DOCX_ONLY');
  const result=await session.select(file('nozip.docx',new Uint8Array([1,2])));
  assert.equal(result.status,'failed');
  assert.equal(result.error.code,'ZIP_TRUNCATED');
});
