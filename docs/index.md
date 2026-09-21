---
layout: home

hero:
  name: Mailroom
  text: Your own mail, on your own domain
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
  - title: A complete API
    details: Twenty-eight endpoints covering sending, reading, filing and replying — with scoped keys, cursor pagination and idempotent sends.
  - title: Signed webhooks
    details: Nine events, HMAC-signed, retried four times, with a delivery log you can replay from.
  - title: A typed Node SDK
    details: "@shahriyardx/mailroom wraps the whole API with no dependencies. Runs on Node, Workers, Deno and Bun."
  - title: Delivery you can see
    details: Delivered, bounced, complained and opened, per message, with automatic suppression of addresses that bounce.
---
