# Errors and retries

Anything other than a `2xx` throws. Every error extends `MailroomError` and
carries `status`, `code`, `message` and the decoded `body`.

```ts
import {
  isMailroomError,
  MailroomError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@shahriyardx/mailroom";

try {
  await mail.emails.send({ from: "nobody@unverified.example", to: "a@b.c" });
} catch (error) {
  if (error instanceof RateLimitError) {
    await sleep((error.retryAfter ?? 5) * 1000);
  } else if (error instanceof ValidationError) {
    console.error("bad field:", error.param, error.message);
  } else if (error instanceof NotFoundError) {
    // gone, or outside this key's reach — the two look the same on purpose
  } else if (isMailroomError(error)) {
    console.error(error.code, error.status, error.message);
  } else {
    throw error; // not ours
  }
}
```

## The classes

| Class | Status | `code` | Usually means |
| --- | --- | --- | --- |
| `AuthenticationError` | 401 | `unauthorized` | Key missing, mistyped or revoked |
| `PermissionError` | 403 | `forbidden` | Missing a scope, or outside the key's reach |
| `NotFoundError` | 404 | `not_found` | No such object, or none this key may see |
| `ConflictError` | 409 | `conflict` | Already exists, or needs a confirmation flag |
| `PayloadTooLargeError` | 413 | `payload_too_large` | Over 30 MB. Usually an attachment |
| `ValidationError` | 422 | `invalid_request` | A bad field; `param` names it |
| `RateLimitError` | 429 | `rate_limited` | Too many calls; `retryAfter` in seconds |
| `ServerError` | 5xx | `server_error` | The instance failed. Safe to retry |
| `TimeoutError` | — | `timeout` | No reply within `timeout` |
| `ConnectionError` | — | `connection_error` | DNS, TLS, a dropped socket |

`PermissionError` also carries `requiredScope` when a missing scope was the
reason:

```ts
catch (error) {
  if (error instanceof PermissionError) {
    console.error(`This key needs ${error.requiredScope}`);
  }
}
```

`WebhookVerificationError` is separate — it comes from
`constructWebhookEvent`, not from a call.

## Retries

The client retries on its own when repeating is **safe**:

- Every `GET`
- Any `POST` sent with an `idempotencyKey`

Nothing else. An unkeyed send that times out is never repeated, because
"probably did not send" is not good enough to risk sending twice.

What is retried: `429`, any `5xx`, timeouts and dropped connections. Waits are
exponential with jitter, and a `Retry-After` is obeyed when the server sends
one.

```ts
const mail = new Mailroom({ maxRetries: 4 }); // default 2; 0 turns it off
```

## Rate limit headers

```ts
await mail.me();
console.log(mail.rateLimit);
// { limit: 300, remaining: 297, resetAt: 2026-09-21T10:01:49.000Z }
```

Kept from the most recent reply, and `null` before the first one.

## Timeouts and cancelling

```ts
const mail = new Mailroom({ timeout: 10_000 });
```

Pass your own signal per call, which is combined with the client's timeout:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 2_000);

await mail.threads.list({}, { signal: controller.signal });
```

An abort you triggered throws **your** abort error. One from the client's own
timer throws `TimeoutError`, so you can tell them apart.

## What does not throw

Three things look like failures and are not:

```ts
// A batch where some messages failed. Check result.failed.
const result = await mail.emails.sendBatch(many);

// A webhook endpoint that was unreachable. Check ping.succeeded.
const ping = await mail.webhooks.ping(id);

// The same for a replay.
const replay = await mail.webhooks.replay(deliveryId);
```

In each case the call itself worked. Treating them as thrown errors would
lose the detail you actually need.
