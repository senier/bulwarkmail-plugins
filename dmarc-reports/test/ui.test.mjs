// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeReportBanner } from '../src/ui/banner.js';
import { FIRST_ROWS } from '../src/ui/details.js';
import { attachment, fixture, gz, manifest, message, zip } from './helpers.mjs';

afterEach(cleanup);

const publicIps = (xml) => xml.replaceAll('203.0.113.10', '8.8.8.8').replaceAll('2001:db8:4864:20::348', '2001:4860:4860::8888');

/** A DoH answer: 8.8.8.8 is dns.google (confirmed), everything else has no reverse name. */
const doh = async (url) => {
  const u = new URL(url);
  const name = u.searchParams.get('name');
  const type = u.searchParams.get('type');
  const body = name === '8.8.8.8.in-addr.arpa' ? { Status: 0, AD: true, Answer: [{ type: 12, data: 'dns.google.' }] }
    : name === 'dns.google' && type === 'A' ? { Status: 0, AD: true, Answer: [{ type: 1, data: '8.8.8.8' }] }
      : { Status: 3 };
  return { ok: true, status: 200, headers: {}, bodyText: JSON.stringify(body) };
};

const apiWith = (data, { handlers, ...rest } = {}) => fakeApi({
  translations: manifest.locales,
  ...rest,
  handlers: { 'email.getAttachment': async () => ({ name: 'r', type: 'application/zip', size: data?.length ?? 0, data }), 'http.fetch': doh, ...handlers },
});

async function show(api, email) {
  const Banner = makeReportBanner(React, api);
  await act(async () => { render(React.createElement(Banner, { email })); });
}

