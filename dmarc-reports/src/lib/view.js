// Display helpers: formatting and the words for what the parser found.

export function formatInstant(ms, locale) {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** "Oct 15, 2026, 12:00 AM – Oct 16, 2026, 12:00 AM" in UTC, or ''. */
export function periodText(metadata, locale) {
  const from = formatInstant(metadata?.begin, locale);
  const to = formatInstant(metadata?.end, locale);
  return from && to ? `${from} – ${to}` : (from || to);
}

/** Badge tone for an authentication result word. */
export function resultTone(result) {
  switch (result) {
    case 'pass': return 'success';
    case 'fail': case 'permerror': return 'danger';
    case 'softfail': case 'temperror': case 'policy': return 'warning';
    default: return 'neutral';
  }
}

export function dispositionTone(disposition) {
  if (disposition === 'reject') return 'danger';
  if (disposition === 'quarantine') return 'warning';
  return 'neutral';
}

/** Tone and icon of the bar: clean reports are green, anything failing is not. */
export function barLook(report, verdict) {
  if (verdict === 'suspicious') return { tone: 'warning', icon: 'shield-exclamation' };
  if (report.totals.failed > 0) return { tone: 'warning', icon: 'shield-exclamation' };
  return { tone: 'success', icon: 'shield-check' };
}

/** Translation key of the message for an unpack or parse error. */
export function errorKey(err) {
  switch (err?.code) {
    case 'unsupported': return 'error.unsupported';
    case 'too_big': return 'error.tooBig';
    case 'corrupt': return 'error.corrupt';
    case 'doctype': return 'error.doctype';
    case 'invalid': return 'error.invalid';
    case 'not_dmarc': return 'error.notDmarc';
    default: return 'error.read';
  }
}
