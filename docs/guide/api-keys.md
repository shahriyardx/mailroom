# API keys

**Settings → API keys.**

A key is how your own code talks to your instance. It is shown once, when it
is made, and stored only as a hash — there is no way to read it back.

```
mk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

## Two limits, both checked

Every key carries two separate limits, and a call has to pass both.

### Scopes — what kind of call is allowed

Presets cover the common cases:

| Preset | Means |
| --- | --- |
| **Full access** | Everything this instance's API can do |
| **Send only** | Send mail and check what happened to it. Cannot read your inbox |
| **Read only** | Read mail, mailboxes, domains and stats. Cannot change anything |
| **Inbox agent** | Read, organise and reply to mail. Cannot manage domains or keys |

**Custom** opens nine areas — Sending, Mail, Mailboxes, Domains, Labels,
Contacts, Blocked addresses, Webhooks, Statistics — each set to **None**,
**Read** or **Manage**.

Writing always implies reading, so there is no way to produce a key that may
change something it cannot see.

### Reach — which mail those calls may touch

| Reach | Means |
| --- | --- |
| **Everything** | Every mailbox in the account, including ones made later |
| **Whole domains** | Every address on those domains, including ones made later |
| **Named addresses** | Exactly those mailboxes, and no others |

Reach applies **everywhere**, not only to sending. A key limited to
`support@example.com` cannot read another inbox, cannot point a webhook at
mail it may not read, and cannot list account-wide contacts.

Picking a whole domain covers addresses added to it in future, which is what
"this key handles support mail" actually means. Picking named addresses is the
tighter choice when the set will not grow.

## Rate limit

Each key allows **300 calls a minute** unless you set otherwise. Every reply
carries the window:

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 297
X-RateLimit-Reset: 1800000000
```

Going over returns `429` with a `Retry-After`.

## Checking a key

```sh
curl https://mail.yourdomain.com/api/v1/me \
  -H "Authorization: Bearer mk_live_..."
```

This is the first call to make when something is not working: it tells a
missing scope apart from a wrong URL in one line.

## Losing one

Revoke it. A revoked key stops working immediately and cannot be brought
back — make a new one. Mail already sent with it keeps its `api_key_id`, so
you can still see what it did.

## Next

- [Using the API](/api/) — auth, base URL, the shape of every reply
- [Scopes and reach in detail](/api/scopes)
- [The Node SDK](/sdk/) — the same thing, typed
