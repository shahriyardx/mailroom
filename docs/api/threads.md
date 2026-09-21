# Threads

A thread is a conversation. Inbound mail lives in threads, and this is the
endpoint that makes an inbox readable from outside the app.

## List

```
GET /api/v1/threads
```

Scope: `mail:read`

| Filter | |
| --- | --- |
| `folder` | `inbox`, `sent`, `drafts`, `archive`, `spam`, `trash`, or `all` |
| `label_id` / `label` | By id or by name |
| `q` | Full text across every message in the thread |
| `unread` | `true` for threads with anything unread |
| `starred`, `has_attachments` | `true` or `false` |
| `participant` | Anybody on the conversation, by address |
| `subject` | Substring |
| `since`, `until` | Against `last_message_at` |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |
| `limit`, `cursor` | See [Pagination](/api/pagination) |

```json
{
  "object": "thread",
  "id": "thr_…",
  "mailbox": "support@example.com",
  "subject": "Refund for order 4821",
  "snippet": "Hi — I'd like to return…",
  "folders": ["inbox"],
  "participants": [{ "name": "Ada", "address": "ada@example.net" }],
  "message_count": 3,
  "unread_count": 1,
  "is_starred": false,
  "has_attachments": true,
  "last_message_at": "2026-09-20T14:03:11.000Z",
  "labels": [{ "object": "label", "id": "lbl_…", "name": "Refunds" }]
}
```

`folders` is a list because a thread can have messages in more than one — a
conversation you replied to sits in both `inbox` and `sent`.

## Read one

```
GET /api/v1/threads/:id
```

Scope: `mail:read`

Returns the thread with **every message in it**, bodies and attachments
included. Add `?include_body=false` for a lighter reply when only the shape
matters.

## Change one

```
PATCH /api/v1/threads/:id
```

Scope: `mail:write`

```json
{
  "folder": "archive",
  "is_read": true,
  "is_starred": false,
  "add_labels": ["Refunds"],
  "remove_labels": ["Needs reply"]
}
```

Every field is optional and only what you send is changed, so archiving and
marking read is one call rather than a read followed by two writes.

Labels may be given **by name or by id**. An unknown one is a `422` and
**nothing is changed** — the labels are resolved before anything is written,
so you never get an error alongside a move that already happened.

Drafts stay where they are when `folder` is set. Moving one into the archive
would lose the only place the composer looks for it.

Firing this also sends a [`thread.updated` webhook](/webhooks/events).

## Reply

```
POST /api/v1/threads/:id/reply
```

Scope: `mail:write`

```json
{ "text": "Refunded — sorry for the trouble.", "reply_all": true }
```

Who it goes to, what it is called, and the headers that keep it threaded are
all read off the last message. Each can be overridden:

| Field | |
| --- | --- |
| `text`, `html` | One is required |
| `reply_all` | Also answer everyone else on the last message |
| `to`, `cc`, `bcc` | Replace the worked-out recipients entirely |
| `subject` | Defaults to `Re: …` |
| `quote` | Append the message being answered. **On by default** |
| `headers`, `attachments` | As on a normal send |

Returns `202` with the same body as a send.

## Delete

```
DELETE /api/v1/threads/:id
```

Scope: `mail:write`

To the trash, and **out of it for good on a second call**. `?permanent=true`
skips the trash.

```json
{ "object": "thread", "id": "thr_…", "deleted": true, "permanent": false }
```
