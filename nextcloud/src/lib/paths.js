// Paths inside the user's Nextcloud and the WebDAV URLs for them.
//
// A path is always absolute inside the user's files, "/" for the root,
// without a trailing slash: "/Documents/Invoices".

/** Clean up a path: one leading slash, no empty, "." or ".." segments. */
export function normalizePath(path) {
  const out = [];
  for (const part of String(path ?? '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return '/' + out.join('/');
}

export function joinPath(...parts) {
  return normalizePath(parts.map((p) => String(p ?? '')).join('/'));
}

export function parentPath(path) {
  const p = normalizePath(path);
  if (p === '/') return '/';
  return p.slice(0, p.lastIndexOf('/')) || '/';
}

export function baseName(path) {
  const p = normalizePath(path);
  return p === '/' ? '' : p.slice(p.lastIndexOf('/') + 1);
}

/** The folders from the root down to `path`, for a breadcrumb. */
export function breadcrumb(path) {
  const p = normalizePath(path);
  const crumbs = [{ name: '', path: '/' }];
  if (p === '/') return crumbs;
  let acc = '';
  for (const part of p.slice(1).split('/')) {
    acc += '/' + part;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}

/** Percent-encode each segment, keep the slashes. */
export function encodePath(path) {
  return normalizePath(path).split('/').map((s) => encodeURIComponent(s)).join('/');
}

export function davFilesUrl(origin, userId, path) {
  const p = normalizePath(path);
  return `${origin}/remote.php/dav/files/${encodeURIComponent(userId)}${p === '/' ? '/' : encodePath(p)}`;
}

export function davUploadsUrl(origin, userId, uploadId, chunk) {
  const base = `${origin}/remote.php/dav/uploads/${encodeURIComponent(userId)}/${encodeURIComponent(uploadId)}`;
  return chunk === undefined ? base : `${base}/${encodeURIComponent(chunk)}`;
}

/**
 * The file path for an href from a WebDAV answer, or null when the href is
 * not inside this user's files. Nextcloud may live under a sub-path
 * ("/cloud/remote.php/..."), and the href may be a full URL.
 */
export function hrefToPath(href, userId) {
  let pathname = String(href ?? '');
  try { pathname = new URL(pathname, 'http://x').pathname; } catch { return null; }
  const marker = `/remote.php/dav/files/${encodeURIComponent(userId)}`;
  let i = pathname.indexOf(marker);
  let rest;
  if (i >= 0) rest = pathname.slice(i + marker.length);
  else {
    // Some servers send the user id unencoded.
    const plain = `/remote.php/dav/files/${userId}`;
    i = pathname.indexOf(plain);
    if (i < 0) return null;
    rest = pathname.slice(i + plain.length);
  }
  if (rest && !rest.startsWith('/')) return null;
  try {
    return normalizePath(rest.split('/').map((s) => decodeURIComponent(s)).join('/'));
  } catch {
    return null;
  }
}

/** A file name Nextcloud accepts: no slashes, no control characters, not empty. */
export function sanitizeFileName(name, fallback = 'file') {
  const cleaned = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/[:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 200)
    .trim();
  return cleaned || fallback;
}

/** `name`, or "name (2).ext", "name (3).ext", ... if it is already taken. */
export function uniqueName(name, taken) {
  const used = new Set([...(taken ?? [])].map((n) => String(n).toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; n < 10000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/** The upload folder for today: base, or base/YYYY-MM-DD with the "date" layout. */
export function uploadFolder(base, layout, date = new Date()) {
  const root = normalizePath(base || 'Mail attachments');
  if (layout !== 'date') return root;
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return joinPath(root, day);
}

/** The origin of a URL the user or admin typed, adding https:// if missing; null if invalid. */
export function originOf(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origin plus the sub-path Nextcloud is installed under ("https://host/cloud"),
 * without a trailing slash; null if invalid. Every request URL is built on this.
 */
export function baseOf(value) {
  const origin = originOf(value);
  if (!origin) return null;
  const raw = String(value).trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
