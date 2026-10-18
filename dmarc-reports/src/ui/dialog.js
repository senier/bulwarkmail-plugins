// The Details dialog: the report's own facts, the policy the domain published,
// and one row per sending source with the verdict of each mechanism.

import { Badge, DialogButtons, Heading, Stack, Text } from '@plugin-host/ui';
import { dispositionTone, periodText, resultTone } from '../lib/view.js';

const cell = { padding: '4px 8px', textAlign: 'left', verticalAlign: 'top', borderBottom: '1px solid var(--color-border)' };
const head = { ...cell, fontWeight: 600, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap' };

export function makeReportDialog(React, api) {
  const { createElement: h } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  const fact = (label, value) => (value ? h('tr', { key: label }, h('th', { style: head, scope: 'row' }, label), h('td', { style: cell }, value)) : null);
  const facts = (rows) => h('table', { style: { borderCollapse: 'collapse', width: '100%' } }, h('tbody', null, rows));
  const badge = (result) => (result ? h(Badge, { tone: resultTone(result) }, result) : '–');

  function authCell(record) {
    const lines = [
      ...record.dkimResults.map((d, i) => h('div', { key: `d${i}` }, `DKIM ${d.domain}${d.selector ? ` (${d.selector})` : ''} `, badge(d.result))),
      ...record.spfResults.map((s, i) => h('div', { key: `s${i}` }, `SPF ${s.domain} `, badge(s.result))),
    ];
    return lines.length ? lines : '–';
  }

  return function ReportDialog({ report, verdict, onResult }) {
    const { metadata, policy, totals } = report;
    const locale = api.i18n.getLocale?.();
    return h(Stack, { gap: 4 },
      h(Stack, { gap: 2 },
        h(Heading, { level: 4 }, t('dialog.report')),
        facts([
          fact(t('dialog.reporter'), [metadata.org, metadata.email].filter(Boolean).join(' · ')),
          fact(t('dialog.contact'), metadata.contact),
          fact(t('dialog.reportId'), metadata.reportId),
          fact(t('dialog.period'), periodText(metadata, locale)),
          fact(t('dialog.totals'), t('bar.counts', { messages: totals.messages, passed: totals.passed, failed: totals.failed })),
          fact(t('dialog.dispositions'), t('dialog.dispositionsValue', { none: totals.none, quarantine: totals.quarantine, reject: totals.reject })),
          fact(t('dialog.errors'), metadata.errors.join('; ')),
        ]),
        verdict === 'suspicious' ? h('div', { role: 'alert' }, h(Text, { tone: 'danger' }, t('dialog.suspicious'))) : null),
      h(Stack, { gap: 2 },
        h(Heading, { level: 4 }, t('dialog.policy')),
        facts([
          fact(t('dialog.domain'), policy.domain),
          fact('p / sp / np', [policy.p, policy.sp, policy.np].filter(Boolean).join(' / ')),
          fact('pct', policy.pct),
          fact('adkim / aspf', `${policy.adkim} / ${policy.aspf}`),
          fact('fo', policy.fo),
          fact('testing', policy.testing),
        ])),
      h(Stack, { gap: 2 },
        h(Heading, { level: 4 }, t('dialog.sources')),
        h('div', { style: { overflowX: 'auto' } },
          h('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: '0.9em' } },
            h('thead', null, h('tr', null, ['ip', 'count', 'disposition', 'dkim', 'spf', 'from', 'auth']
              .map((key) => h('th', { key, style: head, scope: 'col' }, t(`dialog.col.${key}`))))),
            h('tbody', null, report.records.map((r, i) => h('tr', { key: i },
              h('td', { style: { ...cell, fontFamily: 'monospace' } }, r.ip || '–'),
              h('td', { style: cell }, r.count),
              h('td', { style: cell }, h(Badge, { tone: dispositionTone(r.disposition) }, r.disposition)),
              h('td', { style: cell }, badge(r.dkim)),
              h('td', { style: cell }, badge(r.spf)),
              h('td', { style: cell }, r.headerFrom || '–'),
              h('td', { style: cell }, authCell(r))))))),
        report.truncated > 0
          ? h(Text, { tone: 'muted' }, t('dialog.truncated', { shown: report.records.length, total: report.records.length + report.truncated }))
          : null),
      h(DialogButtons, { buttons: [{ id: 'close', label: t('dialog.close'), variant: 'secondary' }], onClick: () => onResult(null) }));
  };
}
