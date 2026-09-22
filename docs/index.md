---
layout: home

hero:
  name: Mailroom
  text: Your own mail, on your own domain
  image:
    src: /shots/inbox.png
    alt: The Mailroom inbox
  tagline: Sends through Amazon SES, receives through a Cloudflare Email Worker, keeps everything in your Postgres. One company, one instance, as many people as you invite.
  actions:
    - theme: brand
      text: Get started
      link: /guide/
    - theme: alt
      text: The API
      link: /api/
    - theme: alt
      text: GitHub
      link: https://github.com/shahriyardx/mailroom

features:
  - title: A real inbox, not just an outbox
    details: Threading, search, labels, filters, drafts, signatures and attachments, across unlimited mailboxes on any number of domains. New mail appears as it lands.
  - title: People, roles and teams
    details: Invite colleagues, give each an owner, admin or member role, and grant mailboxes one at a time or a team at a time. A member sees only what you give them.
  - title: Domains managed from the app
    details: Add a domain, copy its DNS records, watch it verify. A subdomain of a domain you already verified needs no records at all.
  - title: Forwarding without a redeploy
    details: Nothing is forwarded until you add a rule. Once you do, a copy of inbound mail goes on to an address outside Mailroom — for the whole instance, one domain or one mailbox — from the very next message.
  - title: A complete API
    details: Twenty-eight endpoints covering sending, reading, filing and replying — with scoped keys, cursor pagination and idempotent sends.
  - title: Signed webhooks
    details: Nine events, HMAC-signed, retried four times, with a delivery log you can replay from.
  - title: A typed Node SDK
    details: "@shahriyardx/mailroom wraps the whole API with no dependencies. Runs on Node, Workers, Deno and Bun."
  - title: Delivery you can see
    details: Delivered, bounced, complained and opened, per message, with automatic suppression of addresses that bounce.
---

<div style="max-width:1152px;margin:64px auto 0;padding:0 24px">

## What it looks like

A conversation, with its labels beside the subject and what the sender's domain
actually proved under their name.

![A conversation in Mailroom](/shots/conversation.png)

Density and layout are chosen per person and saved to the database, so they
follow you onto every device you sign in from.

![The appearance settings](/shots/settings-appearance.png)

Delivery is not a guess. Sent, received, bounced and complained over a rolling
thirty days, straight from SES.

![The settings overview](/shots/settings-overview.png)

As many mailboxes as you like, across any number of domains — and a subdomain
of a domain you have already verified needs no DNS records of its own.

![Mailboxes across several domains](/shots/settings-mailboxes.png)

Keys are scoped twice over: to the endpoints they may call, and to the one
domain or mailbox they may touch.

![API keys with their scopes](/shots/settings-api-keys.png)

</div>
