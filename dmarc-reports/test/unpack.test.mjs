import { describe, expect, it } from 'vitest';
import { gzipSync, zipSync, strToU8 } from 'fflate';
import { MAX_XML_BYTES, sniff, unpackReport } from '../src/lib/unpack.js';
import { fixture, gz, zip } from './helpers.mjs';

describe('unpackReport', () => {
  const xml = fixture('google');

  it('reads plain XML, gzip and zip', () => {
    expect(unpackReport(strToU8(xml))).toBe(xml);
    expect(unpackReport(gz(xml))).toBe(xml);
    expect(unpackReport(zip(xml))).toBe(xml);
  });

  it('takes an ArrayBuffer, as the host hands it over', () => {
    const bytes = gz(xml);
    expect(unpackReport(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe(xml);
  });

  it('judges by content, not by file name', () => {
    expect(sniff(gz(xml))).toBe('gzip');
    expect(sniff(zip(xml))).toBe('zip');
    expect(sniff(strToU8(`\n  ${xml}`))).toBe('xml');
    expect(sniff(strToU8('hello'))).toBe('unknown');
  });

  it('takes the first .xml entry of an archive and ignores the rest', () => {
    const archive = zipSync({ 'readme.txt': strToU8('hi'), 'a/report.XML': strToU8(xml) });
    expect(unpackReport(archive)).toBe(xml);
  });

  it('rejects an archive without XML and a file that is none of the three', () => {
    expect(() => unpackReport(zipSync({ 'a.txt': strToU8('x') }))).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(() => unpackReport(strToU8('PDF-1.7 not a report'))).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });

  it('reports a damaged archive as corrupt', () => {
    const bytes = gz(xml);
    expect(() => unpackReport(bytes.subarray(0, 12))).toThrow(expect.objectContaining({ code: 'corrupt' }));
    const broken = zip(xml);
    broken.fill(0xff, 40, 60);
    expect(() => unpackReport(broken)).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('stops a decompression bomb at the limit instead of unpacking it', () => {
    const big = strToU8(`<feedback>${'a'.repeat(300_000)}</feedback>`);
    expect(() => unpackReport(gzipSync(big), 100_000)).toThrow(expect.objectContaining({ code: 'too_big' }));
    expect(() => unpackReport(zipSync({ 'r.xml': big }), 100_000)).toThrow(expect.objectContaining({ code: 'too_big' }));
    expect(() => unpackReport(big, 100_000)).toThrow(expect.objectContaining({ code: 'too_big' }));
    expect(MAX_XML_BYTES).toBe(20 * 1024 * 1024);
  });

  it('survives a real bomb: 200 MB of one byte, a few hundred KB compressed', () => {
    const bomb = gzipSync(new Uint8Array(200 * 1024 * 1024).fill(0x61), { level: 9 });
    expect(bomb.length).toBeLessThan(1_000_000);
    const started = Date.now();
    expect(() => unpackReport(bomb)).toThrow(expect.objectContaining({ code: 'too_big' }));
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('decodes the declared encoding, including UTF-16 with a BOM', () => {
    const latin = Uint8Array.from(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><feedback>Müller</feedback>', 'latin1'));
    expect(unpackReport(latin)).toContain('Müller');
    const utf16 = Uint8Array.from(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<feedback>Ünï</feedback>', 'utf16le')]));
    expect(unpackReport(utf16)).toContain('Ünï');
  });
});
