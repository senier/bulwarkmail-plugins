// Turns an attachment into the report's XML text. Reports come as plain
// .xml, .xml.gz or .zip. The attachment is attacker-controlled (anyone can
// mail a "report"), so decompression is streamed and aborted the moment the
// output passes MAX_XML_BYTES: a zip bomb costs a few milliseconds, not memory.

import { Gunzip, Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

/** Largest XML text we unpack; real reports are kilobytes to a few megabytes. */
export const MAX_XML_BYTES = 20 * 1024 * 1024;

export class UnpackError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UnpackError';
    this.code = code; // unsupported | too_big | corrupt
  }
}

/** What the bytes are, judged by their first bytes and not by the file name. */
export function sniff(bytes) {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
  if (bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (bytes[i] === 0x3c) return 'xml';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return 'xml'; // UTF-16 BOM
  return 'unknown';
}

function collector(max) {
  const chunks = [];
  let total = 0;
  return {
    add(chunk) {
      total += chunk.length;
      if (total > max) throw new UnpackError('too_big');
      chunks.push(chunk);
    },
    bytes() {
      const out = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out;
    },
  };
}

function gunzip(bytes, max) {
  const out = collector(max);
  try {
    const gz = new Gunzip((chunk) => out.add(chunk));
    gz.push(bytes, true);
  } catch (err) {
    if (err instanceof UnpackError) throw err;
    throw new UnpackError('corrupt');
  }
  return out.bytes();
}

/** The first *.xml entry of the archive. */
function unzipFirstXml(bytes, max) {
  const out = collector(max);
  let found = false;
  try {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    unzip.onfile = (file) => {
      if (found || !/\.xml$/i.test(file.name)) return;
      found = true;
      file.ondata = (err, chunk) => {
        if (err) throw err;
        out.add(chunk);
      };
      file.start();
    };
    unzip.push(bytes, true);
  } catch (err) {
    if (err instanceof UnpackError) throw err;
    throw new UnpackError('corrupt');
  }
  if (!found) throw new UnpackError('unsupported');
  return out.bytes();
}

/** The label of the encoding an XML text declares, else utf-8. */
function declaredEncoding(bytes) {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe)) return 'utf-16le';
  if ((bytes[0] === 0xfe && bytes[1] === 0xff)) return 'utf-16be';
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const m = /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  return m ? m[1] : 'utf-8';
}

function decode(bytes) {
  const label = declaredEncoding(bytes);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** The XML text of a report attachment (ArrayBuffer or Uint8Array). */
export function unpackReport(data, max = MAX_XML_BYTES) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  switch (sniff(bytes)) {
    case 'gzip': return decode(gunzip(bytes, max));
    case 'zip': return decode(unzipFirstXml(bytes, max));
    case 'xml':
      if (bytes.length > max) throw new UnpackError('too_big');
      return decode(bytes);
    default: throw new UnpackError('unsupported');
  }
}
