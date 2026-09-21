# Retries and replays

## What happens when you are down

Each event is attempted up to **four times**, spread over about forty seconds:

| Attempt | Waits |
| --- | --- |
| 1 | immediately |
| 2 | 2 seconds |
| 3 | 10 seconds |
| 4 | 30 seconds |

Each attempt has a **10-second timeout**. A handler slower than that is a
handler that gets retried, so answer quickly and do the work afterwards.

Every attempt is written down, whether it worked or not, and you can read them
back from [`GET /webhook-deliveries`](/api/webhooks#deliveries).

## What counts as failure

| Your reply | |
| --- | --- |
| `2xx` | Success. No more attempts |
| `408` or `429` | Retried |
| Any other `4xx` | **Given up on immediately** |
| `5xx` | Retried |
| No reply, or a timeout | Retried |

A `4xx` other than those two means your endpoint understood the call and said
no. Repeating it will not change the answer, so it is not repeated.

::: warning This includes 401 and 403
If your handler rejects a call because you got the secret wrong, Mailroom
takes it at its word and gives up on that event. Fix the secret and
[replay](#replaying) what you missed.
:::

## Being switched off

After **20 failures in a row**, the endpoint is disabled. An endpoint that has
been gone for a day should not still be collecting retries.

Turn it back on when it is fixed:

```sh
curl -X PATCH https://mail.yourdomain.com/api/v1/webhooks/whk_… \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": true }'
```

Enabling also **clears the failure count**, since that is what somebody means
by having fixed it.

## Duplicates are your job

Delivery is at-least-once. A handler that times out after doing its work still
gets retried, because Mailroom never heard the answer.

The envelope's `id` is the delivery id and is stable across retries of the
same event, so:

```ts
if (await seen.has(event.id)) return Response.json({ ok: true });
await seen.add(event.id, { ttl: "7d" });
await handle(event);
```

A replay you trigger yourself reuses the original `id` too — which is usually
what you want, because a replay is the same event, not a new one.

## Replaying

```
POST /api/v1/webhook-deliveries/:id/replay
```

Everything that failed, again:

```sh
BASE=https://mail.yourdomain.com/api/v1

curl -s "$BASE/webhook-deliveries?succeeded=false&limit=100" \
     -H "Authorization: Bearer $KEY" \
| jq -r '.data[].id' \
| while read -r id; do
    curl -s -X POST "$BASE/webhook-deliveries/$id/replay" \
         -H "Authorization: Bearer $KEY" | jq -c '{id: .delivery_id, ok: .succeeded}'
  done
```

Deliveries are kept until the endpoint is deleted, so there is no window to
race.

## Checking an endpoint is alive

```
POST /api/v1/webhooks/:id/ping
```

Sends a `webhook.test` event and waits. Not retried, not backgrounded — it
tells you now whether the endpoint is reachable and whether it is checking the
signature, and it hands back the status and the body your handler returned.

## Ordering

There is none. Events are dispatched as they happen and retried
independently, so `email.delivered` can arrive before `email.sent` if the
first attempt at the latter failed.

Order by what is in the payload — `occurred_at`, `sent_at`, `received_at` —
rather than by arrival.
