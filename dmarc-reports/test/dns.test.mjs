import { describe, expect, it } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { RESOLVERS, makeResolver, normalizeHost } from '../src/lib/dns.js';
import { ptrName } from '../src/lib/ip.js';
import { manifest } from './helpers.mjs';

/** A DNS-over-HTTPS answer in the JSON form both resolvers speak. */
const answer = (body, ok = true, status = 200) => ({ ok, status, headers: {}, bodyText: typeof body === 'string' ? body : JSON.stringify(body) });
const ptr = (...names) => ({ Status: 0, AD: false, Answer: names.map((data) => ({ name: 'x', type: 12, TTL: 60, data })) });
const addr = (type, ...data) => ({ Status: 0, AD: false, Answer: data.map((d) => ({ name: 'x', type, TTL: 60, data: d })) });

/** A fake resolver: `zone` maps "type name" to a body or a function. */
function dns(zone, { rdns = 'cloudflare', now } = {}) {
  const urls = [];
  const headers = [];
  const api = fakeApi({
    settings: { rdns },
    handlers: {
      'http.fetch': async (url, init) => {
        urls.push(url);
        headers.push(init?.headers);
        const u = new URL(url);
        const hit = zone[`${u.searchParams.get('type')} ${u.searchParams.get('name')}`];
        const body = typeof hit === 'function' ? await hit() : hit;
        return body === undefined ? answer({ Status: 3 }) : (body.__raw ?? answer(body));
      },
    },
  });
  return { api, urls, headers, resolver: makeResolver(api, now ? { now } : {}), fetched: () => api.calls('http.fetch').length };
}

describe('forward-confirmed reverse DNS', () => {
  it('verifies a name whose own address record points back', async () => {
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr('dns.google.'), 'A dns.google': addr(1, '8.8.4.4', '8.8.8.8') });
    expect(await t.resolver.lookup('8.8.8.8')).toMatchObject({ ip: '8.8.8.8', status: 'ok', host: 'dns.google', verified: true, dnssec: false });
    expect(t.urls).toEqual([
      'https://cloudflare-dns.com/dns-query?name=8.8.8.8.in-addr.arpa&type=PTR',
      'https://cloudflare-dns.com/dns-query?name=dns.google&type=A',
    ]);
    expect(t.headers[0]).toEqual({ accept: 'application/dns-json' });
  });

  it('marks the result DNSSEC-validated only when every answer was', async () => {
    const both = dns({ 'PTR 8.8.8.8.in-addr.arpa': { ...ptr('dns.google.'), AD: true }, 'A dns.google': { ...addr(1, '8.8.8.8'), AD: true } });
    expect((await both.resolver.lookup('8.8.8.8')).dnssec).toBe(true);
    const half = dns({ 'PTR 8.8.8.8.in-addr.arpa': { ...ptr('dns.google.'), AD: true }, 'A dns.google': addr(1, '8.8.8.8') });
    expect((await half.resolver.lookup('8.8.8.8')).dnssec).toBe(false);
  });

  it('does not confirm a name the address owner made up', async () => {
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr('mail.bank.example.'), 'A mail.bank.example': addr(1, '192.0.2.1') });
    expect(await t.resolver.lookup('8.8.8.8')).toMatchObject({ status: 'ok', host: 'mail.bank.example', verified: false, dnssec: false });
  });

  it('prefers the PTR name that confirms when there are several', async () => {
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr('fake.example.', 'real.example.'), 'A fake.example': addr(1, '192.0.2.1'), 'A real.example': addr(1, '8.8.8.8') });
    expect(await t.resolver.lookup('8.8.8.8')).toMatchObject({ host: 'real.example', verified: true });
  });

  it('ignores CNAME records in the answer and follows only address records', async () => {
    const t = dns({
      'PTR 8.8.8.8.in-addr.arpa': ptr('dns.google.'),
      'A dns.google': { Status: 0, Answer: [{ type: 5, data: 'alias.example.' }, { type: 1, data: '8.8.8.8' }] },
    });
    expect((await t.resolver.lookup('8.8.8.8')).verified).toBe(true);
  });

  it('asks AAAA for IPv6 and compares addresses by value, not by spelling', async () => {
    const t = dns({ [`PTR ${ptrName('2001:4860:4860::8888')}`]: ptr('dns.google.'), 'AAAA dns.google': addr(28, '2001:4860:4860:0:0:0:0:8888') });
    expect(await t.resolver.lookup('2001:4860:4860::8888')).toMatchObject({ ip: '2001:4860:4860::8888', host: 'dns.google', verified: true });
    expect(t.urls[1]).toContain('type=AAAA');
  });

  it('works against Google Public DNS too', async () => {
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr('dns.google.'), 'A dns.google': addr(1, '8.8.8.8') }, { rdns: 'google' });
    expect((await t.resolver.lookup('8.8.8.8')).verified).toBe(true);
    expect(t.urls[0]).toBe('https://dns.google/resolve?name=8.8.8.8.in-addr.arpa&type=PTR');
  });

  it('says there is no reverse name for NXDOMAIN and for an empty answer', async () => {
    const t = dns({ 'PTR 8.8.4.4.in-addr.arpa': { Status: 0, Answer: [] } });
    expect(await t.resolver.lookup('8.8.8.8')).toMatchObject({ status: 'none', host: null });
    expect(await t.resolver.lookup('8.8.4.4')).toMatchObject({ status: 'none' });
  });
});

