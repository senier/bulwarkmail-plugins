# DMARC reports

Shows a DMARC aggregate report you receive by mail as a bar above the message:
the domain, who reported it, the period, how many messages passed and failed
DMARC and the policy in force. **Details** opens a table with one row per
sending source: IP address, message count, disposition, the DKIM and SPF verdicts
and the authentication results behind them.

Reports come as `.xml`, `.xml.gz` (Microsoft, Yahoo, Amazon SES, Mail.Ru) or
`.zip` (Google). The plugin recognises them by the file name RFC 7489 prescribes
(`receiver!domain!begin!end.ext`) or by a "Report domain:" subject.

## Permissions

| Permission | Why |
|---|---|
| `email:read` | the subject, sender, attachment list and the message's own authentication result |
| `email:blob-read` | the report attachment's bytes (`api.email.getAttachment`) |
| `ui:email-banner` | the bar above the message |

Nothing is sent anywhere: the plugin makes no network requests, stores nothing
and runs only on the attachment the message already has.

## Fake reports

Anyone can mail a "DMARC report", and a forged one can claim anything. The bar
turns amber and says so when the message itself failed authentication, or when
the sender's domain is not the reporting organisation named in the report
(`report_metadata/email`). When the message could not be checked at all, a quiet
line says that instead.

## Safety of the attachment

The attachment is attacker-controlled, so:

- decompression is streamed and stops at 20 MB of XML (a zip bomb costs
  milliseconds, not memory);
- XML with a `DOCTYPE` or an entity declaration is refused, which rules out
  entity expansion;
- the report's fields are shown as text, never as markup or links;
- at most 2,000 source rows are drawn; the totals count every record.

## Development

```
cd dmarc-reports && npm install        # fflate, bundled into the plugin
node scripts/build.mjs dmarc-reports   # from the repository root
npx vitest run dmarc-reports
```

The tests use anonymised copies of real reports from Google, Amazon SES and
Mail.Ru (`test/fixtures/`): the domain is `example.org`, addresses are from the
documentation ranges and the report IDs are made up.

Only English and German are translated; other languages fall back to English.
