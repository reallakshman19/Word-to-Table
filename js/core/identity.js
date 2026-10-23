// T-PRESERVE: bytes and SHA-256, not text/table extraction.
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

export class PreserveError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'PreserveError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export async function readInputBytes(input, limit = MAX_SOURCE_BYTES) {
  if (!input || typeof input.arrayBuffer !== 'function') {
    throw new PreserveError('NO_SOURCE', 'Select an original .docx file.');
  }
  if (Number.isFinite(input.size) && input.size > limit) {
    throw new PreserveError('SIZE_LIMIT', `Source exceeds ${limit} bytes; nothing has been stored.`);
  }
  let bytes;
  try { bytes = new Uint8Array(await input.arrayBuffer()); }
  catch (cause) { throw new PreserveError('READ_FAILED', 'Original file could not be read.', cause); }
  if (bytes.length > limit) throw new PreserveError('SIZE_LIMIT', 'Source grew beyond the input limit.');
  // Own a fresh copy; never persist an input view that callers can mutate.
  return bytes.slice();
}

export async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new PreserveError('CRYPTO_MISSING', 'SHA-256 is unavailable; custody refused.');
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const own = view.slice();
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', own));
  return Array.from(digest, x => x.toString(16).padStart(2, '0')).join('');
}

export async function identify(bytes) {
  return { algorithm: 'SHA-256', sha256: await sha256(bytes), byteLength: bytes.byteLength };
}

export function publicError(error) {
  return { code: error?.code || error?.name || 'UNKNOWN', message: error?.message || String(error) };
}
