// Original-byte custody in IndexedDB, separate from any table parser or UI state.
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
  tx.onerror = () => reject(tx.error || new PreserveError('STORAGE_ERROR', 'IndexedDB transaction failed.'));
});
const storageError = error => new PreserveError(
  error?.name === 'QuotaExceededError' ? 'STORAGE_QUOTA' :
  error?.name === 'SecurityError' ? 'STORAGE_DENIED' : 'STORAGE_FAILED',
  `Durable browser storage failed (${error?.name || 'unknown'}). No persistence success is claimed.`, error
);

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
    async save(record, attemptId, signal) {
      if (signal?.aborted) throw new PreserveError('CANCELLED', 'This selection was cancelled.');
      let tx;
      try {
        tx = db.transaction(['artifacts', 'meta'], 'readwrite');
        const done = transactionDone(tx); // listeners installed before requests
        const abort = () => { try { tx.abort(); } catch { /* already completed */ } };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          tx.objectStore('artifacts').put(record);
          tx.objectStore('meta').put({ key: 'selected', id: record.id, attemptId });
          await done;
        } finally { signal?.removeEventListener('abort', abort); }
      } catch (e) {
        if (signal?.aborted) throw new PreserveError('CANCELLED', 'Selection cancelled during storage.', e);
        throw storageError(e);
      }
    },
    async clearSelectedIf(attemptId) {
      const tx = db.transaction('meta', 'readwrite');
      const done = transactionDone(tx);
      const store = tx.objectStore('meta');
      const item = await request(store.get('selected'));
      if (item?.attemptId === attemptId) store.delete('selected');
      await done;
    },
    async list() {
      const tx = db.transaction('artifacts', 'readonly');
      const done = transactionDone(tx);
      const records = await request(tx.objectStore('artifacts').getAll());
      await done;
      // Do not expose stored bytes via list output.
      return records.map(({ bytes, ...publicRecord }) => publicRecord);
    },
    async getSelected() {
      const tx = db.transaction(['meta', 'artifacts'], 'readonly');
      const done = transactionDone(tx);
      const meta = await request(tx.objectStore('meta').get('selected'));
      const record = meta ? await request(tx.objectStore('artifacts').get(meta.id)) : null;
      await done;
      if (meta && !record) throw new PreserveError('STORED_SOURCE_MISSING', 'Selected original is missing from storage.');
      return record;
    },
    close() { db.close(); }
  };
}

export function createPreserveSession(store, adapters = {}) {
  const read = adapters.read || readInputBytes;
  const identity = adapters.identity || identify;
  const inventory = adapters.inventory || inventoryZip;
  let version = 0, active = null;
  let state = { status: 'idle', attempt: 0, error: null, record: null };
  const current = n => {
    if (n !== version || active?.signal.aborted) throw new PreserveError('STALE_ATTEMPT', 'Cancelled/superseded attempt cannot select a result.');
  };
  return {
    get state() { return state; },
    cancel() {
      if (active) { active.abort(); version++; active = null; state = { status: 'cancelled', attempt: version, error: { code: 'CANCELLED' }, record: null }; }
      return state;
    },
    async select(file) {
      this.cancel();
      const n = ++version, controller = new AbortController(); active = controller;
      const attemptId = `${Date.now()}-${n}-${globalThis.crypto?.randomUUID?.() || 'fallback'}`;
      state = { status: 'working', attempt: n, error: null, record: null };
      try {
        if (!file?.name?.toLowerCase().endsWith('.docx')) {
          throw new PreserveError('DOCX_ONLY', 'Only .docx ZIP packages are in scope; legacy .doc is deferred.');
        }
        const bytes = await read(file); current(n);
        const id = await identity(bytes); current(n);
        const pkg = await inventory(bytes); current(n);
        const record = { id: `${id.sha256}:${id.byteLength}`, filename: file.name,
          ...id, bytes: bytes.slice().buffer, inventory: pkg, createdAt: new Date().toISOString() };
        await store.save(record, attemptId, controller.signal);
        current(n);
        const { bytes: ignored, ...details } = record;
        state = { status: pkg.status === 'indexed-unextracted' ? 'stored-unverified' : 'stored-incomplete',
          attempt: n, error: null, record: details };
        return state;
      } catch (e) {
        if (e.code === 'STALE_ATTEMPT' || e.code === 'CANCELLED' || n !== version) {
          // A stale save may have reached durable storage: clear only its exact pointer.
          try { await store.clearSelectedIf(attemptId); } catch { /* surfaced on reopen */ }
          return { status: 'stale', attempt: n, error: publicError(e), record: null };
        }
        state = { status: 'failed', attempt: n, error: publicError(e), record: null };
        return state;
      } finally { if (n === version) active = null; }
    },
    async reopen() {
      try {
        const record = await store.getSelected();
        if (!record) { state = { status: 'empty', attempt: version, error: null, record: null }; return state; }
        const bytes = new Uint8Array(record.bytes);
        const currentIdentity = await identity(bytes);
        if (currentIdentity.sha256 !== record.sha256 || currentIdentity.byteLength !== record.byteLength) {
          throw new PreserveError('STORED_SOURCE_CHANGED', 'Stored original hash/length mismatch; no restored success.');
        }
        const pkg = await inventory(bytes);
        if (pkg.inventorySha256 !== record.inventory.inventorySha256 ||
            pkg.occurrenceCount !== record.inventory.occurrenceCount) {
          throw new PreserveError('STORED_INVENTORY_CHANGED', 'Saved inventory identity mismatch.');
        }
        const { bytes: ignored, ...details } = record;
        state = { status: pkg.status === 'indexed-unextracted' ? 'reopened-unverified' : 'reopened-incomplete',
          attempt: version, error: null, record: details };
      } catch (e) { state = { status: 'failed', attempt: version, error: publicError(e), record: null }; }
      return state;
    }
  };
}
