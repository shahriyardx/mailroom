# Messages and files

Threads are the better way to read a conversation. These endpoints are for
when a program wants **messages themselves** — everything that arrived since a
stamp, everything from one sender, everything unread.

## List

```
GET /api/v1/messages
```

Scope: `mail:read`

| Filter | |
| --- | --- |
| `direction` | `inbound` or `outbound` |
| `folder` | A folder name, or `all` |
| `thread_id` | Everything in one conversation |
| `drafts` | `true` for only drafts, `false` to exclude them |
| `unread`, `starred` | `true` or `false` |
| `from` | Exact sender address |
| `to` | Exact recipient address |
| `subject` | Substring |
| `q` | Full text over subject, body and sender |
| `since`, `until` | Against `received_at` |
| `include_body` | `true` to include `text` and `html`. Off by default |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |
| `limit`, `cursor` | See [Pagination](/api/pagination) |

Bodies are left out by default because they are large and a list of fifty of
them is mostly HTML you did not ask for.

## Read one

```
GET /api/v1/messages/:id
```

Scope: `mail:read`

The message with its body, its files and its events.

```json
{
  "object": "message",
  "id": "msg_…",
  "thread_id": "thr_…",
  "mailbox": "support@example.com",
  "message_id": "<CAO…@mail.gmail.com>",
  "from": { "name": "Ada", "address": "ada@example.net" },
  "to": [{ "name": null, "address": "support@example.com" }],
  "subject": "Refund for order 4821",
  "folder": "inbox",
  "direction": "inbound",
  "is_read": false,
  "spf": "pass",
  "dkim": "pass",
  "dmarc": "pass",
  "spam_score": 0,
  "mailed_by": "mail.example.net",
  "signed_by": "example.net",
  "tls": "TLS1.3",
  "text": "…",
  "html": "…",
  "attachments": [ … ],
  "events": [ … ]
}
```

`spf`, `dkim` and `dmarc` are what the receiving worker saw. Mailroom does not
act on them; it records them so you can.

## Change one

```
PATCH /api/v1/messages/:id
```

Scope: `mail:write`

```json
{ "is_read": true, "is_starred": true }
```

Read and star **one message**, rather than the whole thread. The thread's
counts are recomputed afterwards.

## The original message

```
GET /api/v1/messages/:id/raw
```

Scope: `mail:read`

Returns `message/rfc822` bytes — the message exactly as it arrived. Pipe it
into a MIME parser, re-send it, or keep it for an audit.

```sh
curl "https://mail.yourdomain.com/api/v1/messages/msg_…/raw" \
  -H "Authorization: Bearer mk_live_..." \
  -o message.eml
```

Only **inbound** mail has one. Outbound mail is assembled at send time and its
wire form is not stored, so asking for it returns `404`.

A `404` here can also mean the row outlived the object — a bucket lifecycle
rule, or a restore that did not bring everything back.

## Attachments

```
GET /api/v1/attachments/:id
```

Scope: `mail:read`

```json
{
  "object": "attachment",
  "id": "att_…",
  "message_id": "msg_…",
  "filename": "invoice.pdf",
  "content_type": "application/pdf",
  "size_bytes": 84213,
  "content_id": null,
  "is_inline": false,
  "download_url": "https://…",
  "download_url_expires_in": 300
}
```

`download_url` is a signed link straight to storage, good for **five
minutes**. Use it for anything large or headed to a browser: it does not spend
your rate limit and the bytes never pass through the app.

For a small file, `?download=true` returns the bytes directly and saves a
second request.

An attachment is only reachable **through a message this key may read**.
Staged uploads, which have no message yet, are not reachable at all.
