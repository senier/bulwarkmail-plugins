import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, zipSync, strToU8 } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The anonymised sample reports (real reporters, example.org and TEST-NET addresses). */
export const fixture = (name) => readFileSync(path.join(here, 'fixtures', `${name}.xml`), 'utf8');

export const gz = (xml) => gzipSync(strToU8(xml));
export const zip = (xml, name = 'report.xml') => zipSync({ [name]: strToU8(xml) });
export const manifest = JSON.parse(readFileSync(path.join(here, '..', 'manifest.json'), 'utf8'));

/** An attachment entry as the host's EmailReadView has it. */
export const attachment = (over = {}) => ({ blobId: 'b1', name: 'google.com!example.org!1767225600!1767311999.zip', type: 'application/zip', size: 700, inline: false, ...over });

export const message = (over = {}) => ({
  id: 'e1',
  subject: 'Report domain: example.org Submitter: google.com Report-ID: 10000000000000000001',
  from: [{ name: 'Google', email: 'noreply-dmarc-support@google.com' }],
  attachments: [attachment()],
  auth: { dmarc: { result: 'pass' } },
  ...over,
});
