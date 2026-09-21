# Self-hosting it

Start to finish. Deploy **before** the SES and Cloudflare steps: both have to
reach a real URL, so nothing past step 3 works against `localhost`.

## 1. A GitHub OAuth app

GitHub is the only way to sign in.

**github.com → Settings → Developer settings → OAuth Apps → New**

- Homepage: `https://mail.yourdomain.com`
- Callback: `https://mail.yourdomain.com/api/auth/callback/github`

Keep the client ID and secret.

## 2. The environment

```sh
DATABASE_URL=postgres://user:pass@host:5432/mail
BETTER_AUTH_SECRET=          # openssl rand -base64 32
BETTER_AUTH_URL=https://mail.yourdomain.com
NEXT_PUBLIC_APP_URL=https://mail.yourdomain.com

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

::: warning BETTER_AUTH_SECRET is load-bearing
It also derives the key that encrypts your stored Cloudflare token. Changing
it later makes that token unreadable, and you will have to paste a new one.
:::

### Where each value comes from

Three of these you generate, several you copy out of a dashboard, and two you
cannot fill in until step 5 — leave those empty for the first deploy.

#### You make these up

| | |
| --- | --- |
| `BETTER_AUTH_SECRET` | Run `openssl rand -base64 32` |
| `INBOUND_WEBHOOK_SECRET` | Run `openssl rand -hex 32` |
| `DATABASE_URL` | Your Postgres. On Coolify, add a Postgres service and copy the internal URL it shows |

#### Your app's own address

| | |
| --- | --- |
| `BETTER_AUTH_URL` | The public URL of this app, e.g. `https://mail.yourdomain.com` |
| `NEXT_PUBLIC_APP_URL` | The same URL. Both, and they must match |

#### GitHub

From the OAuth app you made in step 1:

| | |
| --- | --- |
| `GITHUB_CLIENT_ID` | On the OAuth app's page |
| `GITHUB_CLIENT_SECRET` | Press **Generate a new client secret**. Shown once |

#### AWS

| | |
| --- | --- |
| `AWS_REGION` | The region you set SES up in, e.g. `us-east-1`. SES is per-region — mail sent from the wrong one fails |
| `AWS_ACCESS_KEY_ID` | IAM → Users → your user → **Security credentials** → Create access key |
| `AWS_SECRET_ACCESS_KEY` | Shown once, beside the key id |

Give that IAM user [the policy below](#the-iam-policy). **Leave both keys empty
to use an instance role instead**, which is better if you are on EC2 or
anything else that can assume one.

#### Cloudflare R2

In the Cloudflare dashboard, **R2 → Overview**:

| | |
| --- | --- |
| `R2_ACCOUNT_ID` | The **Account ID** in the right-hand sidebar |
| `R2_BUCKET` | The bucket you create here. Any name; `mail-attachments` is the default |
| `R2_ACCESS_KEY_ID` | **Manage R2 API Tokens** → Create API token → **Object Read & Write** |
| `R2_SECRET_ACCESS_KEY` | Shown once, with the key id |

::: warning Keep the bucket private
Giving it a public custom domain makes every raw message and attachment
readable by anyone with the URL. Let the app serve them instead — it signs
short-lived links.
:::

#### Filled in after step 5

These two do not exist yet. Deploy without them, press **Set up delivery
reporting** on Settings → Domains, then come back.

**`SES_CONFIGURATION_SET=mail-events`** — that exact string. It is what
attaches a configuration set to outgoing mail, and without it SES never
reports anything, so every message stays at `sent` forever.

**`SES_SNS_TOPIC_ARN`** is optional, and it looks like this:

```
arn:aws:sns:us-east-1:123456789012:mail-events
             ^^^^^^^^^ ^^^^^^^^^^^^ ^^^^^^^^^^^
             region    your AWS      the topic
                       account id    name
```

You cannot invent it — the middle part is your twelve-digit AWS account id.
Get the real one in any of three ways:

1. **From the app.** After pressing *Set up delivery reporting*, the panel on
   Settings → Domains gains an **SNS topic** row. Click it to copy.
2. **From the setup script.** `pnpm ses:setup` creates the whole pipeline and
   writes both `SES_CONFIGURATION_SET` and `SES_SNS_TOPIC_ARN` into your
   `.env` for you.
3. **From AWS.** Console → SNS → Topics → `mail-events`. The ARN is at the
   top of the page.

Setting it makes the app **refuse events from any other topic**, so a stranger
who finds your `/api/ses/events` URL cannot post fake bounces at it. Worth
doing once you have it; the app works without it.

#### Safe to leave alone

| | Default |
| --- | --- |
| `SES_MAIL_FROM_PREFIX` | `mail` — the return path becomes `mail.yourdomain.com` |
| `SES_DKIM_SELECTOR` | `mail` — only used for keys this app generates |
| `FORWARD_TO` | empty — set it to also forward every inbound message to another address |
| `RUN_MIGRATIONS_ON_BOOT` | `true` — set `false` to apply migrations yourself |

### The IAM policy

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

## 3. Deploy

The Dockerfile builds everything, worker bundle included, and applies
migrations on boot.

```sh
docker build -t mailroom .
docker run -p 3000:3000 --env-file .env mailroom
```

On **Coolify**: point it at your fork, build pack **Dockerfile**, port
**3000**, paste the environment, deploy.

## 4. Sign in

Open your URL and sign in with GitHub. That first account becomes the
**owner**, and public sign-up closes behind you.

Everyone after that joins through an invitation you send from
**Settings → People**. Invited people set a **password**, so your colleagues
do not each need a GitHub account to read their own mail.

## 5. Domains and delivery reporting

See [Sending domains](/guide/domains). Short version: add each domain under
**Settings → Domains**, publish the records it shows, then press **Set up
delivery reporting** and set `SES_CONFIGURATION_SET=mail-events`.

## 6. Receiving

See [Receiving mail](/guide/receiving). Short version: create a Cloudflare API
token with six permissions, paste it under **Settings → Inbound worker**,
press **Deploy worker**, then **Receive mail here** on each domain.

## 7. A mailbox

**Settings → Mailboxes.** Add `you@yourdomain.com` and send yourself
something.

## Running it locally

```sh
pnpm install
cp .env.example .env     # fill it in
pnpm db:migrate
pnpm dev
```

Sending works locally. Receiving does not — Cloudflare cannot reach your
laptop, so deploy somewhere to test inbound mail.

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
| `pnpm sdk:build` / `pnpm sdk:test` | The Node SDK |
| `pnpm reset-owner --yes` | Release the owner slot so another account can claim it |