const expand = async () => {
  await waitFor(() => screen.getByText('Details'));
  await act(async () => { fireEvent.click(screen.getByText('Details')); });
};

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

  it('shows the Fastmail report that arrives as an inline-disposition .xml.gz from a different sending domain', async () => {
    const email = message({
      subject: 'Report Domain: example.org Submitter: fastmail.com Report-ID:2026.01.01.0000000001',
      from: [{ name: '', email: 'reports@fastmaildmarc.com' }],
      attachments: [attachment({ name: 'fastmail.com!example.org!1767225600!1767311999!1000000001.xml.gz', type: 'application/gzip', size: 566, inline: true })],
    });
    await show(apiWith(gz(fixture('fastmail'))), email);
    await waitFor(() => expect(screen.getByText('example.org · reported by Fastmail Pty Ltd')).toBeTruthy());
    expect(screen.getByText('2 messages: 2 passed DMARC, 0 failed')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('The sender could not be verified. Reports can be forged.')).toBeNull();
  });

  it('reads gzip too, and goes amber when messages failed', async () => {
    const failing = fixture('amazon').replace('<dkim>pass</dkim>\n\t\t\t\t<spf>pass</spf>', '<dkim>fail</dkim><spf>fail</spf>');
    const api = apiWith(gz(failing));
    await show(api, message({ attachments: [attachment({ name: 'a!example.org!1767225600!1767311999.xml.gz' })] }));
    await waitFor(() => expect(screen.getByText('1 messages: 0 passed DMARC, 1 failed')).toBeTruthy());
    expect(document.querySelector('[data-tone="warning"]')).toBeTruthy();
  });

  it('warns loudly when the sender is not who the report says', async () => {
    await show(apiWith(gz(fixture('amazon'))), message({ from: [{ name: 'x', email: 'dmarc@evil.example' }] }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByText("The sender is not AMAZON-SES. Fake DMARC reports exist, so don't trust these numbers.")).toBeTruthy();
    expect(document.querySelector('[data-tone="warning"]')).toBeTruthy();
  });

  it('warns when the message itself failed authentication', async () => {
    await show(apiWith(zip(fixture('google'))), message({ auth: { dmarc: { result: 'fail' } } }));
    await waitFor(() => expect(screen.getByText("This message failed authentication. Fake DMARC reports exist, so don't trust these numbers.")).toBeTruthy());
  });

  it('says plainly, without alarm, when the sender could not be checked', async () => {
    await show(apiWith(zip(fixture('google'))), message({ auth: undefined }));
    await waitFor(() => expect(screen.getByText('The sender could not be verified. Reports can be forged.')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains a file that is not a report, and a failed download', async () => {
    await show(apiWith(new TextEncoder().encode('%PDF-1.7 hello')), message());
    await waitFor(() => expect(screen.getByText('This attachment is not a DMARC report file.')).toBeTruthy());
    cleanup();
    await show(apiWith(null, { handlers: { 'email.getAttachment': async () => { throw new Error('boom'); } } }), message());
    await waitFor(() => expect(screen.getByText('The attachment could not be loaded.')).toBeTruthy());
  });

  it('renders nothing for a message without a report file', async () => {
    const api = apiWith(undefined);
    await show(api, message({ subject: 'Lunch?', attachments: [] }));
    expect(document.body.textContent).toBe('');
    expect(api.calls('email.getAttachment')).toHaveLength(0);
  });

  it('speaks German when the app does', async () => {
    await show(apiWith(zip(fixture('google')), { locale: 'de' }), message());
    await waitFor(() => expect(screen.getByText('example.org · gemeldet von google.com')).toBeTruthy());
  });
});

describe('the details, in place', () => {
  it('expands under the bar and folds away again, without opening a dialog', async () => {
    const api = apiWith(zip(fixture('google')));
    await show(api, message());
    await waitFor(() => screen.getByText('Details'));
    expect(screen.queryByText('Source IP')).toBeNull();
    expect(screen.getByText('Details').getAttribute('aria-pressed')).toBeNull();

    await expand();
    expect(screen.getByText('Source IP')).toBeTruthy();
    expect(screen.getByText('Published policy')).toBeTruthy();
    expect(screen.getByText('noreply-dmarc-support@google.com', { exact: false })).toBeTruthy();
    expect(screen.getByText('Details').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);

    await act(async () => { fireEvent.click(screen.getByText('Details')); });
    expect(screen.queryByText('Source IP')).toBeNull();
    expect(api.calls('ui.openDialog')).toHaveLength(0);
  });

  it('lists each source with the verdicts of DKIM and SPF', async () => {
    await show(apiWith(zip(fixture('google'))), message());
    await expand();
    expect(screen.getByText('2001:db8:4864:20::348')).toBeTruthy();
    expect(screen.getByText('softfail')).toBeTruthy();
  });

  it('shows data as text and never as markup', async () => {
    const hostile = fixture('google').replace('<org_name>google.com', '<org_name>&lt;img src=x onerror=alert(1)&gt;').replace('<header_from>example.org</header_from>', '<header_from>&lt;script&gt;alert(1)&lt;/script&gt;</header_from>');
    await show(apiWith(zip(hostile)), message());
    await expand();
    expect(document.querySelector('img, script')).toBeNull();
    expect(screen.getAllByText('<script>alert(1)</script>').length).toBeGreaterThan(0);
  });

  it('draws the first rows and the rest on request', async () => {
    const rec = (i) => `<record><row><source_ip>8.8.${Math.floor(i / 250)}.${(i % 250) + 1}</source_ip><count>${i + 1}</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>example.org</header_from></identifiers></record>`;
    const xml = `<feedback><report_metadata><org_name>google.com</org_name><email>noreply-dmarc-support@google.com</email></report_metadata><policy_published><domain>example.org</domain></policy_published>${Array.from({ length: 150 }, (_, i) => rec(i)).join('')}</feedback>`;
    await show(apiWith(gz(xml)), message());
    await expand();
    expect(FIRST_ROWS).toBe(100);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(100);
    await act(async () => { fireEvent.click(screen.getByText('Show all 150 sources')); });
    expect(document.querySelectorAll('tbody tr')).toHaveLength(150);
  });
});

describe('reverse DNS in the details', () => {
  const google = () => zip(publicIps(fixture('google')));

  it('is off by default: no request, and a line saying how to turn it on', async () => {
    const api = apiWith(google());
    await show(api, message());
    await expand();
    expect(screen.getByText("Hostnames are not looked up. Turn on reverse DNS in this plugin's settings.")).toBeTruthy();
    expect(api.calls('http.fetch')).toHaveLength(0);
  });

  it('looks hostnames up by itself for a verified sender, and confirms them', async () => {
    const api = apiWith(google(), { settings: { rdns: 'cloudflare' } });
    await show(api, message());
    await expand();
    await waitFor(() => expect(screen.getByText('dns.google')).toBeTruthy());
    expect(screen.getByText('verified')).toBeTruthy();
    expect(screen.getByText('DNSSEC')).toBeTruthy();
    expect(screen.getByText('no reverse name')).toBeTruthy(); // the IPv6 source has none
    expect(screen.getByText('Hostnames from Cloudflare (DNS over HTTPS), each confirmed by a forward lookup.')).toBeTruthy();
    expect(api.calls('http.fetch').map((c) => new URL(c.args[0]).origin)).toEqual(expect.arrayContaining(['https://cloudflare-dns.com']));
  });

  it('flags a name the address owner could have made up', async () => {
    const lying = async (url) => (new URL(url).searchParams.get('type') === 'A'
      ? { ok: true, status: 200, headers: {}, bodyText: JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '192.0.2.7' }] }) }
      : doh(url));
    const api = apiWith(google(), { settings: { rdns: 'google' }, handlers: { 'http.fetch': lying } });
    await show(api, message());
    await expand();
    await waitFor(() => expect(screen.getByText('unconfirmed')).toBeTruthy());
    expect(screen.queryByText('verified')).toBeNull();
  });

  it.each([
    ['a sender that failed authentication', { auth: { dmarc: { result: 'fail' } } }],
    ['a sender that is not the reporter', { from: [{ name: 'x', email: 'dmarc@evil.example' }] }],
    ['a sender that could not be checked', { auth: undefined }],
  ])('waits for a click when the message comes from %s, since a forged report could use it to see who opens it', async (_, over) => {
    const api = apiWith(google(), { settings: { rdns: 'cloudflare' } });
    await show(api, message(over));
    await expand();
    expect(api.calls('http.fetch')).toHaveLength(0);
    expect(screen.getByText(/Not done automatically because the sender could not be verified/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('Look up hostnames')); });
    await waitFor(() => expect(screen.getByText('dns.google')).toBeTruthy());
    expect(api.calls('http.fetch').length).toBeGreaterThan(0);
  });

  it('never looks up the documentation addresses in the sample reports', async () => {
    const api = apiWith(zip(fixture('google')), { settings: { rdns: 'cloudflare' } });
    await show(api, message());
    await expand();
    await new Promise((r) => setTimeout(r, 30));
    expect(api.calls('http.fetch')).toHaveLength(0);
  });

  it('says a lookup failed without breaking the table', async () => {
    const api = apiWith(google(), { settings: { rdns: 'cloudflare' }, handlers: { 'http.fetch': async () => { throw new Error('offline'); } } });
    await show(api, message());
    await expand();
    await waitFor(() => expect(screen.getAllByText('lookup failed').length).toBeGreaterThan(0));
    expect(screen.getByText('8.8.8.8')).toBeTruthy();
  });
});
