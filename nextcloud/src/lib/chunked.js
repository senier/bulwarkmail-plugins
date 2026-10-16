// Uploads to Nextcloud. Small files go up in one PUT. Bigger ones use
// Nextcloud's chunked upload v2: MKCOL an upload folder, PUT numbered
// chunks, then MOVE the virtual ".file" to the destination. The upload
// folder is remembered per file, so a cancelled or failed upload resumes
// with the chunks the server already has.

import { ncRequest } from './client.js';
import { NcError } from './errors.js';
import { davFilesUrl, davUploadsUrl } from './paths.js';
import { parseMultistatus, decodeXml } from './webdav.js';

export const CHUNK_SIZE = 10 * 1024 * 1024;
export const UPLOADS_KEY = 'uploads';
const RETRYABLE = new Set(['unreachable', 'timeout', 'server', 'maintenance', 'rate_limited']);

/** Identifies "the same file to the same place" across attempts. */
export function resumeKey(destPath, file) {
  return `${destPath}|${file.size}|${file.lastModified ?? 0}|${file.name ?? ''}`;
}

function newUploadId() {
  return `bulwark-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function chunkName(index) {
  return String(index + 1).padStart(5, '0');
}

/** The chunks already on the server: name -> size. Null when the upload folder is gone. */
export async function listChunks(api, conn, uploadId) {
  let res;
  try {
    res = await ncRequest(api, davUploadsUrl((conn.base ?? conn.origin), conn.userId, uploadId), {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>',
      responseType: 'text',
    });
  } catch (err) {
    if (err instanceof NcError && err.code === 'not_found') return null;
    throw err;
  }
  const chunks = new Map();
  for (const { href, props } of parseMultistatus(res.body)) {
    const name = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? '');
    if (!/^\d{1,5}$/.test(name)) continue;
    chunks.set(name.padStart(5, '0'), Number(decodeXml(props.getcontentlength ?? '0')) || 0);
  }
  return chunks;
}

async function withRetry(fn, { retries, signal, wait }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted) throw new NcError('cancelled');
      if (!(err instanceof NcError) || !RETRYABLE.has(err.code) || attempt >= retries) throw err;
      await wait(1000 * (attempt + 1));
    }
  }
}

/**
 * Upload `file` (a Blob/File) to `destPath`. onProgress(loaded, total).
 * Resolves to { path, chunked, resumed }.
 */
export async function uploadFile(api, conn, file, destPath, {
  onProgress, signal, chunkSize = CHUNK_SIZE, retries = 2, wait = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const size = file.size;
  const destUrl = davFilesUrl((conn.base ?? conn.origin), conn.userId, destPath);
  if (size <= chunkSize) {
    await withRetry(() => ncRequest(api, destUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      onProgress,
      signal,
    }), { retries, signal, wait });
    onProgress?.(size, size);
    return { path: destPath, chunked: false, resumed: false };
  }

  const key = resumeKey(destPath, file);
  const saved = (await api.storage.get(UPLOADS_KEY)) ?? {};
  let record = saved[key] ?? null;
  let have = new Map();
  if (record) {
    const listed = await listChunks(api, conn, record.id);
    if (listed) have = listed;
    else record = null;
  }
  const resumed = !!record;
  if (!record) {
    record = { id: newUploadId(), startedAt: Date.now() };
    await ncRequest(api, davUploadsUrl((conn.base ?? conn.origin), conn.userId, record.id), {
      method: 'MKCOL',
      headers: { Destination: destUrl },
      signal,
    });
    await api.storage.set(UPLOADS_KEY, { ...saved, [key]: record });
  }

  const count = Math.ceil(size / chunkSize);
  let sent = 0;
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = Math.min(size, start + chunkSize);
    if (have.get(chunkName(i)) === end - start) sent += end - start;
  }
  onProgress?.(sent, size);

  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw new NcError('cancelled');
    const start = i * chunkSize;
    const end = Math.min(size, start + chunkSize);
    const name = chunkName(i);
    if (have.get(name) === end - start) continue;
    const base = sent;
    await withRetry(() => ncRequest(api, davUploadsUrl((conn.base ?? conn.origin), conn.userId, record.id, name), {
      method: 'PUT',
      headers: { Destination: destUrl, 'OC-Total-Length': String(size), 'Content-Type': 'application/octet-stream' },
      body: file.slice(start, end),
      onProgress: (loaded) => onProgress?.(base + loaded, size),
      signal,
    }), { retries, signal, wait });
    sent += end - start;
    onProgress?.(sent, size);
  }

  await withRetry(() => ncRequest(api, davUploadsUrl((conn.base ?? conn.origin), conn.userId, record.id, '.file'), {
    method: 'MOVE',
    headers: { Destination: destUrl, 'OC-Total-Length': String(size) },
    signal,
  }), { retries, signal, wait });

  const after = (await api.storage.get(UPLOADS_KEY)) ?? {};
  delete after[key];
  await api.storage.set(UPLOADS_KEY, after);
  return { path: destPath, chunked: true, resumed };
}

/** Give up on an unfinished upload: delete its chunks on the server and forget it. */
export async function discardUpload(api, conn, file, destPath) {
  const key = resumeKey(destPath, file);
  const saved = (await api.storage.get(UPLOADS_KEY)) ?? {};
  const record = saved[key];
  if (!record) return false;
  await ncRequest(api, davUploadsUrl((conn.base ?? conn.origin), conn.userId, record.id), { method: 'DELETE' }, { accept: [404] }).catch(() => {});
  delete saved[key];
  await api.storage.set(UPLOADS_KEY, saved);
  return true;
}
