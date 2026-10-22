// ZIP32 central-directory occurrence inventory. No extraction, interpretation, or name deduplication.
import { PreserveError, sha256 } from './identity.js';

const MAX_ENTRIES = 10000;
const MAX_CENTRAL_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const hex = a => Array.from(a, x => x.toString(16).padStart(2, '0')).join('');

export async function inventoryZip(source) {
  const b = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const fail = (code, message) => { throw new PreserveError(code, message); };
  const has = (at, n) => Number.isSafeInteger(at) && at >= 0 && n >= 0 && at + n <= b.length;
  const u16 = p => view.getUint16(p, true);
  const u32 = p => view.getUint32(p, true);
  if (b.length < 22) fail('ZIP_TRUNCATED', 'ZIP end-of-central-directory is absent.');
  let end = -1;
  for (let p = b.length - 22; p >= Math.max(0, b.length - 22 - 65535); p--) {
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === b.length) { end = p; break; }
  }
  if (end < 0) fail('ZIP_EOCD_MISSING', 'No valid end-of-central-directory; inventory cannot be certified.');
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) {
    fail('ZIP_MULTI_DISK', 'Multi-disk ZIP is unsupported.');
  }
  const count = u16(end + 10);
  const dirSize = u32(end + 12);
  const dirOffset = u32(end + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    fail('ZIP64_UNSUPPORTED', 'ZIP64 central directory requires a separately qualified adapter.');
  }
  if (count > MAX_ENTRIES || dirSize > MAX_CENTRAL_BYTES) {
    fail('ZIP_LIMIT', 'ZIP inventory exceeds explicitly supported limits.');
  }
  if (!has(dirOffset, dirSize) || dirOffset + dirSize > end) {
    fail('ZIP_DIRECTORY_BOUNDS', 'ZIP central directory points outside source bytes.');
  }
  const entries = [];
  const seen = new Map();
  let p = dirOffset;
  const directoryEnd = dirOffset + dirSize;
  for (let index = 0; index < count; index++) {
    if (!has(p, 46) || p + 46 > directoryEnd || u32(p) !== 0x02014b50) {
      fail('ZIP_CENTRAL_TRUNCATED', `Central directory entry ${index} is missing or truncated.`);
    }
    const flags = u16(p + 8), method = u16(p + 10), crc32 = u32(p + 16);
    const compressedSize = u32(p + 20), uncompressedSize = u32(p + 24);
    const nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32);
    const disk = u16(p + 34), localOffset = u32(p + 42);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (!has(p, 46 + nameLen + extraLen + commentLen) || next > directoryEnd) {
      fail('ZIP_ENTRY_BOUNDS', `Central entry ${index} has invalid name/extra/comment bounds.`);
    }
    const nameBytes = b.subarray(p + 46, p + 46 + nameLen);
    const nameHex = hex(nameBytes);
    // Non-UTF-8 ZIP names have an unspecified legacy code page: preserve bytes, do not guess.
    const utf8 = !!(flags & 0x800);
    let name = null;
    if (utf8) {
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); }
      catch { /* preserve the raw bytes and visibly mark the name opaque */ }
    }
    const entry = {
      index, name, nameBytesHex: nameHex, nameEncoding: utf8 ? 'utf8' : 'legacy-unknown',
      flags, method, crc32, compressedSize, uncompressedSize, localOffset,
      centralOffset: p, disk, extraBytesHex: hex(b.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen)),
      commentBytesHex: hex(b.subarray(p + 46 + nameLen + extraLen, next)),
      duplicateOf: seen.has(nameHex) ? seen.get(nameHex) : null,
      status: 'indexed', problem: null
    };
    if (!seen.has(nameHex)) seen.set(nameHex, index);
    if (disk || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      entry.status = 'opaque'; entry.problem = 'ZIP64_OR_DISK_UNSUPPORTED';
    } else if (flags & 0x1) {
      entry.status = 'opaque'; entry.problem = 'ENCRYPTED_ENTRY';
    } else if (method !== 0 && method !== 8) {
      entry.status = 'opaque'; entry.problem = 'UNSUPPORTED_COMPRESSION';
    } else if (!has(localOffset, 30) || u32(localOffset) !== 0x04034b50) {
      entry.status = 'read-error'; entry.problem = 'LOCAL_HEADER_MISSING';
    } else {
      const localNameLen = u16(localOffset + 26);
      const localExtraLen = u16(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
      const localName = b.subarray(localOffset + 30, localOffset + 30 + localNameLen);
      if (!has(localOffset, 30 + localNameLen + localExtraLen) ||
          !has(dataOffset, compressedSize) || hex(localName) !== nameHex ||
          u16(localOffset + 8) !== method) {
        entry.status = 'read-error'; entry.problem = 'LOCAL_DATA_MISMATCH';
      } else {
        entry.dataOffset = dataOffset;
        entry.dataDescriptor = !!(flags & 0x8);
      }
    }
    entries.push(entry); p = next;
  }
  if (p !== directoryEnd) fail('ZIP_ENTRY_COUNT_MISMATCH', 'Central directory size and entry count disagree.');
  const fingerprint = await sha256(encoder.encode(JSON.stringify(entries)));
  return {
    format: 'ZIP32', occurrenceCount: entries.length, inventorySha256: fingerprint,
    status: entries.every(e => e.status === 'indexed') ? 'indexed-unextracted' : 'incomplete',
    entries
  };
}
