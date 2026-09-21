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

Leave the AWS keys empty to use an instance role instead.

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

Open your URL and sign in with GitHub. That first account becomes the owner,
and registration closes behind you.

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
