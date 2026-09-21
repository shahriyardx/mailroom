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

A test key sees only its own test mail. Asking for the live side does nothing
— a sandbox that could read real traffic would not be one.

A live key sees real mail, unless it asks:

```sh
curl "https://mail.yourdomain.com/api/v1/emails"             # real mail
curl "https://mail.yourdomain.com/api/v1/emails?test=true"   # test mail
curl "https://mail.yourdomain.com/api/v1/emails?test=all"    # both
```

`GET /api/v1/messages` and `GET /api/v1/stats` follow the same rule. A bounce
rate is the one number that must never count a bounce somebody asked for.

## What it is good for

- Running your test suite without sending anything, and without an SES
  sandbox to get out of.
- Pointing a webhook receiver at a real send and watching what it does with a
  bounce, without bouncing a real message.
- Letting somebody try an integration against your instance before you trust
  them with a key that can actually send.

## What it is not

It is not a check on whether your mail will land. Nothing reaches SES, so
nothing tells you about your reputation, your DNS, or how a real inbox treats
your HTML. For that, send to an address you own with a live key.
