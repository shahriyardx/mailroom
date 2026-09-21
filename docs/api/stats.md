# Statistics

How much was sent and received, and how it landed.

```
GET /api/v1/stats
```

Scope: `stats:read`

| Parameter | |
| --- | --- |
| `days` | A window ending now. 1 to 365. **30** by default |
| `since`, `until` | An explicit window. `since` overrides `days` |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |

```sh
curl "https://mail.yourdomain.com/api/v1/stats?days=7" \
  -H "Authorization: Bearer mk_live_..."
```

```json
{
  "object": "stats",
  "since": "2026-09-14T10:00:00.000Z",
  "until": "2026-09-21T10:00:00.000Z",
  "sending": {
    "sent": 1284,
    "delivered": 1249,
    "bounced": 21,
    "complained": 1,
    "failed": 3,
    "opened": 611,
    "total_opens": 903,
    "bounce_rate": 1.64,
    "complaint_rate": 0.08,
    "open_rate": 47.59
  },
  "receiving": { "received": 312, "threads": 189, "unread": 7 },
  "drafts": 4,
  "bytes": 48123904,
  "days": [
    { "day": "2026-09-14", "sent": 180, "received": 44, "delivered": 176, "bounced": 3, "opened": 84 }
  ],
  "mailboxes": [
    { "id": "mbx_…", "address": "receipts@example.com", "sent": 1102, "received": 0 }
  ]
}
```

## The rates

`bounce_rate`, `complaint_rate` and `open_rate` are **shares of sent mail out
of 100** — so `1.64` is 1.64%, not 164%.

| | SES starts warning above |
| --- | --- |
| `bounce_rate` | **5** |
| `complaint_rate` | **0.1** |

Watching these two is the single most useful thing this endpoint is for. A
bounce rate climbing past 3 is worth investigating before AWS does it for you.

`open_rate` counts messages whose tracking image was loaded. Apple Mail and
Gmail fetch images through their own servers, so treat it as evidence of
delivery rather than proof of reading.

## Days

`days` has a row for **every day in the window**, quiet ones included, so a
chart needs one call rather than one point per request. Days are UTC.

## Mailboxes

Up to 50 mailboxes, busiest first. `received` is always 0 for a
send-only address, which makes it easy to see which mailboxes are doing what.

## Receiving

`receiving.threads` and `receiving.unread` are **not** limited to the window —
they are the current state of the inbox, because "how many unread do I have
over the last 30 days" is not a question anybody asks.
