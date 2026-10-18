import { describe, expect, it } from 'vitest';
import { senderCheck } from '../src/lib/sender.js';

const report = (email) => ({ metadata: { email } });
const mail = (from, auth) => ({ from: [{ email: from }], auth });

describe('senderCheck', () => {
  it('trusts an authenticated message from the reporting organisation', () => {
    expect(senderCheck(mail('noreply-dmarc-support@google.com', { dmarc: { result: 'pass' } }), report('noreply-dmarc-support@google.com')).verdict).toBe('trusted');
  });

  it('accepts a subdomain of the reporting address, either way round', () => {
    expect(senderCheck(mail('x@corp.mail.ru', { dmarc: { result: 'pass' } }), report('dmarc_support@mail.ru')).orgMatches).toBe(true);
    expect(senderCheck(mail('x@mail.ru', { dmarc: { result: 'pass' } }), report('dmarc_support@corp.mail.ru')).orgMatches).toBe(true);
  });

  it('is suspicious when the sender is someone else than the reporter', () => {
    const c = senderCheck(mail('dmarc@evil.example', { dmarc: { result: 'pass' } }), report('postmaster@amazonses.com'));
    expect(c).toMatchObject({ orgMatches: false, verdict: 'suspicious' });
  });

  it('is suspicious when the message failed authentication, whatever the address says', () => {
    for (const auth of [{ dmarc: { result: 'fail' } }, { dkim: { result: 'fail' } }, { spf: { result: 'fail' } }]) {
      expect(senderCheck(mail('noreply-dmarc-support@google.com', auth), report('noreply-dmarc-support@google.com')).verdict).toBe('suspicious');
    }
  });

  it('is unknown, not accusing, when nothing was checked', () => {
    expect(senderCheck(mail('noreply-dmarc-support@google.com', undefined), report('noreply-dmarc-support@google.com'))).toMatchObject({ authenticated: null, verdict: 'unknown' });
    expect(senderCheck({ from: [] }, report('a@b.example'))).toMatchObject({ orgMatches: null, verdict: 'unknown' });
  });

  it('is not fooled by a look-alike domain', () => {
    expect(senderCheck(mail('x@notgoogle.com', { dmarc: { result: 'pass' } }), report('noreply-dmarc-support@google.com')).orgMatches).toBe(false);
  });
});
