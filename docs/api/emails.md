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
  "subject": "Your receipt"
}
```

`202`, not `200`: SES has accepted it, and whether it was *delivered* comes
later — as a `status` on the message, and as an
[`email.delivered` webhook](/webhooks/events).

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
| `status` | One or several of `queued`, `sent`, `delivered`, `bounced`, `complained`, `rejected`, `delayed`, `failed`. Comma-separated |
| `from` | Exact sender address |
| `to` | Exact recipient address |
| `subject` | Substring |
| `q` | Full text over subject and body |
| `opened` | `true` or `false` |
| `api_key_id` | Only mail sent by one key |
| `since`, `until` | ISO dates |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |
| `limit`, `cursor` | See [Pagination](/api/pagination) |

```sh
curl "https://mail.yourdomain.com/api/v1/emails?status=bounced,complained&since=2026-09-01" \
  -H "Authorization: Bearer mk_live_..."
```

Drafts are excluded: they are outbound, but they have not been sent.

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
