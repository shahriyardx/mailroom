# Webhooks

Managing endpoints and reading their history. For what the events *are* and
how to check a signature, see [Webhooks](/webhooks/).

## List endpoints

```
GET /api/v1/webhooks
```

Scope: `webhooks:read`

```json
{
  "object": "webhook",
  "id": "whk_…",
  "url": "https://api.example.com/hooks/mail",
  "description": "Production receiver",
  "events": ["mail.received", "email.bounced"],
  "enabled": true,
  "mailbox_id": null,
  "last_status": 200,
  "last_delivered_at": "2026-09-21T09:58:02.000Z",
  "last_error_at": null,
  "last_error": null,
  "consecutive_failures": 0,
  "created_at": "2026-08-01T12:00:00.000Z"
}
```

The **secret is never returned on a read**. It is shown once, at creation, and
once more if you rotate it.

## Create

```
POST /api/v1/webhooks
```

Scope: `webhooks:write`

```json
{
  "url": "https://api.example.com/hooks/mail",
  "description": "Production receiver",
  "events": ["mail.received", "email.bounced"],
  "mailbox_id": null,
  "enabled": true
}
```

| Field | |
| --- | --- |
| `url` | **required**. Must be `https` |
| `events` | Event names, or `["*"]` for everything **including events added later**. Defaults to `["*"]` |
| `mailbox_id` | Only fire for mail in this mailbox |
| `description` | For your own reference |

Returns `201` **with the signing secret**:

```json
{ "object": "webhook", "id": "whk_…", "secret": "whsec_…", "…": "…" }
```

::: danger Store the secret now
It is shown here and never again. An endpoint that does not check the
signature will accept anything anybody posts at it.
:::

### Where an endpoint may point

The URL must be `https`, and it must not resolve to a private address.
Loopback and private ranges, link-local, and cloud metadata hosts like
`169.254.169.254` are all refused.

This is not decoration: Mailroom fetches the URL and stores the reply where
the key holder can read it, so an unchecked URL would be a way to read
whatever the container can reach — an internal admin page, a metadata
service — from outside.

`localhost` and `127.0.0.1` are allowed **off production**, because a local
receiver is how one gets tried out.

### Reach applies

A webhook with **no mailbox** hears about every address. A key that reaches
only part of the account cannot create one, and cannot clear the `mailbox_id`
of an existing one, because either would be a way to receive mail the key
cannot read.

## Change

```
PATCH /api/v1/webhooks/:id
```

Scope: `webhooks:write`

```json
{ "enabled": true, "events": ["*"], "rotate_secret": false }
```

Turning an endpoint **back on also clears its failure count**, since that is
what somebody means by having fixed it.

`rotate_secret: true` replaces the secret and returns the new one, once.

## Turn off or delete

```
DELETE /api/v1/webhooks/:id
DELETE /api/v1/webhooks/:id?disable_only=true
```

Scope: `webhooks:write`

`disable_only` stops delivery but keeps the endpoint and its history, which is
usually what you want while something is being repaired. A plain delete takes
the endpoint **and its deliveries** together.

## Test

```
POST /api/v1/webhooks/:id/ping
```

Scope: `webhooks:write`

Sends a `webhook.test` event and **waits for the answer**. Unlike a real event
it is not retried and not sent in the background: the point is to see, now,
whether the endpoint is reachable and whether it is checking the signature.

```json
{
  "object": "webhook_ping",
  "webhook_id": "whk_…",
  "succeeded": true,
  "status_code": 200,
  "duration_ms": 214,
  "response_body": "{\"ok\":true}",
  "error": null
}
```

A failure comes back as `502` **with this same body**, not as a bare error —
the call worked, the endpoint did not.

## Deliveries

```
GET /api/v1/webhook-deliveries
```

Scope: `webhooks:read`

Every attempt at every endpoint, newest first, with the status and the reply
that came back.

| Filter | |
| --- | --- |
| `webhook_id` | One endpoint |
| `event` | One event name |
| `succeeded` | `true` or `false` |
| `limit`, `cursor` | See [Pagination](/api/pagination) |

```json
{
  "object": "webhook_delivery",
  "id": "whd_…",
  "webhook_id": "whk_…",
  "event": "mail.received",
  "payload": { "email": { "…": "…" } },
  "attempt": 2,
  "status_code": 500,
  "response_body": "Internal Server Error",
  "error": "Endpoint replied 500",
  "duration_ms": 1204,
  "succeeded": false,
  "created_at": "2026-09-21T09:58:02.000Z"
}
```

A delivery carries the payload of the event it was for, so it is only readable
through a webhook this key may see.

## Replay

```
POST /api/v1/webhook-deliveries/:id/replay
```

Scope: `webhooks:write`

Sends a stored payload again — what an endpoint that was down gets caught up
with, once it is back.

```sh
# Everything that failed in the last hour, again.
curl -s "$BASE/webhook-deliveries?succeeded=false&limit=100" -H "Authorization: Bearer $KEY" \
| jq -r '.data[].id' \
| xargs -I{} curl -s -X POST "$BASE/webhook-deliveries/{}/replay" -H "Authorization: Bearer $KEY"
```

Same reply shape as a ping, and the same `502`-with-a-body on failure.
