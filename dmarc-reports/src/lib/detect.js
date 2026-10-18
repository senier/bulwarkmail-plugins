// Is this message a DMARC aggregate report, and which attachments hold it?
// RFC 7489 7.2.1.1 names the file "receiver!policy-domain!begin!end[!id].ext";
// subjects start with "Report Domain:" at nearly every big reporter.

const SUBJECT = /report domain:|dmarc[^\n]{0,24}report|aggregate report/i;
const NAME = /!\d{9,11}!\d{9,11}(![^.]*)?\.(xml|xml\.gz|gz|zip)$/i;
const FILE = /\.(xml|xml\.gz|gz|zip)$/i;
const TYPE = /^(application\/(gzip|x-gzip|zip|x-zip-compressed|xml|octet-stream)|text\/xml)$/i;

/** Most reports one message may show. */
export const MAX_REPORTS = 3;

/** The attachments that look like report files. */
export function reportAttachments(email) {
  const subjectHit = SUBJECT.test(String(email?.subject ?? ''));
  const list = Array.isArray(email?.attachments) ? email.attachments : [];
  return list
    .filter((a) => a && a.blobId && !a.inline && Number(a.size) > 0)
    .filter((a) => NAME.test(a.name ?? '') || (subjectHit && (FILE.test(a.name ?? '') || TYPE.test(a.type ?? ''))))
    .slice(0, MAX_REPORTS);
}

/**
 * Cheap gate for the slot (runs before its frame exists). The attachment list
 * can still be empty then, so the subject alone is enough to mount it.
 */
export function shouldShow(props) {
  const email = props?.email;
  if (!email) return false;
  return SUBJECT.test(String(email.subject ?? '')) || reportAttachments(email).length > 0;
}
