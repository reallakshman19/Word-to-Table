// Original-byte IndexedDB custody, separate from extraction, semantics and UI mapping.
import { PreserveError, identify, readInputBytes, publicError } from './identity.js';
import { inventoryZip } from './package_inventory.js';

const DB_NAME = 'doc2table-preserve-v1';
const DB_VERSION = 1;
const request = r => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error || new Error('IndexedDB request failed'));
});
const transactionDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error || new PreserveError('STORAGE_ABORTED', 'Transaction aborted.'));
  tx.onerror = () => reject(tx.error || new PreserveError('STORAGE_ERROR', 'Transaction failed.'));
});
const storageError = error => error instanceof PreserveError ? error : new PreserveError(
  error?.name === 'QuotaExceededError' ? 'STORAGE_QUOTA' :
  error?.name === 'SecurityError' ? 'STORAGE_DENIED' : 'STORAGE_FAILED',
  `Durable browser storage failed (${error?.name || 'unknown'}). No persistence success is claimed.`, error
);

// Atomic reservation happens BEFORE reading/hash/inventory. IndexedDB serializes
// readwrite transactions across browser tabs. A later reservation invalidates
// older attempts before they can publish the durable selected pointer.
export async function openPreserveStore(indexedDBFactory = globalThis.indexedDB) {
  if (!indexedDBFactory) throw new PreserveError('STORAGE_MISSING', 'IndexedDB unavailable; cannot claim durable custody.');
  let db;
  try {
    const opening = indexedDBFactory.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const d = opening.result;
      if (!d.objectStoreNames.contains('artifacts')) d.createObjectStore('artifacts', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    db = await request(opening);
  } catch (e) { throw storageError(e); }
  return {
    async reserve(attemptId) {
      try {
        const tx = db.transaction('meta', 'readwrite');
        const done = transactionDone(tx);
        const meta = tx.objectStore('meta');
        const old = await request(meta.get('generation'));
        const generation = (old?.value || 0) + 1;
        if (!Number.isSafeInteger(generation)) throw new PreserveError('GENERATION_LIMIT', 'Storage generation exhausted.');
        meta.put({ key: 'generation', value: generation, attemptId });
        await done;
        return generation;
      } catch (e) { throw storageError(e); }
    },
    async save(record, attemptId, generation, signal) {
      if (signal?.aborted) throw new PreserveError('CANCELLED', 'Selection cancelled before storage.');
      let tx;
      try {
        tx = db.transaction(['artifacts', 'meta'], 'readwrite');
        const done = transactionDone(tx);
        const abort = () => { try { tx.abort(); } catch { /* already completed */ } };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          const meta = tx.objectStore('meta');
          const latest = await request(meta.get('generation'));
          if (signal?.aborted || latest?.value !== generation || latest?.attemptId !== attemptId) {
            tx.abort();
            await done.catch(() => {});
            throw new PreserveError('STALE_STORAGE', 'A newer selection reserved durable storage; stale result refused.');
          }
          tx.objectStore('artifacts').put(record);
          meta.put({ key: 'selected', id: record.id, attemptId, generation });
          await done;
          if (signal?.aborted) throw new PreserveError('CANCELLED', 'Selection cancelled after storage.');
        } finally { signal?.removeEventListener('abort', abort); }
      } catch (e) { throw storageError(e); }
    },
    async clearSelectedIf(attemptId) {
      try {
        const tx = db.transaction('meta', 'readwrite');
        const done = transactionDone(tx), meta = tx.objectStore('meta');
        const selected = await request(meta.get('selected'));
        if (selected?.attemptId === attemptId) meta.delete('selected');
        await done;
      } catch (e) { throw storageError(e); }
    },
    async list() {
      try {
        const tx = db.transaction('artifacts', 'readonly');
        const done = transactionDone(tx);
        const records = await request(tx.objectStore('artifacts').getAll());
        await done;
        return records.map(({ bytes, ...metadata }) => metadata);
      } catch (e) { throw storageError(e); }
    },
    async getStored(id) {
      try {
        const tx = db.transaction('artifacts', 'readonly');
        const done = transactionDone(tx);
        const record = await request(tx.objectStore('artifacts').get(id));
        await done;
        return record;
      } catch (e) { throw storageError(e); }
    },
    async getSelected() {
      try {
        const tx = db.transaction(['meta', 'artifacts'], 'readonly');
        const done = transactionDone(tx);
        const selected = await request(tx.objectStore('meta').get('selected'));
        const record = selected ? await request(tx.objectStore('artifacts').get(selected.id)) : null;
        await done;
        if (selected && !record) throw new PreserveError('STORED_SOURCE_MISSING', 'Selected source is missing.');
        return record;
      } catch (e) { throw storageError(e); }
    },
    close() { db.close(); }
  };
}

