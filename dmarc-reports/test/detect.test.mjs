import { describe, expect, it } from 'vitest';
import { MAX_REPORTS, reportAttachments, shouldShow } from '../src/lib/detect.js';
import { attachment, message } from './helpers.mjs';

describe('shouldShow', () => {
  it.each([
    'Report domain: example.org Submitter: google.com Report-ID: 1',
    'Report Domain: example.org Submitter: Yahoo! Inc. Report-ID: <x>',
    'DMARC Aggregate Report for example.org',
    '[Preview] DMARC Report',
  ])('shows for the subject "%s", even before attachments are loaded', (subject) => {
    expect(shouldShow({ email: { subject, attachments: [] } })).toBe(true);
  });

  it('shows for a file named the RFC 7489 way even under a plain subject', () => {
    const email = message({ subject: 'Hello', attachments: [attachment({ name: 'amazonses.com!example.org!1767225600!1767311999.xml.gz', type: 'application/gzip' })] });
    expect(shouldShow({ email })).toBe(true);
  });

  it('stays out of ordinary mail, with or without attachments', () => {
    expect(shouldShow({ email: message({ subject: 'Lunch?', attachments: [] }) })).toBe(false);
    expect(shouldShow({ email: message({ subject: 'Invoice', attachments: [attachment({ name: 'invoice.zip', type: 'application/zip' })] }) })).toBe(false);
    expect(shouldShow({})).toBe(false);
    expect(shouldShow(null)).toBe(false);
  });
});

describe('reportAttachments', () => {
  it('takes the report file and skips inline parts, empty parts and other files', () => {
    const email = message({
      attachments: [
        attachment({ blobId: 'a', name: 'google.com!example.org!1767225600!1767311999.zip' }),
        attachment({ blobId: 'b', name: 'logo.png', type: 'image/png', inline: true }),
        attachment({ blobId: 'c', name: 'notes.pdf', type: 'application/pdf' }),
        attachment({ blobId: 'd', name: 'empty.xml.gz', size: 0 }),
        attachment({ blobId: '', name: 'x.xml' }),
      ],
    });
    expect(reportAttachments(email).map((a) => a.blobId)).toEqual(['a']);
  });

  it('accepts an unusual file name when the subject says it is a report', () => {
    const email = message({ attachments: [attachment({ blobId: 'z', name: 'report.xml.gz', type: 'application/gzip' })] });
    expect(reportAttachments(email).map((a) => a.blobId)).toEqual(['z']);
    expect(reportAttachments({ ...email, subject: 'Hello' })).toEqual([]);
  });

  it('shows at most a few reports per message', () => {
    const attachments = Array.from({ length: 9 }, (_, i) => attachment({ blobId: `b${i}`, name: `g!d.example!176722560${i}!176731199${i}.zip` }));
    expect(reportAttachments(message({ attachments }))).toHaveLength(MAX_REPORTS);
  });
});
