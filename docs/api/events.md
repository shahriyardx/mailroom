# Events

Things that happen in your own product. Post one and whatever
[automation](/guide/automations) is waiting for it starts, for that person.

This is the outbound direction only — your code telling Mailroom. For
Mailroom telling your code about mail, see [Webhooks](/api/webhooks).

## Post an event

```
POST /api/v1/events
```

Scope: `events:write`

```json
{
  "event": "trial.ended",
  "email": "person@example.com",
  "name": "Pat Doe",
  "fields": { "plan": "pro", "order": "A-19" },
  "consent_source": "signed up at checkout"
}
```

| Field | | |
| --- | --- | --- |
| `event` | required | The name. Lowercased and tidied, so `Trial.Ended` and `trial.ended` are the same event |
| `email` | required | Who it happened to |
| `name` | optional | Used only if they have to be added to the list |
| `fields` | optional | Merged onto the person before the flow starts |
| `consent_source` | optional | Where consent came from. Only used when they are not on the list yet |

The reply names every automation that heard it, and what happened to that
person in each:

```json
{
  "event": "trial.ended",
  "declared": true,
  "matched": 1,
  "automations": [
    { "id": "aut_…", "name": "After the trial", "status": "started" }
  ]
}
```

| `status` | Meaning |
| --- | --- |
| `started` | They are at the top of the flow |
| `restarted` | They had finished it before; they are back at the top |
| `already_running` | They are part-way through it, so nothing was done |
| `skipped` | Nothing happened. `reason` says why |

The same reply carries `stopped`: flows this event **ended**, because it was
what they were for.

```json
{ "stopped": [{ "id": "aut_…", "name": "Cart recovery" }] }
```

An event can be both — starting one flow and ending another — which is
exactly what `order.placed` does.

`matched: 0` means nothing was listening — no automation is switched on for
that name. The event is still recorded.

::: warning An address nobody knows is skipped, not added
An event carrying an email is not that person asking for mail. Without
`consent_source` an unknown address comes back as `skipped`. With it they are
added to the automation's list first — the same consent record the
[subscribe](/guide/campaigns#the-signup-page) endpoint requires — and the flow
starts.

On a double opt-in list they are added as *pending* and nothing runs until
they confirm.
:::

`fields` are merged, not replaced: an event about one thing does not wipe what
is already known about that person.

## List the event names

```
GET /api/v1/events
```

Scope: `events:read`

```json
{
  "data": [
    {
      "id": "evt_…",
      "name": "trial.ended",
      "description": "Posted by the billing worker the night a free trial runs out",
      "declared": true,
      "seen_count": 412,
      "last_seen_at": "2026-09-23T09:58:02.000Z",
      "automations": 2,
      "live_automations": 1
    }
  ]
}
```

`declared` is `false` for a name that arrived from the API before anybody
wrote it down under **Campaigns → Events**. Those are worth looking at: a
mistyped event name is otherwise invisible, and it looks exactly like nothing
having happened.
