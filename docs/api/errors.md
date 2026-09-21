# Errors

Anything other than a `2xx` returns the same shape.

```json
{ "error": "A sentence you can log", "code": "not_found" }
```

`error` is for a human reading a log. `code` is for a program deciding what to
do.

## The codes

| Status | `code` | Means | Retry? |
| --- | --- | --- | --- |
| 401 | `unauthorized` | Key missing, mistyped or revoked | No |
| 403 | `forbidden` | Missing a scope, or the call is account-wide and the key is not | No |
| 404 | `not_found` | No such object, or none this key may reach | No |
| 409 | `conflict` | Already exists, or a destructive call needs its confirmation flag | No |
| 413 | `payload_too_large` | Over 30 MB. Usually an attachment | No |
| 422 | `invalid_request` | A field is wrong. `param` names it | No |
| 429 | `rate_limited` | Too many calls this minute | Yes, after `Retry-After` |
| 500 | `server_error` | The instance failed | Yes |

## A missing scope

```json
{
  "error": "This API key does not have the \"mail:write\" scope",
  "code": "forbidden",
  "required_scope": "mail:write",
  "scopes": ["mail:read"]
}
```

`required_scope` is the one to add.

## A bad field

```json
{
  "error": "to: Required, subject: Expected string, received number",
  "code": "invalid_request",
  "param": "to"
}
```

Every problem is listed in `error`; `param` names the first, which is enough
to highlight a form field.

## Rate limiting

```
HTTP/1.1 429
Retry-After: 43
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1800000000
```

```json
{ "error": "Too many requests. Slow down.", "code": "rate_limited" }
```

## Why 404 and not 403

A key that cannot reach an object is told the object does not exist. That is
on purpose: a `403` confirms it *does* exist, which turns "no access" into a
way to enumerate what you cannot see.

So a `404` means one of two things, and the API will not tell you which:

- It is genuinely not there
- It is outside this key's [reach](/api/scopes#reach)

Check with `GET /me` when you are unsure.

## Partial success

Two endpoints can half-work, and neither uses an error status for it.

**Batch sending** returns `207` when some messages failed:

```json
{
  "object": "batch",
  "sent": 2,
  "failed": 1,
  "data": [
    { "index": 0, "ok": true, "id": "msg_…" },
    { "index": 1, "ok": false, "error": "…", "status": 422 },
    { "index": 2, "ok": true, "id": "msg_…" }
  ]
}
```

**Webhook ping and replay** return `502` with a full result body when your
endpoint was unreachable. The call worked; the endpoint did not.

```json
{
  "object": "webhook_ping",
  "succeeded": false,
  "status_code": 500,
  "response_body": "Internal Server Error",
  "error": "Endpoint replied 500"
}
```
