<img src="docs/public/brand/banner.png" alt="Mailroom — your own mail, on your own domain" width="100%">

# Mailroom

Self-hosted email. Sends through **Amazon SES**, receives through a
**Cloudflare Email Worker**, stores everything in **Postgres**.

One instance per company. First sign-in becomes owner; everyone else joins by
invitation. No public sign-up.

![built with Next.js, Postgres, SES and Cloudflare](https://img.shields.io/badge/stack-Next.js%2015%20%C2%B7%20Postgres%20%C2%B7%20SES%20%C2%B7%20Cloudflare-5a45d6)

<img src="docs/public/shots/inbox.png" alt="The inbox: mailboxes by domain down the side, conversations with their labels in the list" width="100%">

## What you get

- **Unlimited mailboxes** across any number of domains
- **People and teams** — roles, plus mailbox access one by one or a team at a time
- **Scope switching** — all mail, one domain, or one address
- Threading, search, labels, filters, drafts, signatures, attachments
- **Live updates** — new mail appears without a refresh
- **Domains managed from the app** — add, get DNS records, watch it verify
- **Subdomains for free** — a subdomain of a verified domain needs no records
- **Worker deployed from the app** — no `wrangler`
- **Delivery reporting** — delivered, bounced, complained, automatic suppression
- **A complete API** — 28 endpoints, scoped keys, signed webhooks
- **A typed Node SDK**, `@shahriyardx/mailroom`

## What it looks like

|                                                         |                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| <img src="docs/public/shots/conversation.png" alt="A conversation, with its labels beside the subject and the sender's SPF, DKIM and DMARC results under their name"> | <img src="docs/public/shots/compact.png" alt="The same list at compact density"> |
| **A conversation.** Labels beside the subject, and what the sender's domain actually proved under their name. | **Compact density.** Sender and subject only, chosen per person and saved. |
| <img src="docs/public/shots/settings-overview.png" alt="Settings overview: what has been sent and received in the last 30 days, and what SES said about it"> | <img src="docs/public/shots/settings-mailboxes.png" alt="Mailboxes across several domains and subdomains"> |
| **Delivery you can see.** Sent, received, bounced and complained over a rolling 30 days, straight from SES. | **Mailboxes.** As many as you like, on any domain — and a subdomain of a verified domain needs no DNS of its own. |
| <img src="docs/public/shots/settings-api-keys.png" alt="API keys, each with its own scopes and reach"> | <img src="docs/public/shots/mobile-inbox.png" alt="The inbox on a phone"> |
| **Scoped API keys.** Per-endpoint scopes, and a reach limited to one domain or one mailbox. | **On a phone.** The same instance, one thing at a time. |

## Install

Run the published image — multi-arch, `amd64` and `arm64`.

```sh
docker run -d --name mailroom -p 3000:3000 --env-file .env \
  ghcr.io/shahriyardx/mailroom:latest
```

With Postgres included: [`compose.yaml`](compose.yaml).

Settings are read at container start, not baked in. Migrations run on boot.
Full walkthrough: [self-hosting guide](https://mailroom-docs.shahriyar.dev/guide/self-hosting).

## Before you start

| | Why | Cost |
| --- | --- | --- |
| A **Postgres** database | Storage | Free locally, ~$0 self-hosted |
| An **AWS account** with SES | Sending | Pennies. Needs production access, or you can only send to verified addresses |
| A **Cloudflare account**, domain on it | Receiving | Free |
| A **Cloudflare R2** bucket | Attachments and raw messages | Free tier |
| Somewhere to run it | Coolify, Fly, a VPS | Your call |

## 1. Create a GitHub OAuth app

GitHub is the only way to sign in.

**github.com → Settings → Developer settings → OAuth Apps → New**

- Homepage: `https://mail.yourdomain.com`
- Callback: `https://mail.yourdomain.com/api/auth/callback/github`

Keep the client ID and secret.

## 2. Set the environment

```sh
DATABASE_URL=postgres://user:pass@host:5432/mail
BETTER_AUTH_SECRET=          # openssl rand -base64 32
BETTER_AUTH_URL=https://mail.yourdomain.com
APP_URL=https://mail.yourdomain.com

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_MAIL_FROM_PREFIX=mail    # the return path becomes mail.yourdomain.com
SES_CONFIGURATION_SET=       # set to mail-events for delivery reporting (step 5)
SES_SNS_TOPIC_ARN=           # optional: only accept events from this topic

INBOUND_WEBHOOK_SECRET=      # openssl rand -hex 32

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=mail-attachments

FORWARD_TO=                  # optional: also forward everything to this address
UPDATE_CHECK=                # set to off to stop the sidebar asking GitHub for releases
```

`BETTER_AUTH_SECRET` also derives the key that encrypts your stored Cloudflare
token. Changing it later makes that token unreadable.

Leave the AWS keys empty to use an instance role instead.

<details>
<summary>The IAM policy this needs</summary>

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
      "ses:PutEmailIdentityDkimSigningAttributes",
      "ses:PutEmailIdentityMailFromAttributes",
      "ses:CreateConfigurationSet",
      "ses:GetConfigurationSetEventDestinations",
      "ses:CreateConfigurationSetEventDestination",
      "ses:UpdateConfigurationSetEventDestination",
      "sns:CreateTopic",
      "sns:GetTopicAttributes",
      "sns:SetTopicAttributes",
      "sns:Subscribe",
      "sns:ListSubscriptionsByTopic",
      "sns:GetSubscriptionAttributes"
    ],
    "Resource": "*"
  }]
}
```
</details>

## 3. Deploy it

Run the image from [Install](#install) with the environment above.

On Coolify: Docker image `ghcr.io/shahriyardx/mailroom:latest`, port **3000**,
paste the environment, deploy.

Deploy **before** the next steps. SES and Cloudflare must reach a real URL —
nothing below works against `localhost`.

## 4. Sign in

Open your URL, sign in with GitHub. That account becomes **owner** and public
sign-up closes. Everyone after joins by invitation and sets a **password**, so
they do not need a GitHub account.

## 5. Add your sending domains

**Settings → Domains**

Domains already verified in SES import themselves. For a new one, type it in
and publish the DNS records shown — one click copies each.

A subdomain of an already-verified domain needs no records: SES inherits
verification downwards.

Then press **Set up delivery reporting**. That builds the SNS topic, wires SES
to it and subscribes the app.

One manual step after: set `SES_CONFIGURATION_SET=mail-events` and redeploy.
SES only reports on messages sent with a configuration set attached. The panel
then shows an **SNS topic** row — click to copy the ARN into `SES_SNS_TOPIC_ARN`
so no other topic is accepted. `pnpm ses:setup` does the same from the command
line and writes both variables into `.env`.

## 6. Turn on receiving

**Settings → Inbound worker**

Create a Cloudflare API token with these permissions:

```
Account → Workers Scripts     → Edit
Account → Workers R2 Storage  → Edit
Zone    → Zone                → Read
Zone    → Zone Settings       → Edit
Zone    → Email Routing Rules → Edit
Zone    → DNS                 → Edit
```

**Zone Settings is easy to miss.** Cloudflare gates turning Email Routing on
behind it, not behind the Email Routing permission.

Paste the token, press **Deploy worker**, then **Receive mail here** on each
domain.

> Turning a zone on replaces its MX records with Cloudflare's. Anything
> receiving mail on that domain today stops. Set `FORWARD_TO` first for a copy
> to keep reaching your old inbox.

## 7. Make a mailbox

**Settings → Mailboxes.** Add `you@yourdomain.com` and send yourself something.

Tick **Catch-all** to collect every unclaimed address on that domain in one
inbox, or **Capture every address** to give each one its own mailbox.

## Sending from your own code

**Settings → API keys.** A key not locked to one mailbox can send as any
address on a verified domain, creating the mailbox on first use.

```sh
curl -X POST https://mail.yourdomain.com/api/v1/emails \
  -H "Authorization: Bearer mk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "noreply@yourdomain.com",
    "to": ["someone@example.com"],
    "subject": "Hello",
    "html": "<p>Sent through SES</p>"
  }'
