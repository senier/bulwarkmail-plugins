// Anyone can mail a "DMARC report", and a fake one can say whatever it likes.
// Before the numbers are trusted, check that the message itself authenticated
// and that it comes from the organisation the report names.

const domainOf = (address) => String(address ?? '').split('@').pop().trim().toLowerCase();

function related(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * { authenticated: true | false | null, orgMatches: true | false | null,
 *   verdict: 'trusted' | 'suspicious' | 'unknown' }
 */
export function senderCheck(email, report) {
  const auth = email?.auth ?? null;
  let authenticated = null;
  if (auth?.dmarc?.result === 'pass') authenticated = true;
  else if ([auth?.dmarc?.result, auth?.dkim?.result, auth?.spf?.result].includes('fail')) authenticated = false;

  const from = domainOf(email?.from?.[0]?.email);
  const reporter = domainOf(report?.metadata?.email);
  const orgMatches = from && reporter ? related(from, reporter) : null;

  let verdict = 'unknown';
  if (authenticated === false || orgMatches === false) verdict = 'suspicious';
  else if (authenticated === true && orgMatches === true) verdict = 'trusted';
  return { authenticated, orgMatches, verdict };
}
