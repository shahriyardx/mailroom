# Using the API

Everything lives under one base URL and takes one header.

```
https://mail.yourdomain.com/api/v1
Authorization: Bearer mk_live_...
```

Make a key under **Settings → API keys**. See [API keys](/guide/api-keys) for
what the options mean.

## The first call

```sh
curl https://mail.yourdomain.com/api/v1/me \
  -H "Authorization: Bearer mk_live_..."
```

```json
{
  "object": "api_key",
  "id": "key_…",
  "name": "Production",
  "scopes": ["*"],
  "organization": { "id": "org_…", "name": "Acme" },
  "reach": { "unrestricted": true, "domains": [], "mailboxes": [] },
  "reachable_mailboxes": 4,
  "rate_limit_per_minute": 300,
  "api": {
    "version": "v1",
    "base_url": "https://mail.yourdomain.com/api/v1",
    "all_scopes": ["emails:send", "…"],
    "webhook_events": ["mail.received", "…"]
  }
}
```

Make this call first whenever something is not working. It tells a missing
scope apart from a wrong URL in one line, and it needs no scope of its own.

## The shape of a reply

Every object carries an `object` field, so a value can be told apart without
knowing which call returned it.

```json
{ "object": "message", "id": "msg_…", "subject": "Hello" }
```

Every list is the same shape:

```json
{
  "object": "list",
  "data": [ … ],
  "has_more": true,
  "next_cursor": "1767225845000|thr_…"
}
```

See [Pagination](/api/pagination).

Every failure is the same shape:

```json
{ "error": "No such thread", "code": "not_found" }
```

See [Errors](/api/errors).

## Conventions

- **snake_case** in and out. The database is camelCase; the API is not.
- **Timestamps are ISO 8601** strings in UTC.
- **Addresses** are `{ "name": "Ada", "address": "ada@example.com" }` when read,
  and a plain string or array of strings when written. `Ada <ada@example.com>`
  is understood.
- **Ids are prefixed** — `msg_`, `thr_`, `mbx_`, `lbl_`, `whk_` — so a wrong id
  in the wrong place is obvious.
- **Many lookups take a name** as well as an id. `GET /domains/example.com`,
  `GET /labels/Receipts` and `DELETE /suppressions/bad@example.net` all work.
- **Bodies are at most 30 MB**, which is what caps attachments.

## Every endpoint

| Method | Path | Scope |
| --- | --- | --- |
| `GET` | `/me` | any key |
| `POST` | `/emails` | `emails:send` |
| `POST` | `/emails/batch` | `emails:send` |
| `GET` | `/emails` | `emails:read` |
| `GET` | `/emails/:id` | `emails:read` |
| `GET` | `/threads` | `mail:read` |
| `GET` | `/threads/:id` | `mail:read` |
| `PATCH` | `/threads/:id` | `mail:write` |
| `DELETE` | `/threads/:id` | `mail:write` |
| `POST` | `/threads/:id/reply` | `mail:write` |
| `GET` | `/messages` | `mail:read` |
| `GET` | `/messages/:id` | `mail:read` |
| `PATCH` | `/messages/:id` | `mail:write` |
| `GET` | `/messages/:id/raw` | `mail:read` |
| `GET` | `/attachments/:id` | `mail:read` |
| `GET` | `/mailboxes` | `mailboxes:read` |
| `POST` | `/mailboxes` | `mailboxes:write` |
| `GET` | `/mailboxes/:id` | `mailboxes:read` |
| `PATCH` | `/mailboxes/:id` | `mailboxes:write` |
| `DELETE` | `/mailboxes/:id` | `mailboxes:write` |
| `GET` | `/domains` | `domains:read` |
| `POST` | `/domains` | `domains:write` |
| `GET` | `/domains/:id` | `domains:read` |
| `POST` | `/domains/:id/verify` | `domains:write` |
| `DELETE` | `/domains/:id` | `domains:write` |
| `GET` | `/labels` | `labels:read` |
| `POST` | `/labels` | `labels:write` |
| `GET` | `/labels/:id` | `labels:read` |
| `PATCH` | `/labels/:id` | `labels:write` |
| `DELETE` | `/labels/:id` | `labels:write` |
| `GET` | `/contacts` | `contacts:read` |
| `GET` | `/suppressions` | `suppressions:read` |
| `POST` | `/suppressions` | `suppressions:write` |
| `DELETE` | `/suppressions/:id` | `suppressions:write` |
| `GET` | `/webhooks` | `webhooks:read` |
| `POST` | `/webhooks` | `webhooks:write` |
| `GET` | `/webhooks/:id` | `webhooks:read` |
| `PATCH` | `/webhooks/:id` | `webhooks:write` |
| `DELETE` | `/webhooks/:id` | `webhooks:write` |
| `POST` | `/webhooks/:id/ping` | `webhooks:write` |
| `GET` | `/webhook-deliveries` | `webhooks:read` |
| `POST` | `/webhook-deliveries/:id/replay` | `webhooks:write` |
| `GET` | `/stats` | `stats:read` |

## Prefer not to write this by hand?

The [Node SDK](/sdk/) wraps all of it, typed, with retries, pagination and
webhook signature checking already done.

## Using an AI assistant?

These docs are published in the [llms.txt](https://llmstxt.org) format, so a
coding assistant can read the whole API in one fetch rather than crawling
pages.

| | |
| --- | --- |
| [`/llms.txt`](https://mailroom-docs.shahriyar.dev/llms.txt) | An index: every page, with a line on what it covers |
| [`/llms-full.txt`](https://mailroom-docs.shahriyar.dev/llms-full.txt) | Every page, concatenated. Around 26k tokens |

Both are generated from the pages themselves at build time, so they cannot
fall behind what is written here.
