// Reverse DNS for the sources in a report, over DNS-over-HTTPS (browsers have
// no DNS of their own). Every hostname is forward-confirmed: a PTR record is
// whatever the owner of the address's reverse zone wants it to say, so a name
// only counts as verified when its own A/AAAA record points back to the
// address. Results are cached, lookups run a few at a time, and nothing is
// asked about an address that is not public.

import { isPublic, parseIp, ptrName } from './ip.js';

/** The resolvers the manifest allows (see httpOrigins). */
export const RESOLVERS = {
  cloudflare: {
    label: 'Cloudflare',
    origin: 'https://cloudflare-dns.com',
    query: (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    headers: { accept: 'application/dns-json' },
  },
  google: {
    label: 'Google Public DNS',
    origin: 'https://dns.google',
    query: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    headers: { accept: 'application/json' },
  },
};

const TYPE = { A: 1, PTR: 12, AAAA: 28 };
const HOUR = 3_600_000;
const TTL_VERIFIED = 24 * HOUR;
const TTL_UNVERIFIED = 6 * HOUR;
const TTL_NONE = HOUR;
const TTL_ERROR = 60_000;
const CACHE_KEY = 'rdns';

/** A host name as DNS allows it (underscores too, which reverse zones use). */
export function normalizeHost(value) {
  const host = String(value ?? '').trim().replace(/\.$/, '').toLowerCase();
  if (host.length === 0 || host.length > 253) return null;
  const labels = host.split('.');
  return labels.every((l) => /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/.test(l)) ? host : null;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function makeResolver(api, { now = () => Date.now(), concurrency = 4, timeoutMs = 8000, maxCache = 300 } = {}) {
  const memory = new Map();
  const inflight = new Map();
  let persisted = null; // Promise of the stored cache, loaded once
  let dirty = false;
  let flushTimer = null;
  let active = 0;
  const waiting = [];

  const provider = () => {
    const key = api.plugin?.settings?.rdns;
    return typeof key === 'string' && Object.hasOwn(RESOLVERS, key) ? RESOLVERS[key] : null;
  };

  function gate(task) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active += 1;
        task().then(resolve, reject).finally(() => { active -= 1; waiting.shift()?.(); });
      };
      if (active < concurrency) run(); else waiting.push(run);
    });
  }

  async function ask(p, name, type) {
    const res = await withTimeout(api.http.fetch(p.query(name, type), { method: 'GET', headers: p.headers }), timeoutMs);
    if (!res?.ok) throw new Error(`http ${res?.status}`);
    const json = JSON.parse(res.bodyText);
    if (typeof json !== 'object' || json === null) throw new Error('bad answer');
    return json;
  }

  const answers = (json, type) => (Array.isArray(json.Answer)
    ? json.Answer.filter((a) => a && a.type === type && typeof a.data === 'string').slice(0, 20).map((a) => a.data)
    : []);

  const none = (ip) => ({ ip, status: 'none', host: null, verified: null, dnssec: false });

  async function resolve(parsed, p) {
    const ptr = await ask(p, ptrName(parsed), 'PTR');
    if (ptr.Status === 3) return none(parsed.text); // NXDOMAIN
    if (ptr.Status !== 0) throw new Error(`dns status ${ptr.Status}`);
    const hosts = [...new Set(answers(ptr, TYPE.PTR).map(normalizeHost).filter(Boolean))].slice(0, 3);
    if (hosts.length === 0) return none(parsed.text);

    const forward = parsed.version === 4 ? 'A' : 'AAAA';
    let dnssec = ptr.AD === true;
    let confirmed = null;
    for (const host of hosts) {
      const json = await ask(p, host, forward);
      dnssec = dnssec && json.AD === true;
      const addresses = answers(json, TYPE[forward]).map(parseIp).filter(Boolean).map((a) => a.text);
      if (addresses.includes(parsed.text)) { confirmed = host; break; }
    }
    return { ip: parsed.text, status: 'ok', host: confirmed ?? hosts[0], verified: confirmed !== null, dnssec: confirmed !== null && dnssec };
  }

  const ttlOf = (r) => (r.status === 'none' ? TTL_NONE : r.verified ? TTL_VERIFIED : TTL_UNVERIFIED);

  async function stored() {
    persisted ??= (async () => {
      let data = null;
      try { data = await api.storage.get(CACHE_KEY); } catch { /* storage unavailable: no cache */ }
      const entries = data && typeof data === 'object' && data.v === 1 && data.e && typeof data.e === 'object' ? data.e : {};
      for (const [ip, [host, code, dnssec, expires]] of Object.entries(entries)) {
        if (!(expires > now())) continue;
        memory.set(ip, { ip, status: code === -1 ? 'none' : 'ok', host: host || null, verified: code === -1 ? null : code === 1, dnssec: dnssec === 1, expires });
      }
    })();
    return persisted;
  }

  function scheduleFlush() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 300);
  }

  async function flush() {
    if (!dirty) return;
    dirty = false;
    const live = [...memory.values()].filter((r) => r.expires > now() && (r.status === 'ok' || r.status === 'none'));
    live.sort((a, b) => b.expires - a.expires);
    const e = {};
    for (const r of live.slice(0, maxCache)) e[r.ip] = [r.host ?? '', r.status === 'none' ? -1 : r.verified ? 1 : 0, r.dnssec ? 1 : 0, r.expires];
    try { await api.storage.set(CACHE_KEY, { v: 1, e }); } catch { /* full or unavailable: the cache is optional */ }
  }

  /** The reverse-DNS result of an address: { ip, status: ok|none|skipped|error|off, host, verified, dnssec }. */
  async function lookup(ip) {
    const p = provider();
    if (!p) return { ip, status: 'off', host: null, verified: null, dnssec: false };
    const parsed = parseIp(ip);
    if (!parsed || !isPublic(parsed)) return { ip, status: 'skipped', host: null, verified: null, dnssec: false };
    await stored();
    const hit = memory.get(parsed.text);
    if (hit && hit.expires > now()) return hit;
    if (inflight.has(parsed.text)) return inflight.get(parsed.text);
    const job = gate(() => resolve(parsed, p)).then(
      (result) => {
        const out = { ...result, expires: now() + ttlOf(result) };
        memory.set(parsed.text, out);
        scheduleFlush();
        return out;
      },
      (error) => {
        api.log.warn('dmarc-reports: reverse lookup failed', error?.message);
        const out = { ip: parsed.text, status: 'error', host: null, verified: null, dnssec: false, expires: now() + TTL_ERROR };
        memory.set(parsed.text, out);
        return out;
      },
    ).finally(() => inflight.delete(parsed.text));
    inflight.set(parsed.text, job);
    return job;
  }

  return { lookup, flush, enabled: () => provider() !== null, label: () => provider()?.label ?? '' };
}