export function createPreserveSession(store, adapters = {}) {
  const read = adapters.read || readInputBytes;
  const identity = adapters.identity || identify;
  const inventory = adapters.inventory || inventoryZip;
  let generation = 0, active = null;
  let state = { status: 'idle', attempt: generation, error: null, record: null };
  const stale = n => ({ status: 'stale', attempt: n, error: { code: 'STALE_ATTEMPT' }, record: null });
  const current = n => {
    if (n !== generation || active?.signal?.aborted) throw new PreserveError('STALE_ATTEMPT', 'Superseded operation cannot update the result.');
  };
  const begin = () => { if (active) active.abort(); active = null; return ++generation; };
  const verify = async record => {
    if (!record) throw new PreserveError('STORED_SOURCE_MISSING', 'Stored original is missing.');
    const bytes = new Uint8Array(record.bytes);
    const id = await identity(bytes);
    if (id.sha256 !== record.sha256 || id.byteLength !== record.byteLength ||
        record.id !== `${id.sha256}:${id.byteLength}`) {
      throw new PreserveError('STORED_SOURCE_CHANGED', 'Stored source hash/length mismatch.');
    }
    const pkg = await inventory(bytes);
    if (pkg.inventorySha256 !== record.inventory?.inventorySha256 ||
        pkg.occurrenceCount !== record.inventory?.occurrenceCount) {
      throw new PreserveError('STORED_INVENTORY_CHANGED', 'Stored inventory identity mismatch.');
    }
    const { bytes: ignored, ...details } = record;
    return { ...details, verification: 'byte-and-inventory-verified' };
  };
  return {
    get state() { return state; },
    cancel() {
      const n = begin();
      state = { status: 'cancelled', attempt: n, error: { code: 'CANCELLED' }, record: null };
      return state;
    },
    async select(file) {
      const n = begin(), controller = new AbortController(); active = controller;
      const attemptId = `${Date.now()}-${n}-${globalThis.crypto?.randomUUID?.() || 'no-uuid'}`;
      state = { status: 'working', attempt: n, error: null, record: null };
      let saved = false;
      try {
        if (!file?.name?.toLowerCase().endsWith('.docx')) {
          throw new PreserveError('DOCX_ONLY', 'Only .docx ZIP packages are in scope; .doc is deferred.');
        }
        if (typeof store.reserve !== 'function') throw new PreserveError('STORAGE_GUARD_MISSING', 'Cross-session atomic reservation is required.');
        const durableGen = await store.reserve(attemptId); current(n);
        const bytes = await read(file); current(n);
        const id = await identity(bytes); current(n);
        const pkg = await inventory(bytes); current(n);
        const record = { id: `${id.sha256}:${id.byteLength}`, filename: file.name,
          ...id, bytes: bytes.slice().buffer, inventory: pkg, createdAt: new Date().toISOString() };
        await store.save(record, attemptId, durableGen, controller.signal); saved = true;
        current(n);
        const { bytes: ignored, ...details } = record;
        state = { status: pkg.status === 'indexed-unextracted' ? 'stored-unverified' : 'stored-incomplete',
          attempt: n, error: null, record: details };
        return state;
      } catch (e) {
        const outdated = n !== generation || controller.signal.aborted || e?.code === 'STALE_STORAGE' || e?.code === 'STALE_ATTEMPT';
        if (saved || outdated) {
          try { await store.clearSelectedIf(attemptId); } catch (cleanup) {
            if (n === generation) { state = { status: 'failed', attempt: n, error: publicError(cleanup), record: null }; return state; }
          }
        }
        if (n !== generation || controller.signal.aborted) return stale(n);
        state = { status: 'failed', attempt: n, error: publicError(e), record: null };
        return state;
      } finally { if (n === generation) active = null; }
    },
    async reopen() {
      const n = begin();
      state = { status: 'working', attempt: n, error: null, record: null };
      try {
        const record = await store.getSelected(); current(n);
        if (!record) { state = { status: 'empty', attempt: n, error: null, record: null }; return state; }
        const details = await verify(record); current(n);
        state = { status: record.inventory.status === 'indexed-unextracted' ? 'reopened-unverified' : 'reopened-incomplete',
          attempt: n, error: null, record: details };
      } catch (e) {
        if (n !== generation) return stale(n);
        state = { status: 'failed', attempt: n, error: publicError(e), record: null };
      }
      return state;
    },
    async recoverAll() {
      const n = begin();
      state = { status: 'working', attempt: n, error: null, record: null };
      try {
        const records = await store.list(); current(n);
        const results = [];
        for (const meta of records) {
          try {
            const record = await store.getStored(meta.id); current(n);
            results.push({ id: meta.id, status: 'verified', record: await verify(record) });
            current(n);
          } catch (e) {
            if (n !== generation) return stale(n);
            results.push({ id: meta.id, status: 'failed', error: publicError(e) });
          }
        }
        state = { status: results.every(r => r.status === 'verified') ? 'recovered-all' : 'recovery-incomplete',
          attempt: n, error: null, record: null, results };
      } catch (e) {
        if (n !== generation) return stale(n);
        state = { status: 'failed', attempt: n, error: publicError(e), record: null };
      }
      return state;
    }
  };
}
