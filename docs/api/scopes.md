# Scopes and reach

A key carries two limits. Both are checked on every call, and neither
substitutes for the other.

## Scopes

Scopes say **what kind of call** is allowed.

| Scope | Allows |
| --- | --- |
| `emails:send` | `POST /emails`, `/emails/batch` |
| `emails:read` | Listing and reading sent mail |
| `mail:read` | Threads, messages, attachments, raw messages |
| `mail:write` | Moving, reading, starring, labelling, replying, deleting |
| `mailboxes:read` | Listing and reading mailboxes |
| `mailboxes:write` | Creating, changing and deleting them |
| `domains:read` | Listing and reading domains and their DNS |
| `domains:write` | Adding, re-checking and removing them |
| `labels:read` | Listing and reading labels |
| `labels:write` | Creating, renaming and deleting them |
| `contacts:read` | Listing contacts |
| `templates:read` | Listing and reading templates, and sending one |
| `templates:write` | Creating, changing and deleting them |
| `suppressions:read` | Listing blocked addresses |
| `suppressions:write` | Blocking and unblocking |
| `webhooks:read` | Listing endpoints and deliveries |
| `webhooks:write` | Creating, changing, testing, replaying |
| `stats:read` | `GET /stats` |
| `*` | All of the above, and anything added later |

**Writing implies reading.** A key with `mail:write` has `mail:read` without
being given it, because "may change but may not see" is a trap that only ever
shows up as a 403 in production.

Sending a [template](/api/templates) needs `templates:read` as well as
`emails:send`, so the ready-made **Send only** choice carries both.

A missing scope is a `403`:

```json
{
  "error": "This API key does not have the \"mail:write\" scope",
  "code": "forbidden",
  "required_scope": "mail:write",
  "scopes": ["mail:read", "emails:send"]
}
```

## Reach

Reach says **which mail** those calls may touch.

| Reach | Means |
| --- | --- |
| **Everything** | Every mailbox in the account, including ones made later |
| **Whole domains** | Every address on those domains, including ones made later |
| **Named addresses** | Exactly those mailboxes |

Reach is enforced everywhere, not only on sending:

- `GET /threads` returns only threads in mailboxes the key reaches.
- `GET /domains` returns only domains it holds.
- `GET /contacts` returns `403` for any key that is not unrestricted, because
  contacts are kept per account and there is no honest way to narrow them.
- `POST /domains` returns `403` for the same reason — adding a domain changes
  the account, not one corner of it.
- A webhook cannot be created without a mailbox by a key that does not reach
  the whole account, or it would be a way to receive mail the key cannot read.

### Something out of reach is a 404, not a 403

```json
{ "error": "No such thread", "code": "not_found" }
```

Deliberately. A `403` would confirm the object exists, which lets somebody
map what they cannot see by asking about it.

## Sending, specifically

| The key holds | May send as |
| --- | --- |
| Everything | Any address on any verified domain. The mailbox is made on first use |
| Whole domains | Any address on those domains. The mailbox is made on first use |
| Named addresses | Exactly those addresses |

This is why a whole-domain key is the right choice for transactional mail:
`receipts@`, `noreply@` and `alerts@` all work without anybody creating them
first.

## Picking one

Give each integration the narrowest key that does its job.

| The job | Scopes | Reach |
| --- | --- | --- |
| A billing service sending receipts | `emails:send` | the `billing.` domain |
| A dashboard showing delivery health | `emails:read`, `stats:read` | everything |
| A bot that answers support mail | `mail:read`, `mail:write`, `emails:send` | `support@` |
| A backup script | `mail:read` | everything |
