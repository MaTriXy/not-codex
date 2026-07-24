# Email routing and DMARC operations

Cloudflare Email Routing forwards inbound mail for the Not Codex role addresses. It does not provide
an outbound mailbox and cannot make replies pass SPF or DKIM by itself.

## Current public DNS

The following records were verified publicly on 2026-07-24:

- `notcodex.bpro.dev` MX routes to Cloudflare Email Routing.
- `notcodex.bpro.dev` has one SPF record: `v=spf1 include:_spf.mx.cloudflare.net ~all`.
- `_dmarc.notcodex.bpro.dev` publishes:
  `v=DMARC1; p=none; rua=mailto:security@notcodex.bpro.dev; adkim=r; aspf=r; pct=100`.

Keep exactly one SPF TXT record at the product hostname. When an outbound provider is added, merge
its include or sending policy into that record instead of publishing a second SPF record.

## Monitor aggregate reports

DMARC aggregate reports normally arrive as compressed XML attachments. They describe authentication
results by sending source; they do not contain message bodies.

1. Add a mailbox filter for messages sent to `security@notcodex.bpro.dev` whose subject or attachment
   mentions DMARC, and retain the reports for at least 30 days. A dedicated
   `dmarc@notcodex.bpro.dev` route can be introduced later if report traffic obscures security mail.
2. Review reports at least weekly while the policy is `p=none`. Record each sending IP or provider,
   message count, visible `From` domain, SPF result and alignment, and DKIM result and alignment.
3. Classify every source as authorized, forwarded/indirect mail, or unknown. Investigate unknown
   sources; do not allowlist them merely because they are frequent.
4. Send a real message from every configured outbound service to external Gmail and non-Gmail
   accounts. Inspect the received headers and confirm that DMARC passes through aligned SPF, aligned
   DKIM, or both.
5. If a third-party DMARC analyzer is used, review its privacy, retention, access-control, and data
   residency terms before changing the `rua` destination.

## Tighten enforcement safely

Do not move beyond monitoring until every legitimate sender is known and the role addresses have a
configured outbound provider with aligned SPF and DKIM.

After at least 30 representative days without unexplained legitimate failures:

1. Start with `p=quarantine; pct=10` and continue weekly review.
2. Increase `pct` gradually only while legitimate delivery remains healthy.
3. Move to `p=reject` only after quarantine has covered 100 percent of mail for a representative
   period and forwarding or mailing-list behavior has been evaluated.

Keep the aggregate-report destination active after enforcement. Re-check reports whenever a sender,
mail provider, DKIM selector, or SPF policy changes.

## Verification commands

```sh
dig +short MX notcodex.bpro.dev
dig +short TXT notcodex.bpro.dev
dig +short TXT _dmarc.notcodex.bpro.dev
```

DNS presence is not proof that outbound mail is aligned. Use received-message authentication headers
and aggregate reports as the authoritative delivery evidence.
