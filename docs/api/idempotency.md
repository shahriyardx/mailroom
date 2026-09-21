# Idempotency and limits

## Sending exactly once

A send that times out leaves you with a hard question: did it go?

Send an `Idempotency-Key` and the question disappears.

```sh
curl -X POST https://mail.yourdomain.com/api/v1/emails \
  -H "Authorization: Bearer mk_live_..." \
  -H "Idempotency-Key: receipt-4821" \
  -H "Content-Type: application/json" \
  -d '{ "from": "receipts@example.com", "to": "a@b.c", "subject": "Receipt" }'
```

Repeat the call with the same key and you get the **first reply back**, not a
second message. The replay carries a header:

```
Idempotency-Replayed: true
```

Keys are remembered for **24 hours**, per endpoint.

### Use something meaningful

The key should come from the thing you are sending about — `receipt-4821`,
`order-19023-shipped` — not from a random UUID generated at call time. A fresh
UUID on a retry is no protection at all, because it is a different key.

### Same key, different body

```json
{
  "error": "This idempotency key was used with a different request",
  "code": "conflict"
}
```

That is the guard working. Either you reused a key you should not have, or
something changed between the first call and the retry.

### Where it works

`POST /emails` and `POST /emails/batch`. For a batch, the whole array is what
the key covers.

## Rate limits

Each key allows **300 calls a minute** unless it was given its own limit.

Every reply carries the window:

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 297
X-RateLimit-Reset: 1800000000
```

`X-RateLimit-Reset` is Unix seconds.

Going over returns `429` with `Retry-After` in seconds. Wait that long — do
not hammer, because a fixed window means the whole allowance returns at once
and a tight retry loop simply spends it again.

::: tip It is per container
The counter lives in the process, so two containers allow twice the stated
rate. It exists to stop a runaway loop from emptying your SES quota, not to
meter a plan.
:::

## The SES quota is separate

The rate limit is Mailroom's. **SES has its own**, and it is the one that
actually stops mail going out.

It is a rolling 24-hour window, not a daily allowance: each message stops
counting exactly 24 hours after it was sent. See
[Sending domains](/guide/domains#the-sending-limit).

A new SES account is in the sandbox — 200 a day, verified recipients only.
Ask AWS for production access before you rely on it.

## Body size

30 MB, which caps attachments. Over it:

```json
{ "error": "The request body is too large", "code": "payload_too_large" }
```

At most **20 attachments** on one message. Remember base64 adds about a third,
so a 30 MB body is roughly 22 MB of files.
