# Mail

Self-hosted email client. Sends through **Amazon SES**, receives through a
**Cloudflare Email Worker**, stores everything in **Postgres**.

- Next.js 15 (App Router) + React 19
- Tailwind v4, shadcn/ui, Biome, TypeScript
- better-auth (email + password)
- Drizzle ORM + Postgres
- Amazon SES v2 for sending, domain identities and delivery events
- Cloudflare R2 for attachments and raw `.eml` copies

## Features

### Mail client
- Unlimited mailboxes, across any number of domains
- Scope switch: **all mail**, **one domain**, or **one mailbox** — applies to every folder
- Folders: inbox, starred, sent, drafts, archive, spam, trash
- Conversation threading (`In-Reply-To` / `References`, subject fallback)
- Compose, reply, reply-all, forward, autosaved drafts, signatures per mailbox
- Attachments in and out (R2), inline `cid:` images
- Full-text search (Postgres `tsvector`) scoped to the current view
- Labels and inbound filter rules
- Remote images blocked by default; bodies isolated in a script-free sandboxed iframe
- SPF / DKIM / DMARC verdicts shown per message
- Keyboard shortcuts: `c` compose, `/` search, `g i|s|d|a|t` jump folder, `⌘↵` send

### SES management
- **Auto-import**: existing verified SES identities appear on first visit to Settings
- **Manual import** button, plus per-domain "check status now"
- Add a domain from the UI: creates the identity with Easy DKIM and a custom MAIL FROM
- Every DNS record listed with one-click copy (DKIM CNAMEs, MAIL FROM MX + SPF, root SPF, DMARC)
- Live status per domain: verification, DKIM, MAIL FROM, plus our own SPF/DMARC DNS probe
- Account panel: production access, enforcement status, 24h quota and send rate
- Bounce and complaint handling through SNS, with automatic suppression

### Public API
- `POST /api/v1/emails` — send, with attachments, from any mailbox you own
- `GET /api/v1/emails/:id` — delivery status and the SES event trail
- `GET /api/v1/domains` — sending domains and their DNS records
- Bearer API keys, stored only as SHA-256 hashes, optionally locked to one mailbox

## 1. Database

```bash
docker compose up -d          # Postgres on localhost:5433
cp .env.example .env          # then fill it in
pnpm db:migrate               # create tables
```

## 2. Environment

```
DATABASE_URL=postgres://mail:mail@localhost:5433/mail
BETTER_AUTH_SECRET=          # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_CONFIGURATION_SET=       # optional, needed for delivery events
SES_SNS_TOPIC_ARN=           # optional, pins which SNS topic may post events
SES_MAIL_FROM_PREFIX=mail    # mail.acme.com as the return path

INBOUND_WEBHOOK_SECRET=      # openssl rand -hex 32

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=mail-attachments
```

Leave `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` empty to fall back to the
instance role or your shared AWS config.

