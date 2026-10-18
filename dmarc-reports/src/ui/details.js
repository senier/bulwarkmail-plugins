// The expanded part of the bar: the report's own facts, the policy the domain
// published and one row per sending source, with the hostname of each source
// when reverse DNS is on. Drawn in place, with the kit's detail rows, like the
// reader's own message details.

import { Badge, Button, DetailHeading, DetailList, DetailRow, Panel, Row, Spinner, Stack, Text } from '@plugin-host/ui';
import { makeResolver } from '../lib/dns.js';
import { dispositionTone, periodText, resultTone } from '../lib/view.js';

/** Rows drawn before "Show all". */
export const FIRST_ROWS = 100;

const cell = { padding: '4px 8px', textAlign: 'left', verticalAlign: 'top', borderBottom: '1px solid var(--color-border)' };
const head = { ...cell, fontWeight: 600, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--color-background)' };
const COLUMNS = ['ip', 'host', 'count', 'disposition', 'dkim', 'spf', 'from', 'auth'];

export function makeReportDetails(React, api, resolver = makeResolver(api)) {
  const { createElement: h, useEffect, useMemo, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);
  const badge = (result) => (result ? h(Badge, { tone: resultTone(result) }, result) : '–');

  function HostCell({ result }) {
    if (!result) return h(Spinner, { size: 'sm' });
    switch (result.status) {
      case 'ok':
        return h('span', null,
          h('span', { style: { fontFamily: 'monospace', wordBreak: 'break-all' } }, result.host),
          ' ',
          result.verified
            ? h(Badge, { tone: 'success' }, t('details.host.verified'))
            : h('span', { title: t('details.host.mismatchHelp') }, h(Badge, { tone: 'warning' }, t('details.host.mismatch'))),
          result.dnssec ? h(Badge, { tone: 'info' }, 'DNSSEC') : null);
      case 'none': return h(Text, { tone: 'muted' }, t('details.host.none'));
      case 'error': return h('span', { title: result.detail || result.reason }, h(Text, { tone: 'muted' }, t('details.host.error')));
      default: return '–';
    }
  }

  function authCell(record) {
    const lines = [
      ...record.dkimResults.map((d, i) => h('div', { key: `d${i}` }, `DKIM ${d.domain}${d.selector ? ` (${d.selector})` : ''} `, badge(d.result))),
      ...record.spfResults.map((s, i) => h('div', { key: `s${i}` }, `SPF ${s.domain} `, badge(s.result))),
    ];
    return lines.length ? lines : '–';
  }

  const row = (label, value, mono) => (value ? h(DetailRow, { label, mono }, value) : null);

  return function ReportDetails({ report, verdict }) {
    const { metadata, policy, totals } = report;
    const locale = api.i18n.getLocale?.();
    const [showAll, setShowAll] = useState(false);
    const [asked, setAsked] = useState(false);
    const [hosts, setHosts] = useState({});

    // A forged report can name addresses whose DNS the sender controls, so a
    // lookup would tell the sender the report was opened: only a verified
    // sender is looked up unasked.
    const enabled = resolver.enabled();
    const lookupNow = enabled && (verdict === 'trusted' || asked);
    const rows = useMemo(() => (showAll ? report.records : report.records.slice(0, FIRST_ROWS)), [report, showAll]);

    useEffect(() => {
      if (!lookupNow) return undefined;
      let live = true;
      for (const ip of new Set(rows.map((r) => r.ip))) {
        resolver.lookup(ip).then((result) => {
          if (live) setHosts((known) => (known[ip] ? known : { ...known, [ip]: result }));
        });
      }
      return () => { live = false; };
    }, [lookupNow, rows]);

    // The most common reason lookups failed, said once under the table.
    const problem = (() => {
      const counts = new Map();
      for (const r of Object.values(hosts)) {
        if (r.status === 'error') counts.set(r.reason, { n: (counts.get(r.reason)?.n ?? 0) + 1, detail: r.detail });
      }
      const [reason, info] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0] ?? [];
      return reason ? { reason, detail: info.detail } : null;
    })();

    return h(Panel, null,
      h(Stack, { gap: 4 },
        h('div', null,
          h(DetailHeading, null, t('details.report')),
          h(DetailList, null,
            row(t('details.reporter'), [metadata.org, metadata.email].filter(Boolean).join(' · ')),
            row(t('details.contact'), metadata.contact),
            row(t('details.reportId'), metadata.reportId, true),
            row(t('details.period'), periodText(metadata, locale)),
            row(t('details.totals'), t('bar.counts', { messages: totals.messages, passed: totals.passed, failed: totals.failed })),
            row(t('details.dispositions'), t('details.dispositionsValue', { none: totals.none, quarantine: totals.quarantine, reject: totals.reject })),
            row(t('details.errors'), metadata.errors.join('; ')))),
        h('div', null,
          h(DetailHeading, null, t('details.policy')),
          h(DetailList, null,
            row(t('details.domain'), policy.domain),
            row('p / sp / np', [policy.p, policy.sp, policy.np].filter(Boolean).join(' / ')),
            row('pct', policy.pct),
            row('adkim / aspf', `${policy.adkim} / ${policy.aspf}`),
            row('fo', policy.fo),
            row('testing', policy.testing))),
        h('div', null,
          h(DetailHeading, null, t('details.sources')),
          h(Stack, { gap: 2 },
            !enabled ? h(Text, { tone: 'muted' }, t('details.rdnsOff')) : null,
            enabled && !lookupNow
              ? h(Row, { gap: 2 },
                h(Button, { size: 'sm', variant: 'secondary', onClick: () => setAsked(true) }, t('details.lookup')),
                h(Text, { tone: 'muted' }, t('details.rdnsHold', { resolver: resolver.label() })))
              : null,
            lookupNow ? h(Text, { tone: 'muted' }, t('details.rdnsVia', { resolver: resolver.label() })) : null,
            problem
              ? h('div', { role: 'alert' }, h(Text, { tone: 'danger' }, t(`details.problem.${problem.reason}`, { resolver: resolver.label(), detail: problem.detail || '' })))
              : null,
            h('div', { style: { overflow: 'auto', maxHeight: 480 } },
              h('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: '0.9em' } },
                h('thead', null, h('tr', null, COLUMNS.map((key) => h('th', { key, style: head, scope: 'col' }, t(`details.col.${key}`))))),
                h('tbody', null, rows.map((r, i) => h('tr', { key: i },
                  h('td', { style: { ...cell, fontFamily: 'monospace' } }, r.ip || '–'),
                  h('td', { style: cell }, lookupNow ? h(HostCell, { result: hosts[r.ip] }) : '–'),
                  h('td', { style: cell }, r.count),
                  h('td', { style: cell }, h(Badge, { tone: dispositionTone(r.disposition) }, r.disposition)),
                  h('td', { style: cell }, badge(r.dkim)),
                  h('td', { style: cell }, badge(r.spf)),
                  h('td', { style: cell }, r.headerFrom || '–'),
                  h('td', { style: cell }, authCell(r))))))),
            report.records.length > rows.length
              ? h(Row, { gap: 2 }, h(Button, { size: 'sm', variant: 'ghost', onClick: () => setShowAll(true) }, t('details.showAll', { total: report.records.length })))
              : null,
            report.truncated > 0
              ? h(Text, { tone: 'muted' }, t('details.truncated', { shown: report.records.length, total: report.records.length + report.truncated }))
              : null))));
  };
}