```

- `GET /api/v1/emails/:id` — delivery status and the SES event trail
- `GET /api/v1/domains` — your sending domains and their records

### The Node SDK

The whole API, typed, with retries, pagination and webhook signature checking.

```sh
npm install @shahriyardx/mailroom
```

```ts
import { Mailroom } from "@shahriyardx/mailroom";

const mail = new Mailroom({
  apiKey: process.env.MAILROOM_API_KEY,
  baseUrl: "https://mail.yourdomain.com",
});

await mail.emails.send({
  from: "noreply@yourdomain.com",
  to: "someone@example.com",
  subject: "Hello",
  html: "<p>Sent through SES</p>",
});
```

Source: [`packages/sdk`](packages/sdk#readme).

## Development

For working on Mailroom itself. To run it, use the image above.

```sh
pnpm install
cp .env.example .env     # fill it in
pnpm db:migrate
pnpm dev
```

Sending works locally. Receiving does not — Cloudflare cannot reach your
laptop.

| | |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Bundle the worker, then build |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Browse the database |
| `pnpm lint` / `pnpm format` | Biome |
| `pnpm typecheck` | TypeScript |
| `pnpm reset-owner --yes` | Release the owner slot |
| `pnpm sdk:build` | Build the Node SDK |
| `pnpm sdk:test` | Test the Node SDK |

## Worth knowing

- **No public sign-up.** Uninvited sign-in is rejected, not queued for approval.
- **Secrets are encrypted** before storage, keyed from `BETTER_AUTH_SECRET`.
- **The inbound webhook is signed** — HMAC over timestamp and body, with a
  freshness window.
- **Message bodies are sandboxed** in a script-free iframe; remote images
  blocked until you ask for them.
- **An R2 custom domain makes raw messages public.** Keep the bucket private.
- **Watch your bounce rate.** SES suspends accounts above 5% bounces or 0.1%
  complaints. The overview shows both against those thresholds.

## Built with

Next.js 15 · React 19 · Tailwind v4 with a hand-built kit on Radix ·
Drizzle + Postgres · better-auth · Amazon SES v2 · Cloudflare Workers, Email
Routing and R2 · Biome

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE). Free for personal projects, research,
teaching and charitable work.

Any use by or for a business needs a commercial licence, including running it
as a company's own mail. Write to <mdshahriyaralam552@gmail.com>.

The Node SDK in [`packages/sdk`](packages/sdk) stays MIT.
