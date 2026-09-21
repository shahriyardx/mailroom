# Mailboxes

The addresses on your domains.

## List

```
GET /api/v1/mailboxes
```

Scope: `mailboxes:read`

Returns every address **this key can reach**, which is the quickest way for a
client to discover what it is allowed to do. `?domain=example.com` narrows it.

```json
{
  "object": "mailbox",
  "id": "mbx_…",
  "address": "support@example.com",
  "domain": "example.com",
  "domain_id": "dom_…",
  "display_name": "Support",
  "signature": "— The team",
  "is_catch_all": false,
  "is_default": true,
  "color": "#6366f1",
  "created_at": "2026-01-04T09:12:00.000Z"
}
```

## Read one

```
GET /api/v1/mailboxes/:id
```

Scope: `mailboxes:read`

## Create

```
POST /api/v1/mailboxes
```

Scope: `mailboxes:write`

```json
{
  "address": "billing@example.com",
  "display_name": "Billing",
  "signature": "— Accounts",
  "is_catch_all": false,
  "is_default": false,
  "color": "#0ea5e9"
}
```

The address must sit on a domain this account has verified, **or under one**.
A subdomain of a verified domain needs no identity of its own, so anything the
covering domain reaches is allowed.

A key that holds whole domains may add to them. A key that names addresses
holds exactly those, and naming one more is not its to do — that is a `403`.

Setting `is_default` clears it everywhere else. Only one at a time, or the
composer has to choose between them.

## Change one

```
PATCH /api/v1/mailboxes/:id
```

Scope: `mailboxes:write`

```json
{ "display_name": "Billing team", "signature": null }
```

The **address itself cannot change**. Make a new mailbox instead — renaming
one would orphan the mail already threaded under it. Send `signature: null` to
clear it.

## Delete

```
DELETE /api/v1/mailboxes/:id?confirm=true
```

Scope: `mailboxes:write`

::: danger This deletes the mail in it
Without `?confirm=true` the call returns `409` and does nothing. A mistyped id
should not empty an inbox.
:::

```json
{ "object": "mailbox", "id": "mbx_…", "deleted": true }
```

## Created on first use

A mailbox does not have to exist before you send from it. A key that reaches a
whole domain can send as any address on it, and the mailbox is created the
first time it does — SES already permits it, and code sends from `noreply@`
and `receipts@` that nobody would think to create by hand.
