# Domains

What this account can send from, and the DNS each one needs.

## List

```
GET /api/v1/domains
```

Scope: `domains:read`

A key limited to some domains sees those. A domain name and its records are
not secret, but they are not that key's business either.

```json
{
  "object": "domain",
  "id": "dom_…",
  "name": "example.com",
  "region": "us-east-1",
  "status": "verified",
  "sending_enabled": true,
  "dkim_status": "verified",
  "dkim_origin": "AWS_SES",
  "mail_from_domain": "mail.example.com",
  "mail_from_status": "verified",
  "spf_verified": true,
  "dmarc_verified": true,
  "inherited_from": null,
  "auto_create_mailboxes": false,
  "imported": false,
  "last_checked_at": "2026-09-21T08:00:00.000Z",
  "records": [
    {
      "kind": "CNAME",
      "name": "abc123._domainkey.example.com",
      "value": "abc123.dkim.amazonses.com",
      "purpose": "DKIM signing",
      "required": true
    }
  ]
}
```

`status` is one of `pending`, `verified`, `failed`, `temporary_failure`,
`not_started`.

`inherited_from` is set when the domain is a **subdomain covered by a
parent**. Such a domain has an empty `records` array, because there is nothing
to publish.

## Read one

```
GET /api/v1/domains/:id
```

Scope: `domains:read`

Takes the **name** as well as the id:

```sh
curl https://mail.yourdomain.com/api/v1/domains/example.com \
  -H "Authorization: Bearer mk_live_..."
```

## Add

```
POST /api/v1/domains
```

Scope: `domains:write`

```json
{ "name": "example.com" }
```

Creates the identity in SES and returns the records to publish. Returns `201`.

Only a key that reaches the **whole account** may do this, because adding a
domain changes the account rather than one corner of it. A narrower key gets
`403`.

## Re-check

```
POST /api/v1/domains/:id/verify
```

Scope: `domains:write`

Asks SES where the identity stands and probes SPF and DMARC in DNS, then
returns the domain as it now is. This is what a setup script polls after
publishing records.

```sh
until curl -s https://mail.yourdomain.com/api/v1/domains/example.com/verify \
  -X POST -H "Authorization: Bearer $KEY" | jq -e '.sending_enabled' >/dev/null
do sleep 30; done
```

## Remove

```
DELETE /api/v1/domains/:id
```

Scope: `domains:write`

Removes it from Mailroom. Add `?delete_in_ses=true` to delete the SES identity
too.

::: warning delete_in_ses cannot be undone
And other instances, or other applications on the same AWS account, may be
relying on that identity.
:::

```json
{
  "object": "domain",
  "id": "dom_…",
  "name": "example.com",
  "deleted": true,
  "deleted_in_ses": false
}
```
