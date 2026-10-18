// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeReportBanner } from '../src/ui/banner.js';
import { makeReportDialog } from '../src/ui/dialog.js';
import { parseReport } from '../src/lib/parse.js';
import { attachment, fixture, gz, manifest, message, zip } from './helpers.mjs';

afterEach(cleanup);

const apiWith = (data, { handlers, ...rest } = {}) => fakeApi({
  translations: manifest.locales,
  ...rest,
  handlers: { 'email.getAttachment': async () => ({ name: 'r', type: 'application/zip', size: data?.length ?? 0, data }), ...handlers },
});

async function show(api, email) {
  const Banner = makeReportBanner(React, api);
  await act(async () => { render(React.createElement(Banner, { email })); });
}

describe('the report bar', () => {
  it('summarises a clean Google report from its zip', async () => {
    const api = apiWith(zip(fixture('google')));
    await show(api, message());
    await waitFor(() => expect(screen.getByText('example.org · reported by google.com')).toBeTruthy());
    expect(screen.getByText('2 messages: 2 passed DMARC, 0 failed')).toBeTruthy();
    expect(screen.getByText('Policy p=none, sp=none, applied to 100%')).toBeTruthy();
    expect(document.querySelector('[data-tone="success"]')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls('email.getAttachment')[0].args).toEqual(['e1', 'b1']);
  });

  it('reads gzip too, and warns in amber when messages failed', async () => {
    const failing = fixture('amazon').replace('<dkim>pass</dkim>\n\t\t\t\t<spf>pass</spf>', '<dkim>fail</dkim><spf>fail</spf>');
    const api = apiWith(gz(failing));
    await show(api, message({ attachments: [attachment({ name: 'a!example.org!1767225600!1767311999.xml.gz' })] }));
    await waitFor(() => expect(screen.getByText('1 messages: 0 passed DMARC, 1 failed')).toBeTruthy());
    expect(document.querySelector('[data-tone="warning"]')).toBeTruthy();
  });

  it('warns loudly when the sender is not who the report says', async () => {
    const api = apiWith(gz(fixture('amazon')));
    await show(api, message({ from: [{ name: 'x', email: 'dmarc@evil.example' }] }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByText("The sender is not AMAZON-SES. Fake DMARC reports exist, so don't trust these numbers.")).toBeTruthy();
    expect(document.querySelector('[data-tone="warning"]')).toBeTruthy();
  });

  it('warns when the message itself failed authentication', async () => {
    const api = apiWith(zip(fixture('google')));
    await show(api, message({ auth: { dmarc: { result: 'fail' } } }));
    await waitFor(() => expect(screen.getByText("This message failed authentication. Fake DMARC reports exist, so don't trust these numbers.")).toBeTruthy());
  });

  it('says plainly, without alarm, when the sender could not be checked', async () => {
    const api = apiWith(zip(fixture('google')));
    await show(api, message({ auth: undefined }));
    await waitFor(() => expect(screen.getByText('The sender could not be verified. Reports can be forged.')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens the details dialog with the parsed report', async () => {
    const api = apiWith(zip(fixture('google')), { handlers: { 'ui.openDialog': async () => null } });
    await show(api, message());
    await waitFor(() => screen.getByText('Details'));
    await act(async () => { fireEvent.click(screen.getByText('Details')); });
    const opened = api.calls('ui.openDialog')[0].args[0];
    expect(opened).toMatchObject({ title: 'DMARC report for example.org', slot: 'plugin-dialog' });
    expect(opened.extraProps.report.records).toHaveLength(2);
    expect(opened.extraProps.verdict).toBe('trusted');
  });

  it('explains a file that is not a report, and a failed download', async () => {
    await show(apiWith(new TextEncoder().encode('%PDF-1.7 hello')), message());
    await waitFor(() => expect(screen.getByText('This attachment is not a DMARC report file.')).toBeTruthy());
    cleanup();
    const failing = apiWith(null, { handlers: { 'email.getAttachment': async () => { throw new Error('boom'); } } });
    await show(failing, message());
    await waitFor(() => expect(screen.getByText('The attachment could not be loaded.')).toBeTruthy());
  });

  it('renders nothing for a message without a report file', async () => {
    const api = apiWith(undefined);
    await show(api, message({ subject: 'Lunch?', attachments: [] }));
    expect(document.body.textContent).toBe('');
    expect(api.calls('email.getAttachment')).toHaveLength(0);
  });

  it('speaks German when the app does', async () => {
    const api = apiWith(zip(fixture('google')), { locale: 'de' });
    await show(api, message());
    await waitFor(() => expect(screen.getByText('example.org · gemeldet von google.com')).toBeTruthy());
  });
});

describe('the details dialog', () => {
  const dialog = (report, props = {}) => {
    const Dialog = makeReportDialog(React, fakeApi({ translations: manifest.locales }));
    let result = 'unset';
    return { result: () => result, ui: React.createElement(Dialog, { report, verdict: 'trusted', onResult: (v) => { result = v; }, ...props }) };
  };

  it('lists every source with its verdicts and closes with null', async () => {
    const d = dialog(parseReport(fixture('google')));
    await act(async () => { render(d.ui); });
    expect(screen.getByText('2001:db8:4864:20::348')).toBeTruthy();
    expect(screen.getByText('softfail')).toBeTruthy();
    expect(screen.getByText('noreply-dmarc-support@google.com', { exact: false })).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    await act(async () => { fireEvent.click(screen.getByText('Close')); });
    expect(d.result()).toBeNull();
  });

  it('shows data as text and never as markup', async () => {
    const report = parseReport(fixture('google'));
    report.metadata.org = '<img src=x onerror=alert(1)>';
    report.records[0].headerFrom = '<script>alert(1)</script>';
    await act(async () => { render(dialog(report).ui); });
    expect(document.querySelector('img, script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
  });

  it('flags a forged report and notes cut-off rows', async () => {
    const report = { ...parseReport(fixture('google')), truncated: 5 };
    await act(async () => { render(dialog(report, { verdict: 'suspicious' }).ui); });
    expect(screen.getByRole('alert').textContent).toContain('possibly forged');
    expect(screen.getByText('Showing the 2 busiest of 7 sources.')).toBeTruthy();
  });
});
