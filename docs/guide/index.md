# What it is

Mailroom is a self-hosted email platform. You run one instance, on your own
server, against your own database, for your own domains.

It does both halves of email:

- **Sending** goes out through **Amazon SES**, so your mail arrives rather
  than landing in spam.
- **Receiving** comes in through a **Cloudflare Email Worker**, which hands
  each message to your instance.

Everything — messages, threads, labels, contacts, keys — lives in **your
Postgres**. Attachments and raw messages live in **your R2 bucket**. Nothing
passes through anybody else's service, and nothing is metered by anybody but
AWS and Cloudflare.

## Who it is for

One company runs one instance, and as many people work in it as you invite.

The first person to sign in becomes the **owner**. After that, public sign-up
is closed: everyone else arrives through an invitation, picks up a role, and
sees only the mailboxes they have been granted. Teams let you grant several
people at once.

A stranger who finds the sign-in page cannot give themselves an inbox.

It suits you if you want:

- Mail on a domain you own, without paying per mailbox
- Transactional sending and a real inbox in the same place
- An API over both, so your own code can read and answer mail

It does **not** suit you if you want a hosted product somebody else keeps
running. There is nothing to sign up for.

## What it is not

- **Not an SMTP server.** SES sends; Cloudflare receives. Mailroom is the
  application on top, not the mail transfer agent.
- **Not IMAP.** There is no IMAP or POP endpoint, so Apple Mail and Thunderbird
  cannot connect. The web app and the API are the two ways in.
- **Not a spam filter.** Cloudflare and SES do what filtering happens. Inbound
  mail carries its SPF, DKIM and DMARC results so you can decide for yourself.

## What you need

| | Why | Cost |
| --- | --- | --- |
| **Postgres** | Everything is stored here | Free locally, near zero self-hosted |
| **AWS** with SES | Sending | Pennies. You must ask AWS for production access, or you can only send to verified addresses |
| **Cloudflare**, with your domain on it | Receiving | Free |
| **Cloudflare R2** | Attachments and raw messages | Generous free tier |
| Somewhere to run it | Docker anywhere: Coolify, Fly, a VPS | Your call |

## Next

- [How it fits together](/guide/architecture) — what talks to what
- [Self-hosting it](/guide/self-hosting) — the deploy, start to finish
