// A DMARC aggregate report (RFC 7489 appendix C; DMARCbis adds a namespace and
// a few fields) as a plain object. Unknown elements are ignored and missing
// ones become empty strings, because reporters differ a lot. Element names are
// matched by local name, so both namespaces work.

/** Most source rows kept; the totals always count every record. */
export const MAX_ROWS = 2000;
const MAX_COUNT = 1e9;

export class ReportError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReportError';
    this.code = code; // doctype | invalid | not_dmarc
  }
}

const lower = (s) => String(s ?? '').toLowerCase();

function kids(el, name) {
  if (!el) return [];
  const want = lower(name);
  return Array.from(el.children ?? []).filter((c) => lower(c.localName ?? c.nodeName) === want);
}
const kid = (el, name) => kids(el, name)[0] ?? null;
const text = (el, name) => (kid(el, name)?.textContent ?? '').trim();

function count(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : 0;
}

function seconds(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

function parseRecord(rec) {
  const row = kid(rec, 'row');
  const evaluated = kid(row, 'policy_evaluated');
  const ids = kid(rec, 'identifiers');
  const auth = kid(rec, 'auth_results');
  const record = {
    ip: text(row, 'source_ip'),
    count: count(text(row, 'count')),
    disposition: lower(text(evaluated, 'disposition')) || 'none',
    dkim: lower(text(evaluated, 'dkim')),
    spf: lower(text(evaluated, 'spf')),
    reasons: kids(evaluated, 'reason').map((r) => ({ type: text(r, 'type'), comment: text(r, 'comment') })),
    headerFrom: text(ids, 'header_from'),
    envelopeFrom: text(ids, 'envelope_from'),
    envelopeTo: text(ids, 'envelope_to'),
    dkimResults: kids(auth, 'dkim').map((d) => ({
      domain: text(d, 'domain'), selector: text(d, 'selector'), result: lower(text(d, 'result')),
    })),
    spfResults: kids(auth, 'spf').map((s) => ({
      domain: text(s, 'domain'), scope: text(s, 'scope'), result: lower(text(s, 'result')),
    })),
  };
  // DMARC passes when either mechanism passes AND is aligned; policy_evaluated
  // is the reporter's verdict on exactly that.
  record.pass = record.dkim === 'pass' || record.spf === 'pass';
  return record;
}

function totalsOf(records) {
  const t = { messages: 0, passed: 0, failed: 0, none: 0, quarantine: 0, reject: 0, sources: 0 };
  const ips = new Set();
  for (const r of records) {
    t.messages += r.count;
    if (r.pass) t.passed += r.count; else t.failed += r.count;
    if (r.disposition === 'quarantine' || r.disposition === 'reject') t[r.disposition] += r.count;
    else t.none += r.count;
    if (r.ip) ips.add(r.ip);
  }
  t.sources = ips.size;
  return t;
}

/** Parses the XML text; throws ReportError. */
export function parseReport(xml) {
  const source = String(xml ?? '');
  // A report never needs a DTD; refusing it rules out entity tricks outright.
  if (/<!DOCTYPE/i.test(source) || /<!ENTITY/i.test(source)) throw new ReportError('doctype');

  let doc;
  try {
    doc = new DOMParser().parseFromString(source, 'application/xml');
  } catch {
    throw new ReportError('invalid');
  }
  if (!doc || doc.getElementsByTagName('parsererror').length > 0) throw new ReportError('invalid');
  const root = doc.documentElement;
  if (!root || lower(root.localName ?? root.nodeName) !== 'feedback') throw new ReportError('not_dmarc');

  const meta = kid(root, 'report_metadata');
  const policy = kid(root, 'policy_published');
  if (!meta && !policy) throw new ReportError('not_dmarc');
  const range = kid(meta, 'date_range');
  const records = kids(root, 'record').map(parseRecord);
  records.sort((a, b) => b.count - a.count);

  return {
    metadata: {
      org: text(meta, 'org_name'),
      email: text(meta, 'email'),
      contact: text(meta, 'extra_contact_info'),
      reportId: text(meta, 'report_id'),
      begin: seconds(text(range, 'begin')),
      end: seconds(text(range, 'end')),
      errors: kids(meta, 'error').map((e) => (e.textContent ?? '').trim()).filter(Boolean),
    },
    policy: {
      domain: text(policy, 'domain'),
      adkim: lower(text(policy, 'adkim')) || 'r',
      aspf: lower(text(policy, 'aspf')) || 'r',
      p: lower(text(policy, 'p')),
      sp: lower(text(policy, 'sp')),
      np: lower(text(policy, 'np')),
      pct: text(policy, 'pct'),
      fo: text(policy, 'fo'),
      testing: lower(text(policy, 'testing')),
    },
    totals: totalsOf(records),
    records: records.slice(0, MAX_ROWS),
    truncated: Math.max(0, records.length - MAX_ROWS),
  };
}
