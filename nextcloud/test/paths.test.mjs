import { describe, it, expect } from 'vitest';
import {
  normalizePath, joinPath, parentPath, baseName, breadcrumb, encodePath, davFilesUrl, davUploadsUrl,
  hrefToPath, sanitizeFileName, uniqueName, uploadFolder, originOf, baseOf,
} from '../src/lib/paths.js';

describe('paths', () => {
  it('normalizes and joins paths without escaping the root', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('a//b/./c/')).toBe('/a/b/c');
    expect(normalizePath('/a/../../b')).toBe('/b');
    expect(joinPath('/Mail attachments', '2026-10-14', 'x.pdf')).toBe('/Mail attachments/2026-10-14/x.pdf');
    expect(parentPath('/a/b/c')).toBe('/a/b');
    expect(parentPath('/a')).toBe('/');
    expect(baseName('/a/b c.pdf')).toBe('b c.pdf');
  });

  it('builds a breadcrumb from the root', () => {
    expect(breadcrumb('/Documents/Invoices')).toEqual([
      { name: '', path: '/' },
      { name: 'Documents', path: '/Documents' },
      { name: 'Invoices', path: '/Documents/Invoices' },
    ]);
  });

  it('encodes each segment for WebDAV URLs', () => {
    expect(encodePath('/Report 2026/ä#1.pdf')).toBe('/Report%202026/%C3%A4%231.pdf');
    expect(davFilesUrl('https://c.example', 'alice@x', '/a b')).toBe('https://c.example/remote.php/dav/files/alice%40x/a%20b');
    expect(davFilesUrl('https://c.example', 'alice', '/')).toBe('https://c.example/remote.php/dav/files/alice/');
    expect(davUploadsUrl('https://c.example', 'alice', 'up-1', '00002')).toBe('https://c.example/remote.php/dav/uploads/alice/up-1/00002');
  });

  it('turns hrefs back into paths, also under a sub-path and for full URLs', () => {
    expect(hrefToPath('/remote.php/dav/files/alice/Documents/Report%202026.pdf', 'alice')).toBe('/Documents/Report 2026.pdf');
    expect(hrefToPath('/cloud/remote.php/dav/files/alice/Photos/', 'alice')).toBe('/Photos');
    expect(hrefToPath('https://c.example/remote.php/dav/files/alice%40x/a', 'alice@x')).toBe('/a');
    expect(hrefToPath('/remote.php/dav/files/alice/', 'alice')).toBe('/');
    expect(hrefToPath('/remote.php/dav/files/bob/a', 'alice')).toBeNull();
    expect(hrefToPath('/remote.php/dav/files/alicex/a', 'alice')).toBeNull();
  });

  it('cleans file names', () => {
    expect(sanitizeFileName('a/b\\c:d*.pdf')).toBe('a_b_c_d_.pdf');
    expect(sanitizeFileName('..hidden')).toBe('hidden');
    expect(sanitizeFileName('   ', 'message.eml')).toBe('message.eml');
    expect(sanitizeFileName('line\nbreak.txt')).toBe('linebreak.txt');
  });

  it('picks a free name, case-insensitively', () => {
    expect(uniqueName('a.pdf', [])).toBe('a.pdf');
    expect(uniqueName('a.pdf', ['A.pdf'])).toBe('a (2).pdf');
    expect(uniqueName('a.pdf', ['a.pdf', 'a (2).pdf'])).toBe('a (3).pdf');
    expect(uniqueName('README', ['README'])).toBe('README (2)');
  });

  it('puts uploads in a dated folder only with the date layout', () => {
    const day = new Date(2026, 9, 4);
    expect(uploadFolder('Mail attachments', 'date', day)).toBe('/Mail attachments/2026-10-04');
    expect(uploadFolder('/Up/', 'flat', day)).toBe('/Up');
    expect(uploadFolder('', 'flat', day)).toBe('/Mail attachments');
  });

  it('reads an origin from what an admin typed', () => {
    expect(originOf('cloud.example.com/nextcloud')).toBe('https://cloud.example.com');
    expect(originOf('http://localhost:18080/')).toBe('http://localhost:18080');
    expect(originOf('ftp://x')).toBeNull();
    expect(originOf('')).toBeNull();
  });
});

describe('baseOf', () => {
  it('keeps the sub-path and drops slashes, query and hash', () => {
    expect(baseOf('cloud.example.com/nextcloud/')).toBe('https://cloud.example.com/nextcloud');
    expect(baseOf('https://c.example/a/b/?x=1#y')).toBe('https://c.example/a/b');
    expect(baseOf('https://c.example/')).toBe('https://c.example');
    expect(baseOf('ftp://c.example')).toBeNull();
    expect(baseOf('')).toBeNull();
  });

  it('builds DAV URLs below the sub-path', () => {
    expect(davFilesUrl('https://c.example/nextcloud', 'alice', '/a')).toBe('https://c.example/nextcloud/remote.php/dav/files/alice/a');
    expect(hrefToPath('/nextcloud/remote.php/dav/files/alice/a', 'alice')).toBe('/a');
  });
});
