// Strict IP handling for the reverse-DNS lookup. The address comes out of a
// report that anyone can forge, so it is parsed, never trusted: anything that
// is not exactly an IPv4 or IPv6 address is refused before it can become part
// of a DNS name or a URL.

function parseV4(text) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map((s) => (s.length > 1 && s[0] === '0' ? NaN : Number(s))); // no 010 octal tricks
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

function canonicalV6(words) {
  let best = { at: -1, len: 0 };
  for (let i = 0; i < 8;) {
    if (words[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j;
  }
  const hex = (w) => w.toString(16);
  if (best.len < 2) return words.map(hex).join(':');
  const head = words.slice(0, best.at).map(hex).join(':');
  const tail = words.slice(best.at + best.len).map(hex).join(':');
  return `${head}::${tail}`;
}

function parseV6(text) {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(':')) return null;
  let t = text;
  if (t.includes('.')) {
    const cut = t.lastIndexOf(':') + 1;
    const v4 = parseV4(t.slice(cut));
    if (!v4) return null;
    t = `${t.slice(0, cut)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const groups = (s) => (s === '' ? [] : s.split(':'));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const all = [...head, ...tail];
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  let words;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    words = head.map((g) => parseInt(g, 16));
  } else {
    if (head.length + tail.length > 7) return null;
    words = [...head.map((g) => parseInt(g, 16)), ...new Array(8 - all.length).fill(0), ...tail.map((g) => parseInt(g, 16))];
  }
  return words;
}

/** { version: 4, parts, text } or { version: 6, words, text } with the canonical text; null if not an address. */
export function parseIp(value) {
  const text = String(value ?? '').trim();
  if (text.length === 0 || text.length > 45) return null;
  const v4 = parseV4(text);
  if (v4) return { version: 4, parts: v4, text: v4.join('.') };
  const v6 = parseV6(text);
  if (v6) return { version: 6, words: v6, text: canonicalV6(v6) };
  return null;
}

const V4_SPECIAL = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => ({ base: toInt(parseV4(base)), mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0 }));

function toInt([a, b, c, d]) {
  return (((a * 256 + b) * 256 + c) * 256 + d) >>> 0;
}

// Inside 2000::/3 (global unicast) but not for general use.
const V6_SPECIAL = [['2001::', 23], ['2001:db8::', 32], ['3fff::', 20], ['2002::', 16]]
  .map(([base, bits]) => ({ words: parseV6(base), bits }));

function v6Within(words, prefix) {
  let bits = prefix.bits;
  for (let i = 0; bits > 0; i++, bits -= 16) {
    const mask = bits >= 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
    if ((words[i] & mask) !== (prefix.words[i] & mask)) return false;
  }
  return true;
}

/** True for an address that has a meaningful public reverse name. */
export function isPublic(ip) {
  const parsed = typeof ip === 'string' ? parseIp(ip) : ip;
  if (!parsed) return false;
  if (parsed.version === 4) {
    const n = toInt(parsed.parts);
    return !V4_SPECIAL.some((r) => ((n & r.mask) >>> 0) === ((r.base & r.mask) >>> 0));
  }
  if ((parsed.words[0] & 0xe000) !== 0x2000) return false; // not 2000::/3
  return !V6_SPECIAL.some((p) => v6Within(parsed.words, p));
}

/** The reverse-lookup name: 4.3.2.1.in-addr.arpa, or the 32 nibbles under ip6.arpa. */
export function ptrName(ip) {
  const parsed = typeof ip === 'string' ? parseIp(ip) : ip;
  if (!parsed) throw new Error('not an IP address');
  if (parsed.version === 4) return `${[...parsed.parts].reverse().join('.')}.in-addr.arpa`;
  const nibbles = parsed.words.map((w) => w.toString(16).padStart(4, '0')).join('');
  return `${[...nibbles].reverse().join('.')}.ip6.arpa`;
}
