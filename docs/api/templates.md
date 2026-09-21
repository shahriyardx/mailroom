# Templates

A saved subject and body with holes in it, sent by name.

The point is that the wording stops living inside whatever service does the
sending. Changing a receipt should not need a deploy, and the same receipt
should read the same whichever service sent it.

## Sending one

Send a `template` — its slug or its id — instead of `html` and `text`, and a
`data` object holding the values it asks for.

```sh
curl -X POST https://mail.yourdomain.com/api/v1/emails \
  -H "Authorization: Bearer mk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "receipts@example.com",
    "to": "customer@example.net",
    "template": "receipt",
    "data": { "name": "Ada", "amount": "£10.00" }
  }'
```

A `subject` sent alongside a template wins over the saved one, so a one-off
variation needs no second template.

## The language

It is deliberately not one:

| | |
| --- | --- |
| <code v-pre>{{ name }}</code> | The value, with HTML escaped |
| <code v-pre>{{{ body }}}</code> | The value as it is, for markup you meant |
| <code v-pre>{{ user.name }}</code> | A path into a nested object |

That is all of it. No loops, no conditionals, no function calls. A template
that needs logic has quietly become code, and code belongs in the service
doing the sending, where it can be reviewed and tested.

::: warning A missing value is an error
A name with no value in `data` answers `422` and says which one is missing. It
does not become an empty string: `Hi ,` arriving at a customer is worse than
an error, and an empty string cannot be told apart later from a value that
really was empty.
:::

<code v-pre>{{ }}</code> escapes what it inserts, so a name arriving from a signup form cannot
write tags into mail sent under your own domain. Use <code v-pre>{{{ }}}</code> only for markup
you produced yourself.

## Save one

```
POST /api/v1/templates
```

Scope: `templates:write`

```sh
curl -X POST https://mail.yourdomain.com/api/v1/templates \
  -H "Authorization: Bearer mk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Receipt",
    "subject": "Your receipt, {{ name }}",
    "html": "<p>Hello {{ name }}, you paid {{ amount }}.</p>",
    "text": "Hello {{ name }}, you paid {{ amount }}."
  }'
```

| Field | | |
| --- | --- | --- |
| `name` | **required** | What a person calls it |
| `slug` | | What your code calls it. Derived from the name when left out |
| `description` | | A note for whoever finds it later |
| `subject` | | May contain placeholders |
| `html`, `text` | | Send either, or both |

Returns `201` with the saved template and, usefully, everything it asks for:

```json
{
  "object": "template",
  "id": "tpl_…",
  "name": "Receipt",
  "slug": "receipt",
  "subject": "Your receipt, {{ name }}",
  "variables": ["name", "amount"],
  "created_at": "2026-09-21T10:00:00.000Z",
  "updated_at": "2026-09-21T10:00:00.000Z"
}
```

A slug is lowercase letters, numbers and single hyphens, and has to be unique
in the account. A clash answers `409`.

## List them

```
GET /api/v1/templates
```

Scope: `templates:read`

By name. There are never many, so they arrive in one page.

## Read one

```
GET /api/v1/templates/:id
```

Scope: `templates:read`

The id or the slug — both are names for it.

## Change one

```
PATCH /api/v1/templates/:id
```

Scope: `templates:write`

Send only what changes; the rest is left alone.

## Delete one

```
DELETE /api/v1/templates/:id
```

Scope: `templates:write`

Mail already sent from it is unaffected — the wording was copied into the
message when it went out, not looked up afterwards.

## In the dashboard

**Settings → Templates** does all of this, with a preview that fills each hole
with its own name, so nothing in the preview can be mistaken for real data.
