// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MAX_ROWS, parseReport } from '../src/lib/parse.js';
import { fixture } from './helpers.mjs';

describe('parseReport on real reporters', () => {
  it('reads the Google report: two sources, one with a failing mechanism of each kind', () => {
    const r = parseReport(fixture('google'));
    expect(r.metadata).toMatchObject({ org: 'google.com', email: 'noreply-dmarc-support@google.com', reportId: '10000000000000000001', begin: 1767225600000, end: 1767311999000 });
    expect(r.policy).toMatchObject({ domain: 'example.org', adkim: 'r', aspf: 'r', p: 'none', sp: 'none', np: 'none', pct: '100' });
    expect(r.records).toHaveLength(2);
    const v6 = r.records.find((x) => x.ip.includes(':'));
    expect(v6).toMatchObject({ ip: '2001:db8:4864:20::348', count: 1, dkim: 'pass', spf: 'fail', pass: true });
    expect(v6.dkimResults.map((d) => `${d.selector}:${d.result}`)).toEqual(['sel2:fail', 'sel1:pass']);
    expect(v6.spfResults).toEqual([{ domain: 'example.org', scope: '', result: 'softfail' }]);
    expect(r.totals).toEqual({ messages: 2, passed: 2, failed: 0, none: 2, quarantine: 0, reject: 0, sources: 2 });
  });

  it('reads the Amazon SES report, with its pretty-printed whitespace and fo', () => {
    const r = parseReport(fixture('amazon'));
    expect(r.metadata).toMatchObject({ org: 'AMAZON-SES', email: 'postmaster@amazonses.com', reportId: '11111111-2222-4333-8444-555555555555' });
    expect(r.policy.fo).toBe('0');
    expect(r.records[0]).toMatchObject({ ip: '203.0.113.10', headerFrom: 'example.org', envelopeFrom: 'example.org', dkim: 'pass', spf: 'pass' });
  });

  it('reads the Mail.Ru report: one line, single quotes in the prolog, spf scope', () => {
    const r = parseReport(fixture('mailru'));
    expect(r.metadata.org).toBe('Mail.Ru');
    expect(r.metadata.contact).toBe('http://help.mail.ru/mail-help');
    expect(r.records[0].spfResults[0]).toMatchObject({ scope: 'mfrom', result: 'pass' });
    expect(r.records[0].envelopeFrom).toBe('');
  });
});

describe('parseReport on other shapes', () => {
  const wrap = (records, extra = '') => `<feedback>${extra}<report_metadata><org_name>X</org_name></report_metadata><policy_published><domain>d.example</domain></policy_published>${records}</feedback>`;
  const rec = (ip, count, disp, dkim, spf, more = '') => `<record><row><source_ip>${ip}</source_ip><count>${count}</count><policy_evaluated><disposition>${disp}</disposition><dkim>${dkim}</dkim><spf>${spf}</spf>${more}</policy_evaluated></row><identifiers><header_from>d.example</header_from></identifiers></record>`;

  it('counts failures and dispositions over every message, not every row', () => {
    const r = parseReport(wrap(rec('198.51.100.1', 5, 'none', 'pass', 'fail') + rec('198.51.100.2', 7, 'quarantine', 'fail', 'fail') + rec('198.51.100.3', 3, 'reject', 'fail', 'fail')));
    expect(r.totals).toEqual({ messages: 15, passed: 5, failed: 10, none: 5, quarantine: 7, reject: 3, sources: 3 });
    expect(r.records.map((x) => x.count)).toEqual([7, 5, 3]); // busiest first
  });

  it('keeps policy override reasons', () => {
    const r = parseReport(wrap(rec('198.51.100.1', 1, 'none', 'fail', 'fail', '<reason><type>forwarded</type><comment>mailing list</comment></reason>')));
    expect(r.records[0].reasons).toEqual([{ type: 'forwarded', comment: 'mailing list' }]);
  });

  it('accepts the DMARCbis namespace and capitalised element names', () => {
    const xml = '<feedback xmlns="urn:ietf:params:xml:ns:dmarc-2.0"><version>2.0</version><report_metadata><org_name>Y</org_name><date_range><begin>1</begin><end>2</end></date_range></report_metadata><policy_published><domain>d.example</domain><np>reject</np><testing>n</testing><DISCOVERY_METHOD>psl</DISCOVERY_METHOD></policy_published></feedback>';
    const r = parseReport(xml);
    expect(r.policy).toMatchObject({ domain: 'd.example', np: 'reject', testing: 'n' });
    expect(r.records).toEqual([]);
    expect(r.totals.messages).toBe(0);
  });

  it('clamps nonsense counts and survives missing parts', () => {
    const r = parseReport(wrap('<record><row><source_ip>198.51.100.9</source_ip><count>-4</count></row></record><record><row><count>99999999999999</count></row></record>'));
    expect(r.records.map((x) => x.count)).toEqual([1e9, 0]);
    expect(r.records[0]).toMatchObject({ ip: '', disposition: 'none', dkim: '', spf: '', pass: false });
    expect(r.records[1]).toMatchObject({ ip: '198.51.100.9', count: 0 });
  });

  it('keeps the totals of every record but only the busiest rows', () => {
    const many = Array.from({ length: MAX_ROWS + 25 }, (_, i) => rec(`198.51.100.${i % 250}`, i + 1, 'none', 'pass', 'pass')).join('');
    const r = parseReport(wrap(many));
    expect(r.records).toHaveLength(MAX_ROWS);
    expect(r.truncated).toBe(25);
    expect(r.totals.messages).toBe(((MAX_ROWS + 25) * (MAX_ROWS + 26)) / 2);
    expect(r.records[0].count).toBe(MAX_ROWS + 25);
  });

  it('refuses a DTD or entity declaration outright', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE feedback [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><feedback><report_metadata/></feedback>';
    expect(() => parseReport(bomb)).toThrow(expect.objectContaining({ code: 'doctype' }));
    expect(() => parseReport('<!doctype html><feedback/>')).toThrow(expect.objectContaining({ code: 'doctype' }));
  });

  it('rejects text that is not XML, and XML that is not a report', () => {
    expect(() => parseReport('<feedback><report_metadata></feedback>')).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => parseReport('not xml at all')).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => parseReport('<html><body/></html>')).toThrow(expect.objectContaining({ code: 'not_dmarc' }));
    expect(() => parseReport('<feedback><version>1</version></feedback>')).toThrow(expect.objectContaining({ code: 'not_dmarc' }));
  });

  it('never executes markup in the data: it stays text', () => {
    const r = parseReport(wrap(rec('&lt;img src=x onerror=alert(1)&gt;', 1, 'none', 'pass', 'pass')).replace('<org_name>X', '<org_name>&lt;script&gt;alert(1)&lt;/script&gt;'));
    expect(r.metadata.org).toBe('<script>alert(1)</script>');
    expect(r.records[0].ip).toBe('<img src=x onerror=alert(1)>');
  });
});