### IAM permissions the app needs

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ses:SendEmail",
      "ses:GetAccount",
      "ses:ListEmailIdentities",
      "ses:GetEmailIdentity",
      "ses:CreateEmailIdentity",
      "ses:DeleteEmailIdentity",
      "ses:PutEmailIdentityDkimAttributes",
      "ses:PutEmailIdentityMailFromAttributes"
    ],
    "Resource": "*"
  }]
}
```

## 3. Run

```bash
pnpm dev
```

Open http://localhost:3000 and create your account. **Settings** then imports your
existing SES domains automatically; press **Import from SES** any time to refresh.
Add a mailbox per address you want to send from or receive at.

## 4. Sending domains

A domain is usable once SES reports it verified **and** enabled for sending.

New domains are set up with a DKIM key this app generates: the private half goes
to SES and is immediately discarded, only the public half is kept, and you
publish a single TXT record. Set the selector with `SES_DKIM_SELECTOR`
(default `mail`).

A domain imported from SES keeps whatever DKIM it already has. One set up with
Easy DKIM shows its three CNAMEs and offers a **Use one TXT record** button to
move it onto a generated key. One keyed elsewhere — as useSend does — shows its
selector as a reference row, since that record is already published and its
public key is not something SES will tell us.

The records a domain needs:

| Record | Purpose |
| --- | --- |
| TXT on `<selector>._domainkey.<domain>` | DKIM public key |
| MX on `mail.<domain>` | bounce return path |
| TXT on `mail.<domain>` | SPF for the return path |
| TXT on `<domain>` | SPF covering SES sending **and** Cloudflare receiving |
| TXT on `_dmarc.<domain>` | DMARC policy (optional but recommended) |

The root SPF record must cover both directions:

```
v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all
```

### Getting these records published

Add them at your DNS host by hand. Click any value in the table to copy it; the
name column shows the short form your host expects and copies the full hostname.
This app never writes to your DNS provider and stores no provider credentials.

## 5. Delivery events (bounces and complaints)

Two scripts do this for you, using the keys already in `.env`:

```bash
pnpm ses:status    # read-only: account, identities, config sets, topics
pnpm ses:setup     # creates the configuration set, SNS topic and event destination
```

`ses:setup` is safe to re-run — it creates only what is missing and appends to the
SNS topic policy rather than replacing it. It writes `SES_CONFIGURATION_SET` and
`SES_SNS_TOPIC_ARN` back into `.env`.

Once the app is live on a public HTTPS URL, point SNS at it:

```bash
node scripts/ses-setup-events.mjs --endpoint https://your-app/api/ses/events
```

AWS calls that URL straight away and the app confirms the subscription itself.

The endpoint verifies the AWS signature on every payload, confirms the
subscription itself, records each event, updates the message status, and adds
hard bounces and complaints to the blocked list so nothing mails them again.

## 6. Receiving mail (Cloudflare)

```bash
cd worker
npx wrangler r2 bucket create mail-attachments
# edit worker/wrangler.toml -> APP_INBOUND_URL = "https://mail.yourdomain.com/api/inbound"
npx wrangler secret put INBOUND_WEBHOOK_SECRET   # same value as the app's .env
npx wrangler deploy
```

Then per domain in the Cloudflare dashboard:

1. **Email → Email Routing → Enable** (adds the MX and SPF records).
2. **Routing rules → Create rule**, or set a **Catch-all address**.
3. Action: **Send to a Worker** → `mail-inbound`.

Flow: Cloudflare receives → worker parses MIME → attachments to R2 → signed JSON
POST to `/api/inbound` → rows in Postgres.

The app answers `202` when no local mailbox owns the address, and the worker then
rejects with `550 5.1.1`. Any other failure makes the worker throw, so Cloudflare
retries instead of dropping mail.

## 7. Using the API

Create a key in **Settings → API keys**. It is shown once.

```bash
curl -X POST https://your-app/api/v1/emails \
  -H "Authorization: Bearer mk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "hello@acme.com",
    "to": ["someone@example.com"],
    "cc": ["copy@example.com"],
    "reply_to": "support@acme.com",
    "subject": "Hello",
    "html": "<p>Sent through SES</p>",
    "text": "Sent through SES",
    "attachments": [
      { "filename": "invoice.pdf", "content": "<base64>", "content_type": "application/pdf" }
    ]
  }'
```

Returns `202` with `{ id, message_id, ses_message_id, thread_id }`. Everything sent
this way also lands in that mailbox's **Sent** folder.

| Code | Meaning |
| --- | --- |
| 401 | missing, unknown, or revoked key |
| 403 | `from` is not a mailbox on this account, or the key is locked elsewhere |
| 409 | domain not verified, or a recipient is on the blocked list |
| 422 | body failed validation |
| 502 | SES refused the message |

## 8. Security notes

- `/api/inbound` verifies an HMAC over `timestamp.body` and rejects anything older
  than 5 minutes, so the endpoint cannot be spoofed or replayed.
- `/api/ses/events` verifies the AWS SNS signature and only accepts signing
  certificates served from an `sns.<region>.amazonaws.com` host.
- API keys are stored as SHA-256 hashes; the raw token exists only in the response
  that creates it.
- Email HTML renders in an iframe with no `allow-scripts`, and inline handlers,
  `<script>`, `<iframe>`, and `javascript:` URLs are stripped before render.
- Remote images are held back until you click **Show images**, which blocks the
  usual open-tracking pixels.
- Attachments are served through short-lived signed R2 URLs, checked against your
  session first.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | dev server |
| `pnpm build` | production build |
| `pnpm lint` / `pnpm format` | Biome check / write |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | new migration from schema changes |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:push` | push the schema straight to a dev database |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm worker:dev` | run the email worker locally |
| `pnpm worker:deploy` | deploy the email worker |

## Layout

```
src/
  app/
    (mail)/mail/[[...slug]]   scope + folder + thread view
    (mail)/settings           one page each: domains, mailboxes, api-keys,
                              blocked, labels, filters, account
    api/inbound               signed webhook from the Cloudflare worker
    api/ses/events            SNS delivery events
    api/v1/emails             public send API
    api/v1/domains            public domain listing
    api/upload                staged compose attachments
    api/attachments/[id]      signed R2 download
    api/counts                sidebar badges
  components/mail/            shell, list, reading pane, composer, settings panels
  db/schema.ts                Drizzle schema
  lib/                        auth, SES, MIME, R2, SNS, scope, sanitiser
  server/                     queries, actions, domains, send, ingest
worker/                       Cloudflare Email Worker
scripts/                      one-off maintenance scripts
```
