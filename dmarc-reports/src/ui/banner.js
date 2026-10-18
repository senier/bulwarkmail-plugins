// The bar above a report message: who reported, which domain, how many
// messages passed, and a Details button for the per-source table. Built from
// a factory so tests can hand in React and a fake api.

import { BarButton, InfoBar, Loading, Row, Text } from '@plugin-host/ui';
import { MAX_XML_BYTES, unpackReport } from '../lib/unpack.js';
import { parseReport } from '../lib/parse.js';
import { reportAttachments } from '../lib/detect.js';
import { senderCheck } from '../lib/sender.js';
import { barLook, errorKey, periodText } from '../lib/view.js';

export function makeReportBanner(React, api) {
  const { createElement: h, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  async function load(emailId, attachment) {
    const file = await api.email.getAttachment(emailId, attachment.blobId);
    return parseReport(unpackReport(file.data));
  }

  function ReportBar({ email, attachment }) {
    const [state, setState] = useState({ status: 'loading' });

    useEffect(() => {
      let live = true;
      setState({ status: 'loading' });
      load(email.id, attachment).then(
        (report) => { if (live) setState({ status: 'ready', report }); },
        (error) => {
          api.log.warn('dmarc-reports: could not read a report', error?.code ?? error?.message);
          if (live) setState({ status: 'error', error });
        },
      );
      return () => { live = false; };
    }, [email.id, attachment.blobId]);

    if (state.status === 'loading') return h(InfoBar, { tone: 'neutral', icon: 'shield', eyebrow: t('bar.eyebrow'), compact: true }, h(Loading, { label: t('bar.loading') }));
    if (state.status === 'error') {
      return h(InfoBar, { tone: 'neutral', icon: 'shield', eyebrow: t('bar.eyebrow'), title: attachment.name },
        h('div', { role: 'status' }, h(Text, { tone: 'muted' }, t(errorKey(state.error), { limit: Math.round(MAX_XML_BYTES / 1048576) }))));
    }

    const { report } = state;
    const check = senderCheck(email, report);
    const { tone, icon } = barLook(report, check.verdict);
    const { metadata, policy, totals } = report;
    const org = metadata.org || metadata.email || '?';
    const period = periodText(metadata, api.i18n.getLocale?.());
    const open = () => api.ui.openDialog({
      title: t('dialog.title', { domain: policy.domain || '?' }),
      slot: 'plugin-dialog',
      extraProps: { report, verdict: check.verdict },
      width: 900,
    });

    return h('div', { 'data-dmarc-report': report.policy.domain },
      h(InfoBar, { tone, icon, eyebrow: t('bar.eyebrow'), title: t('bar.title', { domain: policy.domain || '?', org }) },
        period ? h(Text, { tone: 'muted' }, period) : null,
        h(Text, { tone: 'muted' }, t('bar.counts', { messages: totals.messages, passed: totals.passed, failed: totals.failed })),
        h(Text, { tone: 'muted' }, t('bar.policy', { p: policy.p || '–', sp: policy.sp || policy.p || '–', pct: policy.pct || '100' })),
        check.authenticated === false
          ? h('div', { role: 'alert' }, h(Text, { tone: 'danger' }, t('bar.warnAuth')))
          : null,
        check.orgMatches === false
          ? h('div', { role: 'alert' }, h(Text, { tone: 'danger' }, t('bar.warnOrg', { org })))
          : null,
        check.verdict === 'unknown'
          ? h(Text, { tone: 'muted' }, t('bar.unverified'))
          : null,
        h(Row, { gap: 2 }, h(BarButton, { icon: 'chart-bar', onClick: open }, t('bar.details')))));
  }

  return function ReportBanner(props) {
    const email = props?.email ?? null;
    if (!email) return null;
    const attachments = reportAttachments(email);
    if (attachments.length === 0) return null;
    return h('div', null, attachments.map((attachment) => h(ReportBar, { key: attachment.blobId, email, attachment })));
  };
}
