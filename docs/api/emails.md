# Emails

Sending, and looking at what was sent.

## Send one

```
POST /api/v1/emails
```

Scope: `emails:send`

```sh
curl -X POST https://mail.yourdomain.com/api/v1/emails \
  -H "Authorization: Bearer mk_live_..." \
  -H "Idempotency-Key: receipt-4821" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Receipts <receipts@example.com>",
    "to": ["customer@example.net"],
    "cc": "manager@example.net",
    "reply_to": "support@example.com",
    "subject": "Your receipt",
    "html": "<p>Thanks for your order.</p>",
    "text": "Thanks for your order.",
    "headers": { "X-Order-Id": "4821" }
  }'
```

| Field | | |
| --- | --- | --- |
| `from` | **required** | An address on a verified domain. `Name <a@b.c>` works |
| `to` | **required** | A string or an array |
| `cc`, `bcc` | | A string or an array |
| `reply_to` | | One address |
| `subject` | | Defaults to empty |
| `html`, `text` | | Send either, or both |
| `headers` | | Extra headers, as a flat object |
| `template`, `template_id` | | A [saved template](/api/templates) to send instead of a body |
| `data` | | The values that template asks for |
| `scheduled_at` | | Hold it until then. See [Sending later](#sending-later) |
| `thread_id` | | Add this message to an existing thread |
| `in_reply_to`, `references` | | Threading headers, if you are building them yourself |
| `attachments` | | At most 20. See below |

Returns `202`:

```json
{
  "id": "msg_…",
  "message_id": "<…@example.com>",
  "ses_message_id": "0100018f…",
  "thread_id": "thr_…",
  "from": "receipts@example.com",
  "to": ["customer@example.net"],
  "subject": "Your receipt",
  "status": "sent",
  "scheduled_at": null,
  "test": false
}
```

`202`, not `200`: SES has accepted it, and whether it was *delivered* comes
later — as a `status` on the message, and as an
[`email.delivered` webhook](/webhooks/events).

### What `status` means

| | |
| --- | --- |
| `sent` | Handed to SES. The usual answer |
| `scheduled` | Held until `scheduled_at` |
| `queued` | SES could not take it right now. It will keep trying |
| `delivered`, `bounced`, … | A [test key](/guide/test-mode) sent it, and the outcome was simulated |

`queued` is not an error and needs nothing from you. A send that SES refuses
for a reason that will still be true in an hour — an unverified identity, a
malformed address, a suspended account — returns an error instead and records
nothing. Anything else, from throttling to a dropped socket, goes into a queue
and is retried with a widening gap between attempts, up to eight times over
about three quarters of an hour. `email.sent` fires when it goes out, and
`email.failed` if the attempts run out.

## Sending later

Set `scheduled_at` and the message is written to Sent straight away, marked
`queued` with a time on it, and handed over when that time comes.

```sh
curl -X POST https://mail.yourdomain.com/api/v1/emails \
  -H "Authorization: Bearer mk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "reminders@example.com",
    "to": "customer@example.net",
    "subject": "Your appointment tomorrow",
    "text": "See you at 10.",
    "scheduled_at": "in 2 hours"
  }'
```

Any of these forms works:

| | |
| --- | --- |
| `"2026-10-01T09:00:00Z"` | ISO 8601 |
| `1790000000` | Unix time, seconds or milliseconds |
| `"in 30 minutes"` | `second`, `minute`, `hour` or `day`, singular or plural |

A time that has already passed sends now. At most 30 days ahead.

### Call one off

```
POST /api/v1/emails/:id/cancel
```

Scope: `emails:send`

Works on anything still waiting — scheduled, or queued because SES was busy.
Returns the message with `status: "canceled"`.

Answers `409` once a worker has picked the message up. At that point it is on
its way to SES and there is nothing left to stop, and saying otherwise would
be a lie you would go on to build on.

### Move one

```
PATCH /api/v1/emails/:id
```

Scope: `emails:send`

```json
{ "scheduled_at": "2026-10-01T09:00:00Z" }
```

Same forms, and the same `409` once it has been picked up.

### Attachments

```json
{
  "attachments": [
    {
      "filename": "invoice.pdf",
      "content": "JVBERi0xLjQKJ…",
      "content_type": "application/pdf"
    },
    {
      "filename": "logo.png",
      "content": "iVBORw0KGgo…",
      "content_id": "logo"
    }
  ]
}
```

`content` is base64; a `data:` prefix is stripped for you. Setting
`content_id` embeds the file instead of attaching it, so `<img src="cid:logo">`
in your HTML shows it inline.

## Send a batch

```
POST /api/v1/emails/batch
```

Scope: `emails:send`

```json
[
  { "from": "news@example.com", "to": "a@example.net", "subject": "Hi", "text": "…" },
  { "from": "news@example.com", "to": "b@example.net", "subject": "Hi", "text": "…" }
]
```

An object with an `emails` array works too.

Up to **100** messages. Every one is attempted, in order, one at a time — SES
meters sends per second, and firing a hundred at once is the fastest way to be
throttled for all of them.

`202` when all were accepted, `207` when some were not:

```json
{
  "object": "batch",
  "sent": 1,
  "failed": 1,
  "data": [
    { "index": 0, "ok": true, "id": "msg_…", "thread_id": "thr_…" },
    { "index": 1, "ok": false, "error": "This API key cannot send as x@y.z", "status": 403 }
  ]
}
```

So you can branch on the status without counting.

## List what was sent

```
GET /api/v1/emails
```

Scope: `emails:read`

| Filter | |
| --- | --- |
| `status` | One or several of `queued`, `sent`, `delivered`, `bounced`, `complained`, `rejected`, `delayed`, `failed`, `canceled`. Comma-separated |
| `from` | Exact sender address |
| `to` | Exact recipient address |
| `subject` | Substring |
| `q` | Full text over subject and body |
| `opened` | `true` or `false` |
| `api_key_id` | Only mail sent by one key |
| `since`, `until` | ISO dates |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |
| `test` | `true` for the test side, `all` for both. See [Test keys](/guide/test-mode) |
| `limit`, `cursor` | See [Pagination](/api/pagination) |

```sh
curl "https://mail.yourdomain.com/api/v1/emails?status=bounced,complained&since=2026-09-01" \
  -H "Authorization: Bearer mk_live_..."
```

Drafts are excluded: they are outbound, but they have not been sent. So is
mail written by a [test key](/guide/test-mode), unless you ask for it.

Everything still waiting is `status=queued`; the ones with a `scheduled_at`
are waiting for the clock, and the rest are waiting for SES.

## Read one

```
GET /api/v1/emails/:id
```

Scope: `emails:read`

Returns the message with its body, its files, and **every SES event seen for
it so far**:

```json
{
  "object": "message",
  "id": "msg_…",
  "status": "bounced",
  "error": "smtp; 550 5.1.1 user unknown",
  "opened_at": null,
  "open_count": 0,
  "text": "…",
  "html": "…",
  "attachments": [ … ],
  "events": [
    { "object": "event", "type": "send", "occurred_at": "…" },
    { "object": "event", "type": "bounce", "recipient": "a@b.c", "detail": "…", "occurred_at": "…" }
  ]
}
```

The id from a send works, and so does the **SES message id** — which is what a
bounce report or a webhook hands you.

## A note on opens

`opened_at` means the tracking image was loaded. Apple Mail and Gmail fetch
images through their own servers, so an open is evidence of **delivery**, not
proof anybody read it.