describe('what is never looked up or believed', () => {
  it('skips non-public addresses and anything that is not an address, without any request', async () => {
    const t = dns({});
    for (const ip of ['10.0.0.1', '203.0.113.10', '2001:db8::1', '127.0.0.1', 'evil.example', '1.2.3.4/../x', '', undefined]) {
      expect(await t.resolver.lookup(ip)).toMatchObject({ status: 'skipped' });
    }
    expect(t.fetched()).toBe(0);
  });

  it('is off, with no request, unless a known resolver is chosen', async () => {
    for (const rdns of ['off', null, 'quad9', '<script>', 'constructor', '__proto__', 'toString']) {
      const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr('dns.google.') }, { rdns });
      expect(t.resolver.enabled()).toBe(false);
      expect(await t.resolver.lookup('8.8.8.8')).toMatchObject({ status: 'off' });
      expect(t.fetched()).toBe(0);
    }
  });

  it('drops hostile names from a PTR record instead of using or showing them', async () => {
    const hostile = ['a b.example.', 'x..example.', '<script>alert(1)</script>.', 'a.example/../b.', `${'a'.repeat(64)}.example.`, `${'a.'.repeat(130)}example.`, '-lead.example.', ''];
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr(...hostile) });
    expect(await t.resolver.lookup('8.8.8.8')).toMatchObject({ status: 'none' });
    expect(t.fetched()).toBe(1); // no forward query was built from any of them
  });

  it('normalises host names and rejects bad ones', () => {
    expect(normalizeHost('Mail.Example.COM.')).toBe('mail.example.com');
    expect(normalizeHost('_dmarc.example.com')).toBe('_dmarc.example.com');
    for (const bad of ['', '.', 'a..b', 'a b', 'a/b', 'a_.-b'.repeat(80), '-a.example', 'a-.example', null]) expect(normalizeHost(bad)).toBeNull();
  });
});

