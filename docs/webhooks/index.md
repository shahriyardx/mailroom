# Webhooks

Being told what happens to mail, rather than asking.

## What arrives

A `POST` with a JSON body, and three headers:

| Header | |
| --- | --- |
| `X-Mailroom-Event` | The event name |
| `X-Mailroom-Signature` | `t=<unix seconds>,v1=<hex>` |
| `X-Mailroom-Webhook-Id` | Which endpoint this came from |

The body is always the same envelope:

```json
{
  "id": "whd_9f2c…",
  "object": "event",
  "type": "mail.received",
  "created_at": "2026-09-21T09:58:02.000Z",
  "data": { "email": { "…": "…" } }
}
```

`id` is also the **delivery id**, so a repeat — a retry after your endpoint
timed out, or a replay you triggered — can be recognised and ignored.

## Setting one up

Two ways, and they do the same thing:

- **Settings → Webhooks** in the app
- [`POST /api/v1/webhooks`](/api/webhooks#create)

Either way the reply carries the **signing secret**, shown once and never
again.

## What to do in a handler

1. Read the **raw body** as text. Not a parsed object.
2. [Verify the signature](/webhooks/verifying) against it.
3. Answer `2xx` **quickly** — do the slow part after, or on a queue.
4. Ignore an `id` you have already seen.

A handler that takes ten seconds is a handler that gets retried, because the
timeout is ten seconds.

## Next

- [The events](/webhooks/events) — all nine, and what is in each
- [Verifying a call](/webhooks/verifying) — with code that works
- [Retries and replays](/webhooks/retries) — what happens when you are down
