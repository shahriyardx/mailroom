# Mailroom

Self-hosted email. Sends through **Amazon SES**, receives through a
**Cloudflare Email Worker**, keeps everything in **Postgres**.

One company runs one instance. The first person to sign in becomes its
owner; everyone else joins by invitation, with a role and their own view of
the mailboxes they may reach. There is no public sign-up, so a stranger who
finds the sign-in page cannot give themselves an inbox.

![built with Next.js, Postgres, SES and Cloudflare](https://img.shields.io/badge/stack-Next.js%2015%20%C2%B7%20Postgres%20%C2%B7%20SES%20%C2%B7%20Cloudflare-5a45d6)

## What you get

- **Unlimited mailboxes** across any number of domains
- **People and teams** — invite colleagues, give each a role, and grant
  mailboxes one by one or a team at a time
- **Scope switching** — read all mail, one domain, or one address, in any folder
- Threading, search, labels, filters, drafts, signatures, attachments
- **Live updates** — new mail appears as it lands, no refresh
- **Domains managed from the app** — add one, get its DNS records, watch it verify
- **Subdomains for free** — a subdomain of a verified domain needs no records at all
- **Worker deployed from the app** — no `wrangler`, no separate deploy
- **Delivery reporting** — delivered, bounced, complained, with automatic suppression
- **A complete API** — 28 endpoints for sending, reading, filing and replying,
  with scoped keys and signed webhooks
- **A typed Node SDK**, `@shahriyardx/mailroom`

## Install

Run the published image. Do not build from a clone — a release is already
built, for `amd64` and `arm64`, and a clone follows `main` rather than a
version somebody decided was ready.

```sh
docker run -d --name mailroom -p 3000:3000 --env-file .env \
  ghcr.io/shahriyardx/mailroom:latest
```

Or take a Postgres with it: [`compose.yaml`](compose.yaml).

Nothing about your install is inside the image — every setting is read when
the container starts, and migrations run on boot. Full walkthrough in the
[self-hosting guide](https://mailroom-docs.shahriyar.dev/guide/self-hosting).

## Before you start

You need five things:

| | Why | Cost |
| --- | --- | --- |
| A **Postgres** database | Everything is stored here | Free locally, ~$0 self-hosted |
| An **AWS account** with SES | Sending | Pennies. Ask AWS for production access or you can only send to verified addresses |
| A **Cloudflare account**, domain on it | Receiving | Free |
| A **Cloudflare R2** bucket | Attachments and raw messages | Free tier is generous |
| Somewhere to run it | Docker anywhere: Coolify, Fly, a VPS | Your call |

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

The Dockerfile builds everything, including the worker bundle, and applies
migrations on boot.

```sh
docker build -t mailroom .
docker run -p 3000:3000 --env-file .env mailroom
```

On Coolify: point it at your fork, build pack **Dockerfile**, port **3000**,
paste the environment, deploy.

Deploy **before** the next steps. SES and Cloudflare both have to reach a real
URL, so nothing below works against `localhost`.

## 4. Sign in

Open your URL and sign in with GitHub. That first account becomes the
**owner**, and public sign-up closes behind you — everyone after that joins
through an invitation you send them.

Invited people set a **password** rather than needing a GitHub account of
their own.

## 5. Add your sending domains

**Settings → Domains**

Domains already verified in SES import themselves. For a new one, type it in
and publish the DNS records it shows you — one click copies each.

A **subdomain of a domain you have already verified** needs nothing: add it
and it is ready, because SES inherits verification downwards.

Then press **Set up delivery reporting** on the same screen. That builds the
SNS topic, wires SES to it and subscribes the app.

One manual step after it: set `SES_CONFIGURATION_SET=mail-events` in your
environment and redeploy. SES only reports on a message that was sent with a
configuration set attached, and that variable is what attaches it. The panel
then gains an **SNS topic** row: click it to copy the ARN, and put that in
`SES_SNS_TOPIC_ARN` so no other topic is accepted. `pnpm ses:setup` does the
same from the command line and writes both variables into `.env` for you.

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
> receiving mail on that domain today stops. Set `FORWARD_TO` first if you
> want a copy to keep reaching your old inbox.

## 7. Make a mailbox

**Settings → Mailboxes.** Add `you@yourdomain.com` and send yourself
something.

Tick **Catch-all** to collect every unclaimed address on that domain in one
inbox, or switch on **Capture every address** for the domain to give each one
its own mailbox.

## Sending from your own code

**Settings → API keys.** A key that is not locked to one mailbox can send as
any address on a verified domain, creating the mailbox on first use.

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

The whole API, typed, with retries, pagination and webhook signature checking:

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

It lives in [`packages/sdk`](packages/sdk#readme), in this repository, so it
cannot drift away from the API it talks to.

## Running it locally

```sh
pnpm install
cp .env.example .env     # fill it in
pnpm db:migrate
pnpm dev
```

Sending works locally. Receiving does not: Cloudflare cannot reach your
laptop, so deploy it somewhere to test inbound mail.

## Commands

| | |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Bundle the worker, then build |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Browse the database |
| `pnpm lint` / `pnpm format` | Biome |
| `pnpm typecheck` | TypeScript |
| `pnpm reset-owner --yes` | Release the owner slot so another account can claim it |
| `pnpm sdk:build` | Build the Node SDK |
| `pnpm sdk:test` | Test the Node SDK |

## Worth knowing

- **No public sign-up.** An uninvited sign-in is rejected outright, not queued
  for approval. Invitations are the only way in after the first account.
- **Secrets are encrypted** before storage, keyed from `BETTER_AUTH_SECRET`.
- **The inbound webhook is signed** — HMAC over timestamp and body, with a
  freshness window, so only your worker can post mail.
- **Message bodies are sandboxed** in a script-free iframe and remote images
  are blocked until you ask for them.
- **An R2 custom domain makes raw messages public.** Leave the bucket private
  and let the app serve attachments.
- **Watch your bounce rate.** SES suspends accounts above 5% bounces or 0.1%
  complaints. The overview shows both against those thresholds.

## Built with

Next.js 15 · React 19 · Tailwind v4 with a hand-built kit on Radix ·
Drizzle + Postgres · better-auth · Amazon SES v2 · Cloudflare Workers, Email
Routing and R2 · Biome

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE). Free for personal projects,
research, teaching, and charitable work — install it, change it, share it.

Any use by or for a business needs a commercial licence, including running
it as a company's own mail. Write to <mdshahriyaralam552@gmail.com>.

The Node SDK in [`packages/sdk`](packages/sdk) stays MIT, so it can be
embedded in anything.
