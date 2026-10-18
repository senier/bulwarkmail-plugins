# DMARC reports

Shows a DMARC aggregate report you receive by mail as a bar above the message:
the domain, who reported it, the period, how many messages passed and failed
DMARC and the policy in force. **Details** expands the message in place, like
the reader's own message details: the report's facts, the published policy and a
table with one row per sending source (IP address, hostname, message count,
disposition, the DKIM and SPF verdicts and the authentication results behind
them).

Reports come as `.xml`, `.xml.gz` (Microsoft, Yahoo, Amazon SES, Mail.Ru) or
`.zip` (Google). The plugin recognises them by the file name RFC 7489 prescribes
(`receiver!domain!begin!end.ext`) or by a "Report domain:" subject. A report
attached with `Content-Disposition: inline` (Fastmail does that) counts too.

## Permissions

| Permission | Why |
|---|---|
| `email:read` | the subject, sender, attachment list and the message's own authentication result |
| `email:blob-read` | the report attachment's bytes (`api.email.getAttachment`) |
| `http:fetch` | only for reverse DNS, to the two resolvers in `httpOrigins` (below) |
| `ui:email-banner` | the bar above the message |

Unless you turn on reverse DNS, nothing is sent anywhere: the plugin makes no
network requests and runs only on the attachment the message already has.

## Reverse DNS

Off by default. In Settings > Plugins, choose a resolver (`cloudflare` or
`google`) and the sources in **Details** get a hostname, looked up over
DNS-over-HTTPS because browsers have no DNS of their own.

- Every name is **forward-confirmed**: whoever owns an address decides what its
  PTR record says, so a hostname is marked *verified* only when its own A or AAAA
  record points back to the address (otherwise *unconfirmed*). *DNSSEC* appears
  when the resolver validated every answer.
- **Privacy:** the source addresses of the report go to the resolver you chose.
  Nothing else does.
- **Not for reports you can't trust.** A forged report can list addresses whose
  DNS the sender controls, so a lookup would tell the sender that you opened it.
  Hostnames are therefore looked up unasked only when the message authenticated
  and comes from the reporting organisation; otherwise a **Look up hostnames**
  button waits for you.
- Only public addresses are looked up (never private, loopback, documentation or
  other special ranges), and only for the rows shown, four at a time. Results are
  cached in the plugin's storage for up to a day.

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
- an address is parsed strictly before it can become part of a DNS name or URL;
- at most 2,000 source rows are kept and 100 drawn until you ask for all of them;
  the totals count every record.

## Development

```
cd dmarc-reports && npm install        # fflate, bundled into the plugin
node scripts/build.mjs dmarc-reports   # from the repository root
npx vitest run dmarc-reports
```

The tests use anonymised copies of real reports from Google, Amazon SES, Fastmail
and Mail.Ru (`test/fixtures/`): the domain is `example.org`, addresses are from the
documentation ranges and the report IDs are made up.

Only English and German are translated; other languages fall back to English.
