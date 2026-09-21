# Test keys

A key made in test mode runs everything a live one runs and stops one step
short of handing the message to SES.

The mailbox is checked, the blocked list is checked, the template is filled
in, the MIME is built, the message appears in Sent, the webhooks fire. Nothing
leaves the building, nothing costs anything, and nothing counts against your
SES sending quota.

## Making one

**Settings → API keys**, fill in the name and the scopes as usual, and turn on
**Test key** before creating it.

A test key reads `mk_test_…` rather than `mk_live_…`. That is deliberate: a
test key that found its way into production config would otherwise look
exactly like the real one, and mail that silently never arrives is the kind of
failure nobody notices for a week.

`GET /api/v1/me` reports which it is:

```json
{ "object": "api_key", "mode": "test", … }
```

## Making a bounce happen

Since nothing reaches SES, nothing will ever arrive from the event stream to
say what became of the message. The recipient decides instead:

| Recipient | What the message is made to look like |
| --- | --- |
| `bounce@…`, `bounced@…` | Bounced |
| `complaint@…`, `complained@…` | Marked as spam |
| `delay@…` | Still being tried |
| Anything else | Delivered |

The domain does not matter, only the part before the `@`.

Your endpoint hears `email.sent`, then the matching event, in the same shape
SES would have produced — plus `simulated: true`:

```json
{
  "id": "evt_…",
  "type": "email.bounced",
  "data": {
    "email": { "id": "msg_…", "status": "bounced", "test": true },
    "recipients": ["bounce@example.com"],
    "detail": "Simulated by a test key",
    "occurred_at": "2026-09-21T10:00:00.000Z",
    "simulated": true
  }
}
```

The shape matches on purpose. A receiver you test against a test key must not
need a special case, or testing against it proves nothing.

The message timeline in the dashboard is written too, so a test send reads the
same there as a real one, next to a **test** badge.

## Keeping the two apart

Listings and statistics show the side the key is on. A live key sees real
mail; a test key sees its own test sends. Either can ask for the other:

```sh
curl "https://mail.yourdomain.com/api/v1/emails"             # this key's side
curl "https://mail.yourdomain.com/api/v1/emails?test=true"   # the test side
curl "https://mail.yourdomain.com/api/v1/emails?test=false"  # the live side
curl "https://mail.yourdomain.com/api/v1/emails?test=all"    # both
```

`GET /api/v1/messages` and `GET /api/v1/stats` follow the same rule. Statistics
are the reason it exists: a bounce rate must never count a bounce somebody
asked for.

::: warning This is a view, not a boundary
Test mode governs **sending** — a test key cannot put a message in front of a
real person. It is not an access control. What a key may read is decided by
its [scopes and reach](/api/scopes), the same as any other key, and a test key
with `mail:read` can read real mail through its threads.

Give a test key the narrow scopes you would give any key you did not fully
trust.
:::

## What it is good for

- Running your test suite without sending anything, and without an SES
  sandbox to get out of.
- Pointing a webhook receiver at a real send and watching what it does with a
  bounce, without bouncing a real message.
- Letting somebody try an integration against your instance without a key
  that can put a message in front of a real person. Narrow its scopes as you
  would any other key — test mode stops the sending, not the reading.

## What it is not

It is not a check on whether your mail will land. Nothing reaches SES, so
nothing tells you about your reputation, your DNS, or how a real inbox treats
your HTML. For that, send to an address you own with a live key.
