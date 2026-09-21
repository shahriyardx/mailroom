# The Node SDK

```sh
npm install @shahriyardx/mailroom
```

The whole API, typed, with **no dependencies** — one `fetch` and Web Crypto.
Node 18 or newer, and anywhere else `fetch` exists: Workers, Deno, Bun, the
browser. Ships ESM, CommonJS and types.

[npm](https://www.npmjs.com/package/@shahriyardx/mailroom) ·
[source](https://github.com/shahriyardx/mailroom/tree/main/packages/sdk)

## Start

```ts
import { Mailroom } from "@shahriyardx/mailroom";

const mail = new Mailroom({
  apiKey: process.env.MAILROOM_API_KEY,
  baseUrl: "https://mail.yourdomain.com",
});

const me = await mail.me();
console.log(me.name, me.scopes, me.reach);

await mail.emails.send({
  from: "receipts@yourdomain.com",
  to: "customer@example.net",
  subject: "Your receipt",
  html: "<p>Thanks.</p>",
});
```

CommonJS is the same:

```js
const { Mailroom } = require("@shahriyardx/mailroom");
```

## Settings

```ts
const mail = new Mailroom({
  apiKey: process.env.MAILROOM_API_KEY, // default: process.env.MAILROOM_API_KEY
  baseUrl: "https://mail.yourdomain.com", // default: process.env.MAILROOM_BASE_URL
  timeout: 30_000,                       // ms to wait for a reply
  maxRetries: 2,                         // extra tries after a 429, 5xx or dropped socket
  headers: { "X-Trace-Id": "…" },        // sent on every call
  fetch: myFetch,                        // your own fetch, for tests or a proxy agent
});
```

With `MAILROOM_API_KEY` and `MAILROOM_BASE_URL` set, `new Mailroom()` on its
own is enough.

`baseUrl` is your instance's address. The `/api/v1` suffix is added for you,
so `https://mail.yourdomain.com` and `https://mail.yourdomain.com/api/v1` both
work.

Both settings are checked in the constructor, so a missing key is an error
where you made the client, not a `401` somewhere later.

## What is on the client

| | |
| --- | --- |
| `mail.me()` | What this key is and what it may do |
| `mail.emails` | [Sending](/sdk/sending), and reading what was sent |
| `mail.threads` | [Conversations](/sdk/reading) |
| `mail.messages` | Individual messages |
| `mail.attachments` | Files on a message |
| `mail.mailboxes` | [Addresses](/sdk/managing) |
| `mail.domains` | Sending domains and their DNS |
| `mail.labels` | Labels |
| `mail.contacts` | Everyone corresponded with |
| `mail.suppressions` | Blocked addresses |
| `mail.webhooks` | Endpoints and their deliveries |
| `mail.stats` | Sending and receiving numbers |
| `mail.rateLimit` | The window from the last reply |
| `mail.http` | The escape hatch, for an endpoint not yet wrapped |

## Webhooks

The package also verifies incoming webhooks, with no Node build needed:

```ts
import { constructWebhookEvent } from "@shahriyardx/mailroom";

const event = await constructWebhookEvent({
  secret: process.env.MAILROOM_WEBHOOK_SECRET!,
  payload: rawBody,
  signature: request.headers.get("x-mailroom-signature"),
});
```

See [Verifying a call](/webhooks/verifying).

## Types

Every object, parameter and event is exported:

```ts
import type {
  Message, Thread, Mailbox, Domain, Label, Contact, Suppression,
  Webhook, WebhookDelivery, Stats, Page,
  SendEmailInput, ListThreadsParams, MailroomWebhookEvent,
} from "@shahriyardx/mailroom";
```

Timestamps are ISO 8601 **strings**, because that is what JSON carries. Pass
one to `new Date()` when you need a date.
