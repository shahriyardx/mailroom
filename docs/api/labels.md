# Labels and contacts

## Labels

The labels threads are filed under. Scoped to the account, not to a mailbox.

### List

```
GET /api/v1/labels
```

Scope: `labels:read`

```json
{ "object": "label", "id": "lbl_…", "name": "Refunds", "color": "#64748b" }
```

### Read one

```
GET /api/v1/labels/:id
```

Scope: `labels:read`

Takes the **name** as well as the id — `GET /labels/Refunds` works, which
matters because an id is not something a script writer has to hand.

### Create

```
POST /api/v1/labels
```

Scope: `labels:write`

```json
{ "name": "Refunds", "color": "#64748b" }
```

`color` is a hex value like `#64748b`, and defaults to that. Names are unique
per account, so a repeat is `409`.

### Rename or recolour

```
PATCH /api/v1/labels/:id
```

Scope: `labels:write`

```json
{ "name": "Returns", "color": "#0ea5e9" }
```

### Delete

```
DELETE /api/v1/labels/:id
```

Scope: `labels:write`

The label goes; the threads it was on stay.

### Putting one on a thread

Labels are applied through the thread, not through the label:

```sh
curl -X PATCH https://mail.yourdomain.com/api/v1/threads/thr_… \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "add_labels": ["Refunds"] }'
```

See [Threads](/api/threads#change-one).

## Contacts

Everyone this account has written to or heard from, built automatically as
mail moves.

```
GET /api/v1/contacts
```

Scope: `contacts:read`

| Filter | |
| --- | --- |
| `q` | Matches the address or the name |
| `order` | `recent` (default) or `frequent` |
| `limit`, `cursor` | See [Pagination](/api/pagination) |

```json
{
  "object": "contact",
  "id": "con_…",
  "address": "ada@example.net",
  "name": "Ada Lovelace",
  "message_count": 27,
  "last_seen_at": "2026-09-20T14:03:11.000Z"
}
```

::: warning Only an unrestricted key can read these
Contacts are kept for the **whole account**, so there is no honest way to
narrow them to part of it. A key that reaches one department must not be able
to read every address the company has ever written to, so it gets `403`.
:::

There is no write endpoint. A contact appears when mail does.
