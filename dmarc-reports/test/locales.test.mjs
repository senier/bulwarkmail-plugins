import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorKey } from '../src/lib/view.js';
import { manifest } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { en, de } = manifest.locales;
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory()
  ? sources(path.join(dir, d.name))
  : d.name.endsWith('.js') ? [readFileSync(path.join(dir, d.name), 'utf8')] : [])).join('\n');
const code = sources(path.join(here, '../src'));

describe('translations', () => {
  it('English and German have the same keys and placeholders, none empty', () => {
    expect(Object.keys(de)).toEqual(Object.keys(en));
    for (const [key, text] of Object.entries(en)) {
      expect(de[key].trim(), key).not.toBe('');
      expect(placeholders(de[key]), key).toEqual(placeholders(text));
    }
  });

  it('every key the code uses exists, including the computed ones', () => {
    const used = new Set([...code.matchAll(/\bt\(\s*'([A-Za-z.]+)'/g)].map((m) => m[1]));
    for (const code of ['unsupported', 'too_big', 'corrupt', 'doctype', 'invalid', 'not_dmarc', 'other']) used.add(errorKey({ code }));
    for (const col of ['ip', 'host', 'count', 'disposition', 'dkim', 'spf', 'from', 'auth']) used.add(`details.col.${col}`);
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
    const computed = /^(error\.|details\.col\.|setting\.)/;
    for (const key of Object.keys(en)) {
      if (computed.test(key)) continue;
      expect(code.includes(`'${key}'`), key).toBe(true);
    }
  });
});
