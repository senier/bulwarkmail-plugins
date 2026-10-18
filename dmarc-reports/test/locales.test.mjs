import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorKey } from '../src/lib/view.js';
import { manifest } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { en, de } = manifest.locales;
const WEBMAIL_LOCALES = ['ar', 'ca', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hu', 'it', 'ja', 'ko', 'lv', 'mn', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'uk', 'zh', 'zh-TW'];
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory()
  ? sources(path.join(dir, d.name))
  : d.name.endsWith('.js') ? [readFileSync(path.join(dir, d.name), 'utf8')] : [])).join('\n');
const code = sources(path.join(here, '../src'));

describe('translations', () => {
  it('cover every webmail language', () => {
    expect(Object.keys(manifest.locales).sort()).toEqual([...WEBMAIL_LOCALES].sort());
  });

  it.each(WEBMAIL_LOCALES)('%s has every key, the same placeholders, none empty', (lang) => {
    const table = manifest.locales[lang];
    expect(Object.keys(table)).toEqual(Object.keys(en));
    for (const [key, text] of Object.entries(en)) {
      expect(table[key].trim(), `${lang} ${key}`).not.toBe('');
      expect(placeholders(table[key]), `${lang} ${key}`).toEqual(placeholders(text));
    }
  });

  it('keeps the technical words and the option value untranslated', () => {
    for (const lang of WEBMAIL_LOCALES) {
      const table = manifest.locales[lang];
      expect(table['bar.counts'], lang).toContain('DMARC');
      expect(table['setting.rdns.help'], lang).toContain('off');
      expect(table['details.col.dkim'], lang).toBe('DKIM');
      expect(table['details.col.spf'], lang).toBe('SPF');
    }
  });

  it('writes plain characters, not \\u escapes', () => {
    expect(readFileSync(path.join(here, '..', 'manifest.json'), 'utf8')).not.toMatch(/\\u[0-9a-f]{4}/i);
  });

  it('every key the code uses exists, including the computed ones', () => {
    const used = new Set([...code.matchAll(/\bt\(\s*'([A-Za-z.]+)'/g)].map((m) => m[1]));
    for (const code of ['unsupported', 'too_big', 'corrupt', 'doctype', 'invalid', 'not_dmarc', 'other']) used.add(errorKey({ code }));
    for (const col of ['ip', 'host', 'count', 'disposition', 'dkim', 'spf', 'from', 'auth']) used.add(`details.col.${col}`);
    for (const reason of ['permission', 'origin', 'network', 'http', 'timeout', 'answer', 'dns', 'other']) used.add(`details.problem.${reason}`);
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) expect(en[key], key).toBeTypeOf('string');
  });

  it('the settings form uses translation keys that exist', () => {
    for (const field of Object.values(manifest.settingsSchema)) {
      expect(en[field.label], field.label).toBeTypeOf('string');
      expect(en[field.description], field.description).toBeTypeOf('string');
    }
  });

  it('no key is unused', () => {
    const computed = /^(error\.|details\.col\.|details\.problem\.|setting\.)/;
    for (const key of Object.keys(en)) {
      if (computed.test(key)) continue;
      expect(code.includes(`'${key}'`), key).toBe(true);
    }
  });
});
