# @shahriyardx/mailroom

The Node and TypeScript SDK for [Mailroom](https://github.com/shahriyardx/mailroom) — self-hosted mail on Amazon SES and Cloudflare.

Send mail, read your inbox, file conversations, manage domains and mailboxes, and receive signed webhooks, against **your own** instance.

- Every `/api/v1` endpoint, typed
- No dependencies — one `fetch` and Web Crypto, nothing else
- ESM and CommonJS, Node 18+, and anywhere else `fetch` exists (Workers, Deno, Bun, the browser)
- Typed errors, automatic retries, cursor pagination as an `for await` loop
- Webhook signature checking that does not need a Node build

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Configuring the client](#configuring-the-client)
- [Sending mail](#sending-mail)
- [Sending later](#sending-later)
- [Templates](#templates)
- [Test keys](#test-keys)
- [Reading mail](#reading-mail)
- [Mailboxes and domains](#mailboxes-and-domains)
- [Labels, contacts and blocked addresses](#labels-contacts-and-blocked-addresses)
- [Statistics](#statistics)
- [Webhooks](#webhooks)
- [Receiving webhooks](#receiving-webhooks)
- [Pagination](#pagination)
- [Errors](#errors)
- [Idempotency](#idempotency)
- [Rate limits](#rate-limits)
- [Scopes and reach](#scopes-and-reach)
- [Escape hatch](#escape-hatch)
- [Every endpoint](#every-endpoint)

---

## Install

```bash
npm install @shahriyardx/mailroom
# pnpm add @shahriyardx/mailroom
# yarn add @shahriyardx/mailroom
# bun add @shahriyardx/mailroom
```

Node 18 or newer. Nothing to polyfill.

## Quick start

Make a key in your instance under **Settings → API keys**. It is shown once.

```ts
import { Mailroom } from "@shahriyardx/mailroom";

const mail = new Mailroom({
  apiKey: process.env.MAILROOM_API_KEY,
  baseUrl: "https://mail.example.com",
});

// What is this key, and what may it do?
const me = await mail.me();
console.log(me.name, me.scopes, me.reach);

await mail.emails.send({
  from: "receipts@example.com",
  to: "customer@example.net",
  subject: "Your receipt",
  html: "<p>Thanks for your order.</p>",
});
```

`mail.me()` is the call to make first when something is not working: it tells a missing scope apart from a wrong URL in one line.

CommonJS works the same way:

```js
const { Mailroom } = require("@shahriyardx/mailroom");
```

## Configuring the client

```ts
const mail = new Mailroom({
  apiKey: process.env.MAILROOM_API_KEY, // default: process.env.MAILROOM_API_KEY
  baseUrl: "https://mail.example.com",  // default: process.env.MAILROOM_BASE_URL
  timeout: 30_000,                      // ms to wait for a reply
  maxRetries: 2,                        // extra tries after a 429, 5xx or dropped socket
  headers: { "X-Trace-Id": "…" },       // sent on every call
  fetch: myFetch,                       // your own fetch, for tests or a proxy agent
});
```

With `MAILROOM_API_KEY` and `MAILROOM_BASE_URL` set, `new Mailroom()` on its own is enough.

`baseUrl` is your instance's address. The `/api/v1` suffix is added for you, so `https://mail.example.com` and `https://mail.example.com/api/v1` both work.

**Retries.** A call is repeated only when repeating it is safe: every `GET`, and any `POST` sent with an [idempotency key](#idempotency). Waits are exponential with jitter, and a `Retry-After` header is obeyed when the server sends one.

## Sending mail

```ts
const sent = await mail.emails.send({
  from: "Support <support@example.com>",
  to: ["a@example.net", "b@example.net"],
  cc: "manager@example.net",
  bcc: "archive@example.com",
  reply_to: "noreply@example.com",
  subject: "Your order shipped",
  html: "<h1>On its way</h1>",
  text: "On its way",
  headers: { "X-Order-Id": "1234" },
  attachments: [
    {
      filename: "invoice.pdf",
      content: pdfBuffer.toString("base64"),
      content_type: "application/pdf",
    },
  ],
});

console.log(sent.id, sent.ses_message_id, sent.thread_id);
```

`from` must be an address on a domain your account has verified. `to`, `cc` and `bcc` take a string or an array, and `Name <address>` is understood. Attachment `content` is base64; a `data:` prefix is stripped for you. At most 20 files, and 30 MB for the whole request.

### Many at once

```ts
const result = await mail.emails.sendBatch([
  { from: "news@example.com", to: "a@example.net", subject: "Hi", text: "…" },
  { from: "news@example.com", to: "b@example.net", subject: "Hi", text: "…" },
]);

console.log(result.sent, result.failed);
for (const item of result.data) {
  if (!item.ok) console.error(item.index, item.error);
}
```

Up to 100 messages. Every one is attempted, and one bad address does not throw the rest away.

### What was sent

```ts
const page = await mail.emails.list({
  status: ["bounced", "complained"],
  since: new Date(Date.now() - 7 * 24 * 3600 * 1000),
  limit: 50,
});

const detail = await mail.emails.get(page.data[0].id);
console.log(detail.status, detail.events, detail.attachments);
```

`emails.get()` also takes an SES message id, which is what a bounce report or a webhook hands you.

### When SES cannot take it

A send that SES refuses for a reason that will still be true in an hour — an unverified identity, a bad address, a suspended account — throws. Anything else, from throttling to a dropped socket, is held in a queue and retried with a widening gap between attempts, and `sent.status` says so:

```ts
const sent = await mail.emails.send({ … });

if (sent.status === "queued") {
  // Accepted, not yet handed over. It will keep trying.
}
```

You do not have to do anything about it. The message is in Sent, marked `queued`, and goes out on its own; `email.sent` fires when it does, and `email.failed` if the attempts run out.

## Sending later

```ts
const sent = await mail.emails.send({
  from: "reminders@example.com",
  to: "customer@example.net",
  subject: "Your appointment tomorrow",
  text: "See you at 10.",
  scheduled_at: "in 2 hours",
});

console.log(sent.status);        // "scheduled"
console.log(sent.scheduled_at);  // "2026-09-21T16:00:00.000Z"
```

`scheduled_at` takes a `Date`, an ISO 8601 timestamp, a Unix time in seconds or milliseconds, or a short relative form: `"in 30 minutes"`, `"in 2 hours"`, `"in 1 day"`. A time that has already passed sends now. At most 30 days ahead.

While it waits you can move it or call it off:

```ts
await mail.emails.reschedule(sent.id, new Date("2026-10-01T09:00:00Z"));
await mail.emails.cancel(sent.id);
```

Both throw `ConflictError` once the message has been picked up for sending — at that point it is on its way, and saying otherwise would be a lie you would go on to build on. The same two work on a message that is `queued` because SES was busy.

## Templates

Save the wording once, send it by name. Changing a receipt then needs no deploy of whatever service sends it.

```ts
const receipt = await mail.templates.create({
  name: "Receipt",
  subject: "Your receipt, {{ name }}",
  html: "<p>Hello {{ name }}, you paid {{ amount }}.</p>",
});

await mail.emails.send({
  from: "receipts@example.com",
  to: "customer@example.net",
  template: receipt.id,
  data: { name: "Ada", amount: "£10" },
});
```

The template language is deliberately not one:

| | |
| --- | --- |
| `{{ name }}` | the value, with HTML escaped |
| `{{{ body }}}` | the value as it is, for markup you meant |
| `{{ user.name }}` | a path into a nested object |

That is all of it — no loops, no conditionals, no function calls. A template that needs logic has quietly become code, and code belongs in your service where it can be reviewed and tested.

Two things worth knowing. A value you did not send is a `ValidationError` naming what is missing, not an empty string: `"Hi ,"` arriving at a customer is worse than an error, and an empty string cannot be told later from a value that really was empty. And `{{ }}` escapes what it inserts, so a name from a signup form cannot write tags into mail sent under your domain — use `{{{ }}}` only for markup you produced yourself.

`subject` given alongside a template wins, so a one-off variation needs no second template. A template is sent by its id, which never changes. `template_id` works wherever `template` does.

```ts
const template = await mail.templates.get(receipt.id);
console.log(template.variables); // ["name", "amount"]
```

## Test keys

A key made in test mode runs every check a live one runs — the mailbox, the blocked list, the template, building the MIME, the webhooks — and stops one step short of handing anything to SES. Nothing leaves the building, nothing costs anything, and nothing counts against your sending quota.

Test keys read `mk_test_…` rather than `mk_live_…`, so one that reached production config is visible rather than silent.

```ts
const me = await mail.me();
if (me.mode === "test") console.log("nothing sent from here will arrive");
```

Since nothing reaches SES, no event will ever arrive to say what became of the message. The recipient decides instead:

| Recipient | What the message is made to look like |
| --- | --- |
| `bounce@…`, `bounced@…` | bounced |
| `complaint@…`, `complained@…` | marked as spam |
| `delay@…` | still being tried |
| anything else | delivered |

Your webhook endpoint hears `email.sent` and then the matching event, in the same shape SES would have produced, with `simulated: true` added. That is the point: a receiver you test against this needs no special case.

Listings and statistics show the side the key is on, and either can ask for the other:

```ts
await mail.emails.list();                 // this key's side
await mail.emails.list({ test: true });   // the test side
await mail.emails.list({ test: false });  // the live side
await mail.emails.list({ test: "all" });  // both
```

Statistics are the reason this exists — a bounce rate must never count a bounce somebody asked for.

Note that this is a view, not an access boundary. Test mode governs *sending*: a test key cannot put a message in front of a real person. What it may read is decided by its scopes and reach like any other key, so narrow those as you would for any key you did not fully trust.

## Reading mail

Inbound mail lives in **threads**. A thread is the conversation; a message is one item in it.

```ts
const inbox = await mail.threads.list({ folder: "inbox", unread: true, limit: 20 });

for (const thread of inbox.data) {
  console.log(thread.subject, thread.unread_count, thread.participants);
}
```

Filters: `folder`, `label` / `label_id`, `q` (full text), `unread`, `starred`, `has_attachments`, `participant`, `subject`, `since`, `until`, and `mailbox_id` / `mailbox` / `domain` to narrow to part of the account.

```ts
// One conversation, with every message, body and file.
const thread = await mail.threads.get(id);
for (const message of thread.messages ?? []) {
  console.log(message.from.address, message.subject, message.text);
}

// Move, read, star and label in one call.
await mail.threads.update(id, {
  folder: "archive",
  is_read: true,
  add_labels: ["Receipts"],       // by name or by id
  remove_labels: ["Needs reply"],
});

// Answer it. Recipients, subject and threading headers come off the last message.
await mail.threads.reply(id, {
  text: "Thanks — sorted.",
  reply_all: true,
  quote: true,
});

// To the trash, and out of it for good on a second call.
await mail.threads.delete(id);
await mail.threads.delete(id, { permanent: true });
```

### Messages on their own

```ts
const unread = await mail.messages.list({ direction: "inbound", unread: true, include_body: true });
await mail.messages.update(id, { is_read: true, is_starred: true });

// The message exactly as it arrived, for a MIME parser or an audit.
const eml = await mail.messages.raw(id); // Uint8Array of message/rfc822
```

Only inbound mail has a raw copy; outbound mail is assembled at send time.

### Attachments

```ts
const file = await mail.attachments.get(attachmentId);
console.log(file.filename, file.size_bytes, file.download_url); // link good for 5 minutes

const bytes = await mail.attachments.download(attachmentId);    // Uint8Array
```

Use `download_url` for anything large or headed to a browser — it goes straight to storage and does not spend your rate limit.

## Mailboxes and domains

```ts
const boxes = await mail.mailboxes.list();
await mail.mailboxes.create({ address: "billing@example.com", display_name: "Billing" });
await mail.mailboxes.update(id, { signature: "— Billing" });

// Deleting a mailbox deletes its mail, so the flag is required.
await mail.mailboxes.delete(id, { confirm: true });
```

```ts
const domain = await mail.domains.create("example.com");
for (const record of domain.records) {
  console.log(record.kind, record.name, record.value, record.purpose);
}

// After publishing the DNS, poll until it is ready.
const checked = await mail.domains.verify("example.com");
console.log(checked.status, checked.sending_enabled, checked.spf_verified);
```

`domains.get`, `verify` and `delete` take the name as well as the id.

## Labels, contacts and blocked addresses

```ts
const label = await mail.labels.create({ name: "Receipts", color: "#64748b" });
await mail.labels.update("Receipts", { color: "#0ea5e9" }); // by name works too
await mail.labels.delete(label.id);                          // threads it was on stay

const people = await mail.contacts.list({ q: "example.net", order: "frequent" });

const blocked = await mail.suppressions.list();
await mail.suppressions.create({ address: "hard-bounce@example.net", reason: "Manual" });
await mail.suppressions.delete("hard-bounce@example.net"); // by id or by address
```

Addresses land in suppressions on their own when mail bounces or is reported as spam. Taking one back out risks your own sending reputation.

## Statistics

```ts
const stats = await mail.stats.get({ days: 30 });

console.log(stats.sending.sent, stats.sending.bounce_rate, stats.sending.open_rate);
for (const day of stats.days) console.log(day.day, day.sent, day.delivered);
```

`bounce_rate` and `complaint_rate` are shares of sent mail out of 100. SES starts warning above 5 and 0.1. `days` has a row for every day in the window, quiet ones included, so a chart needs one call rather than one per point.

## Webhooks

```ts
const hook = await mail.webhooks.create({
  url: "https://api.example.com/hooks/mailroom",
  events: ["mail.received", "email.bounced"], // or ["*"] for everything, now and later
  description: "Production receiver",
});

// Shown once, here and never again. Store it now.
console.log(hook.secret);
```

An endpoint hears about the whole account unless it is scoped. Pass
`domain_id` for every address on one domain (including ones added later), or
`mailbox_id` for a single address. One or the other, never both.

```ts
await mail.webhooks.create({
  url: "https://api.example.com/hooks/acme",
  events: ["*"],
  domain_id: "dom_…", // everything sent from or to @acme.com
});
```

The URL must be `https` and must not point inside a private network.

```ts
await mail.webhooks.list();
await mail.webhooks.update(id, { enabled: true });
await mail.webhooks.update(id, { rotate_secret: true }); // reply carries the new secret, once
await mail.webhooks.disable(id);                         // stop delivery, keep the history
await mail.webhooks.delete(id);                          // endpoint and history together

// Send a test event and wait for the answer. A failure is a result, not a throw.
const ping = await mail.webhooks.ping(id);
console.log(ping.succeeded, ping.status_code, ping.response_body);

// What has been attempted, and a replay for an endpoint that was down.
for await (const delivery of mail.webhooks.listAllDeliveries({ succeeded: false })) {
  await mail.webhooks.replay(delivery.id);
}
```

### The events

| Event | When |
| --- | --- |
| `mail.received` | A message arrived in a mailbox |
| `email.sent` | A message was handed to SES |
| `email.delivered` | The receiving server accepted it |
| `email.bounced` | It came back |
| `email.complained` | Somebody marked it as spam |
| `email.opened` | The tracking image was loaded |
| `email.delayed` | SES is still trying |
| `email.rejected` | SES refused to send it |
| `email.failed` | It could not be handed to SES, and no attempts are left |
| `email.canceled` | A scheduled message was called off before it went out |
| `thread.updated` | A thread was moved, read, starred or labelled through the API |

Delivery is retried four times over about forty seconds. A `4xx` other than 408 and 429 is taken as a final no. After 20 failures in a row the endpoint is switched off, and turning it back on clears the count.

## Receiving webhooks

Every call carries three headers:

| Header | What |
| --- | --- |
| `X-Mailroom-Event` | The event name |
| `X-Mailroom-Signature` | `t=<unix seconds>,v1=<hex>` |
| `X-Mailroom-Webhook-Id` | Which endpoint it came from |

The signature is an HMAC-SHA256 over `` `${t}.${rawBody}` `` keyed with the endpoint's secret.

> **Check the raw body.** `JSON.parse` followed by `JSON.stringify` does not always give back the same bytes, and the signature is over bytes. Read the body as text or as a buffer first, verify, and parse after.

`constructWebhookEvent` verifies and parses in one step, and throws if the signature does not match — so a handler that forgets to check a return value still cannot be fooled.

**Next.js route handler**

```ts
import { constructWebhookEvent } from "@shahriyardx/mailroom";

export async function POST(request: Request) {
  const raw = await request.text();

  try {
    const event = await constructWebhookEvent({
      secret: process.env.MAILROOM_WEBHOOK_SECRET!,
      payload: raw,
      signature: request.headers.get("x-mailroom-signature"),
    });

    switch (event.type) {
      case "mail.received":
        console.log("new mail", event.data.email.subject, event.data.email.from.address);
        break;
      case "email.bounced":
        console.log("bounced", event.data.recipients, event.data.detail);
        break;
    }

    // Answer quickly. Do the slow part after, or on a queue.
    return Response.json({ ok: true });
  } catch {
    return new Response("bad signature", { status: 400 });
  }
}
```

**Express**

```js
const express = require("express");
const { constructWebhookEvent } = require("@shahriyardx/mailroom");

const app = express();

app.post(
  "/hooks/mailroom",
  express.raw({ type: "application/json" }), // the raw body, not express.json()
  async (req, res) => {
    try {
      const event = await constructWebhookEvent({
        secret: process.env.MAILROOM_WEBHOOK_SECRET,
        payload: req.body,
        signature: req.get("x-mailroom-signature"),
      });
      console.log(event.type, event.id);
      res.json({ ok: true });
    } catch {
      res.status(400).send("bad signature");
    }
  },
);
```

`verifyWebhook` is the same check as a plain boolean, if you would rather parse yourself:

```ts
const ok = await verifyWebhook({ secret, payload: raw, signature, toleranceSeconds: 300 });
```

The envelope is the same for every event:

```json
{
  "id": "whd_…",
  "object": "event",
  "type": "mail.received",
  "created_at": "2026-01-02T03:04:05.000Z",
  "data": { "email": { "id": "msg_…", "subject": "Hello", "from": { "name": null, "address": "a@b.c" } } }
}
```

`id` is also the delivery id, so a repeat — a retry after your endpoint timed out, or a replay — can be recognised and ignored.

### Testing your handler

`signWebhookPayload` signs a body the way the server does, so you can post a realistic call at your own handler without waiting for a real event.

```ts
import { signWebhookPayload } from "@shahriyardx/mailroom";

const body = JSON.stringify({
  id: "whd_test",
  object: "event",
  type: "mail.received",
  created_at: new Date().toISOString(),
  data: { email: { id: "msg_test", subject: "Hello", from: { name: null, address: "a@b.c" } } },
});
const signature = await signWebhookPayload("whsec_…", body);

await fetch("http://localhost:3000/hooks/mailroom", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Mailroom-Signature": signature },
  body,
});
```

## Pagination

Every list returns one page:

```ts
const page = await mail.threads.list({ limit: 50 });
page.data;        // the rows
page.has_more;    // is there another page
page.next_cursor; // opaque — hand it back untouched
```

```ts
let cursor: string | undefined;
do {
  const page = await mail.threads.list({ cursor, limit: 100 });
  handle(page.data);
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

Or let the SDK hold the cursor:

```ts
for await (const thread of mail.threads.listAll({ folder: "inbox" })) {
  console.log(thread.subject);
  if (done) break; // stopping early stops fetching
}
```

`listAll` is on `emails`, `threads`, `messages`, `contacts`, `suppressions` and `webhooks.listAllDeliveries`. `limit` is at most 100, and 25 by default. Lists that cannot grow without bound — mailboxes, domains, labels, webhooks — come back in one page.

## Errors

Anything other than a 2xx throws. Every error extends `MailroomError` and carries `status`, `code`, `message` and the decoded `body`.

```ts
import { isMailroomError, NotFoundError, RateLimitError } from "@shahriyardx/mailroom";

try {
  await mail.emails.send({ from: "nobody@unverified.example", to: "a@b.c" });
} catch (error) {
  if (error instanceof RateLimitError) {
    await sleep((error.retryAfter ?? 5) * 1000);
  } else if (error instanceof NotFoundError) {
    // gone, or outside this key's reach — the two look the same on purpose
  } else if (isMailroomError(error)) {
    console.error(error.code, error.status, error.message, error.param);
  } else {
    throw error;
  }
}
```

| Class | Status | `code` | Usually means |
| --- | --- | --- | --- |
| `AuthenticationError` | 401 | `unauthorized` | Key missing, mistyped, or revoked |
| `PermissionError` | 403 | `forbidden` | Missing a scope (`error.requiredScope`), or outside the key's reach |
| `NotFoundError` | 404 | `not_found` | No such object, or none this key may see |
| `ConflictError` | 409 | `conflict` | Already exists, or a destructive call needs its confirmation flag |
| `PayloadTooLargeError` | 413 | `payload_too_large` | Over 30 MB — usually an attachment |
| `ValidationError` | 422 | `invalid_request` | A bad field; `error.param` names it |
| `RateLimitError` | 429 | `rate_limited` | Too many calls this minute; `error.retryAfter` in seconds |
| `ServerError` | 5xx | `server_error` | The instance failed. Safe to retry |
| `TimeoutError` | — | `timeout` | No reply within `timeout` |
| `ConnectionError` | — | `connection_error` | DNS, TLS, a dropped socket |

`WebhookVerificationError` is separate: it comes from `constructWebhookEvent`, not from a call.

## Idempotency

Pass `idempotencyKey` on a send, and a repeat of the same call returns the first reply instead of sending twice. Keys are remembered for 24 hours, per endpoint.

```ts
await mail.emails.send(
  { from: "receipts@example.com", to: "a@b.c", subject: "Receipt #1234" },
  { idempotencyKey: `receipt-1234` },
);
```

Reusing a key with a **different** body is a `409` — that is the guard working, not a bug. It also switches automatic retries on for that call, since repeating it is now safe.

## Rate limits

A key allows 300 calls a minute unless it says otherwise. Every reply carries the window, and the client keeps the last one:

```ts
await mail.me();
console.log(mail.rateLimit); // { limit, remaining, resetAt: Date }
```

Going over throws `RateLimitError` with `retryAfter` in seconds. With `maxRetries` above 0, `GET`s and keyed sends wait and try again on their own.

## Scopes and reach

A key carries two limits, and both are checked.

**Scopes** say which kinds of call are allowed: `emails:send`, `mail:read`, `mail:write`, `mailboxes:*`, `domains:*`, `labels:*`, `contacts:read`, `suppressions:*`, `webhooks:*`, `stats:read`. Writing implies reading. `*` is everything.

**Reach** says which mail those calls may touch: the whole account, some whole domains, or some named addresses. A key that reaches one department cannot read another's inbox, cannot point a webhook at mail it may not read, and cannot list account-wide contacts.

```ts
const me = await mail.me();
me.scopes;             // ["*"] or a list of names
me.reach.unrestricted; // true when the key reaches every mailbox
me.reach.domains;      // whole domains it holds
me.reach.mailboxes;    // named addresses it holds
```

Give each integration the narrowest key that does its job. A missing scope is a `403` with `requiredScope` set; something out of reach is a `404`, so a key cannot learn what exists by asking.

## Escape hatch

For an endpoint this package has not wrapped yet:

```ts
const custom = await mail.http.request<{ ok: boolean }>({
  method: "POST",
  path: "/some/new/endpoint",
  query: { limit: 10 },
  body: { hello: "world" },
});
```

The key, the base URL, the timeout, the retries and the error mapping all still apply.

## Every endpoint

| Method | Endpoint | Scope |
| --- | --- | --- |
| `mail.me()` | `GET /me` | any key |
| `mail.emails.send()` | `POST /emails` | `emails:send` |
| `mail.emails.sendBatch()` | `POST /emails/batch` | `emails:send` |
| `mail.emails.list()` / `listAll()` | `GET /emails` | `emails:read` |
| `mail.emails.get()` | `GET /emails/:id` | `emails:read` |
| `mail.emails.cancel()` | `POST /emails/:id/cancel` | `emails:send` |
| `mail.emails.reschedule()` | `PATCH /emails/:id` | `emails:send` |
| `mail.threads.list()` / `listAll()` | `GET /threads` | `mail:read` |
| `mail.threads.get()` | `GET /threads/:id` | `mail:read` |
| `mail.threads.update()` | `PATCH /threads/:id` | `mail:write` |
| `mail.threads.delete()` | `DELETE /threads/:id` | `mail:write` |
| `mail.threads.reply()` | `POST /threads/:id/reply` | `mail:write` |
| `mail.messages.list()` / `listAll()` | `GET /messages` | `mail:read` |
| `mail.messages.get()` | `GET /messages/:id` | `mail:read` |
| `mail.messages.update()` | `PATCH /messages/:id` | `mail:write` |
| `mail.messages.raw()` | `GET /messages/:id/raw` | `mail:read` |
| `mail.attachments.get()` / `download()` | `GET /attachments/:id` | `mail:read` |
| `mail.mailboxes.list()` | `GET /mailboxes` | `mailboxes:read` |
| `mail.mailboxes.get()` | `GET /mailboxes/:id` | `mailboxes:read` |
| `mail.mailboxes.create()` | `POST /mailboxes` | `mailboxes:write` |
| `mail.mailboxes.update()` | `PATCH /mailboxes/:id` | `mailboxes:write` |
| `mail.mailboxes.delete()` | `DELETE /mailboxes/:id` | `mailboxes:write` |
| `mail.domains.list()` | `GET /domains` | `domains:read` |
| `mail.domains.get()` | `GET /domains/:id` | `domains:read` |
| `mail.domains.create()` | `POST /domains` | `domains:write` |
| `mail.domains.verify()` | `POST /domains/:id/verify` | `domains:write` |
| `mail.domains.delete()` | `DELETE /domains/:id` | `domains:write` |
| `mail.labels.list()` | `GET /labels` | `labels:read` |
| `mail.labels.get()` | `GET /labels/:id` | `labels:read` |
| `mail.labels.create()` | `POST /labels` | `labels:write` |
| `mail.labels.update()` | `PATCH /labels/:id` | `labels:write` |
| `mail.labels.delete()` | `DELETE /labels/:id` | `labels:write` |
| `mail.contacts.list()` / `listAll()` | `GET /contacts` | `contacts:read` |
| `mail.templates.list()` / `listAll()` | `GET /templates` | `templates:read` |
| `mail.templates.get()` | `GET /templates/:id` | `templates:read` |
| `mail.templates.create()` | `POST /templates` | `templates:write` |
| `mail.templates.update()` | `PATCH /templates/:id` | `templates:write` |
| `mail.templates.delete()` | `DELETE /templates/:id` | `templates:write` |
| `mail.suppressions.list()` / `listAll()` | `GET /suppressions` | `suppressions:read` |
| `mail.suppressions.create()` | `POST /suppressions` | `suppressions:write` |
| `mail.suppressions.delete()` | `DELETE /suppressions/:id` | `suppressions:write` |
| `mail.webhooks.list()` | `GET /webhooks` | `webhooks:read` |
| `mail.webhooks.get()` | `GET /webhooks/:id` | `webhooks:read` |
| `mail.webhooks.create()` | `POST /webhooks` | `webhooks:write` |
| `mail.webhooks.update()` | `PATCH /webhooks/:id` | `webhooks:write` |
| `mail.webhooks.delete()` / `disable()` | `DELETE /webhooks/:id` | `webhooks:write` |
| `mail.webhooks.ping()` | `POST /webhooks/:id/ping` | `webhooks:write` |
| `mail.webhooks.listDeliveries()` | `GET /webhook-deliveries` | `webhooks:read` |
| `mail.webhooks.replay()` | `POST /webhook-deliveries/:id/replay` | `webhooks:write` |
| `mail.stats.get()` | `GET /stats` | `stats:read` |

## Development

```bash
pnpm install
pnpm --filter @shahriyardx/mailroom run typecheck
pnpm --filter @shahriyardx/mailroom run build
pnpm --filter @shahriyardx/mailroom run test
```

The SDK lives in the same repository as the server it talks to, so the two cannot drift apart.

## License

MIT
