# The events

Eleven, plus a test. Subscribe with a list of names, or `["*"]` for everything
including events added later.

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

`webhook.test` is sent only by a [ping](/api/webhooks#test). It is deliberately
**not** in the subscribable list, because sending a test under a real event
name would have a receiver record something that never happened.

::: warning The email.* events need a configuration set
Everything except `email.sent` comes from SES's own reporting. Without
`SES_CONFIGURATION_SET` set, SES never reports, and those events never fire.
See [Sending domains](/guide/domains#delivery-reporting).

`email.sent` fires from the app itself the moment SES accepts a message, so it
arrives either way, and so do `email.failed` and `email.canceled`, which are
about this app's own [send queue](/guide/queue) rather than about SES.
:::

::: tip A test key produces them without sending anything
A [test key](/guide/test-mode) fires `email.sent` and then a simulated
delivery or bounce, in the same shape as the real thing with `simulated: true`
added. It is the way to try a receiver end to end without a configuration set,
and without bouncing a real message.
:::

## mail.received

```json
{
  "id": "whd_…",
  "object": "event",
  "type": "mail.received",
  "created_at": "2026-09-21T09:58:02.000Z",
  "data": {
    "email": {
      "id": "msg_…",
      "thread_id": "thr_…",
      "mailbox_id": "mbx_…",
      "mailbox": "support@example.com",
      "message_id": "<CAO…@mail.gmail.com>",
      "from": { "name": "Ada", "address": "ada@example.net" },
      "to": [{ "name": null, "address": "support@example.com" }],
      "delivered_to": "support@example.com",
      "subject": "Refund for order 4821",
      "snippet": "Hi — I'd like to return…",
      "folder": "inbox",
      "has_attachments": true,
      "spf": "pass",
      "dkim": "pass",
      "dmarc": "pass",
      "spam_score": 0,
      "mailed_by": "us-west-2-amazonses.npmjs.com",
      "signed_by": "npmjs.com",
      "tls": "TLS1.3",
      "received_at": "2026-09-21T09:58:01.000Z"
    }
  }
}
```

`delivered_to` is the address this copy actually arrived at, which differs
from `mailbox` when a catch-all caught it.

The body is **not** included — it can be megabytes. Fetch it with
[`GET /messages/:id`](/api/messages#read-one) when you need it.

## email.sent

```json
{
  "type": "email.sent",
  "data": {
    "email": {
      "id": "msg_…",
      "thread_id": "thr_…",
      "mailbox": "receipts@example.com",
      "ses_message_id": "0100018f…",
      "message_id": "<…@example.com>",
      "from": "receipts@example.com",
      "to": [{ "name": null, "address": "customer@example.net" }],
      "cc": [],
      "subject": "Your receipt",
      "status": "sent",
      "api_key_id": "key_…",
      "sent_at": "2026-09-21T09:58:00.000Z"
    }
  }
}
```

`api_key_id` is set when the message came in through the API, so you can tell
a script's mail from a person's.

## The delivery events

`email.delivered`, `email.bounced`, `email.complained`, `email.opened`,
`email.delayed` and `email.rejected` all carry the same shape:

```json
{
  "type": "email.bounced",
  "data": {
    "email": {
      "id": "msg_…",
      "thread_id": "thr_…",
      "mailbox": "receipts@example.com",
      "ses_message_id": "0100018f…",
      "message_id": "<…@example.com>",
      "from": "receipts@example.com",
      "to": [{ "name": null, "address": "gone@example.net" }],
      "subject": "Your receipt",
      "status": "bounced"
    },
    "recipients": ["gone@example.net"],
    "detail": "smtp; 550 5.1.1 user unknown",
    "occurred_at": "2026-09-21T09:58:40.000Z"
  }
}
```

`recipients` is **which addresses this event was about** — a message to five
people can bounce for one of them, and `to` still lists all five.

A [test key](/guide/test-mode) produces the same shape with `"simulated": true`
alongside `occurred_at`, and `"test": true` on the email. Nothing else differs,
which is the point.

## email.failed and email.canceled

Both are about this app's [send queue](/guide/queue) rather than about SES.

`email.failed` fires when a message could not be handed to SES and the
attempts have run out. It carries the same `email` object as `email.sent`,
plus the last reason:

```json
{
  "type": "email.failed",
  "data": {
    "email": { "id": "msg_…", "status": "failed", "…": "…" },
    "error": "Maximum sending rate exceeded"
  }
}
```

`email.canceled` fires when a scheduled or queued message is called off with
[`POST /emails/:id/cancel`](/api/emails#call-one-off), and carries the `email`
object alone.

## thread.updated

Fires when a thread is changed through
[`PATCH /threads/:id`](/api/threads#change-one) — not when it changes in the
web app, and not when a new message arrives.

```json
{
  "type": "thread.updated",
  "data": { "thread": { "object": "thread", "id": "thr_…", "folders": ["archive"], "…": "…" } }
}
```

`data.thread` is the full thread object as it now is.

## Which endpoints hear what

| The endpoint | Hears |
| --- | --- |
| No `mailbox_id` | Every event on the account |
| A `mailbox_id` | Only events for that mailbox |

An event with no mailbox of its own reaches every endpoint that has no
`mailbox_id`.