describe('failures, caching and politeness', () => {
  it('reports a failed lookup as an error and tries again after a minute, not at once', async () => {
    let clock = 1_000_000;
    let fail = true;
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': () => (fail ? answer('nope', false, 502) : ptr('dns.google.')), 'A dns.google': addr(1, '8.8.8.8') }, { now: () => clock });
    expect((await t.resolver.lookup('8.8.8.8')).status).toBe('error');
    fail = false;
    expect((await t.resolver.lookup('8.8.8.8')).status).toBe('error'); // still the cached failure
    clock += 61_000;
    expect(await t.resolver.lookup('8.8.8.8')).toMatchObject({ status: 'ok', verified: true });
  });

  it('treats garbage, a server failure status and a timeout as errors', async () => {
    const garbage = dns({ 'PTR 8.8.8.8.in-addr.arpa': { __raw: answer('<html>captive portal</html>') } });
    expect((await garbage.resolver.lookup('8.8.8.8')).status).toBe('error');
    const servfail = dns({ 'PTR 8.8.8.8.in-addr.arpa': { Status: 2 } });
    expect((await servfail.resolver.lookup('8.8.8.8')).status).toBe('error');
    const api = fakeApi({ settings: { rdns: 'cloudflare' }, handlers: { 'http.fetch': () => new Promise(() => {}) } });
    expect((await makeResolver(api, { timeoutMs: 20 }).lookup('8.8.8.8')).status).toBe('error');
  });

  it('answers a repeat from the cache and joins identical lookups in flight', async () => {
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr('dns.google.'), 'A dns.google': addr(1, '8.8.8.8') });
    await Promise.all([t.resolver.lookup('8.8.8.8'), t.resolver.lookup('8.8.8.8'), t.resolver.lookup(' 8.8.8.8 ')]);
    expect(t.fetched()).toBe(2);
    await t.resolver.lookup('8.8.8.8');
    expect(t.fetched()).toBe(2);
  });

  it('keeps results across page loads, until they expire', async () => {
    let clock = 5_000_000;
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr('dns.google.'), 'A dns.google': addr(1, '8.8.8.8') }, { now: () => clock });
    await t.resolver.lookup('8.8.8.8');
    await t.resolver.flush();
    const stored = await t.api.storage.get('rdns');
    expect(stored.v).toBe(1);
    expect(JSON.stringify(stored)).not.toContain('captive');

    const again = makeResolver(t.api, { now: () => clock });
    expect((await again.lookup('8.8.8.8')).verified).toBe(true);
    expect(t.fetched()).toBe(2);

    clock += 25 * 3_600_000;
    const later = makeResolver(t.api, { now: () => clock });
    await later.lookup('8.8.8.8');
    expect(t.fetched()).toBe(4);
  });

  it('survives unreadable or hostile stored data', async () => {
    const t = dns({ 'PTR 8.8.8.8.in-addr.arpa': ptr('dns.google.'), 'A dns.google': addr(1, '8.8.8.8') });
    await t.api.storage.set('rdns', { v: 1, e: { '8.8.8.8': 'not an entry' } });
    await expect(t.resolver.lookup('8.8.8.8')).resolves.toBeTruthy();
    const t2 = dns({});
    await t2.api.storage.set('rdns', 'junk');
    await expect(t2.resolver.lookup('8.8.8.8')).resolves.toBeTruthy();
  });

  it('runs at most four lookups at a time', async () => {
    let running = 0;
    let peak = 0;
    const slow = async () => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running -= 1; return { Status: 3 }; };
    const zone = new Proxy({}, { get: (_, key) => (String(key).startsWith('PTR') ? slow : undefined) });
    const t = dns(zone);
    await Promise.all(Array.from({ length: 14 }, (_, i) => t.resolver.lookup(`8.8.8.${i + 1}`)));
    expect(t.fetched()).toBe(14);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('the manifest allows exactly what the code asks', () => {
  it('lists the resolver origins and the permission to fetch', () => {
    expect(manifest.permissions).toContain('http:fetch');
    expect([...manifest.httpOrigins].sort()).toEqual(Object.values(RESOLVERS).map((r) => r.origin).sort());
    expect(Object.keys(RESOLVERS).sort()).toEqual(manifest.settingsSchema.rdns.options.filter((o) => o !== 'off').sort());
    expect(manifest.settingsSchema.rdns.default).toBe('off');
  });

  it('only ever builds https URLs on those origins, with the name encoded', () => {
    for (const p of Object.values(RESOLVERS)) {
      const url = p.query('a b&c=d', 'PTR');
      expect(url.startsWith(`${p.origin}/`)).toBe(true);
      expect(new URL(url).origin).toBe(p.origin);
      expect(new URL(url).searchParams.get('name')).toBe('a b&c=d');
    }
  });
});
