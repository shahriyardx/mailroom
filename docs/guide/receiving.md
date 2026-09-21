# Receiving mail

**Settings → Inbound worker.**

Inbound mail arrives through Cloudflare Email Routing, which hands each
message to a Worker, which posts it to your instance. The Worker is deployed
**from the app** — there is no `wrangler` step of your own.

## The Cloudflare token

Create an API token with these permissions:

```
Account → Workers Scripts     → Edit
Account → Workers R2 Storage  → Edit
Zone    → Zone                → Read
Zone    → Zone Settings       → Edit
Zone    → Email Routing Rules → Edit
Zone    → DNS                 → Edit
```

::: warning Zone Settings is easy to miss
Cloudflare gates *turning Email Routing on* behind **Zone Settings**, not
behind the Email Routing permission. Without it the deploy succeeds and
receiving silently never starts.
:::

Paste the token and press **Deploy worker**. The token is encrypted with a key
derived from `BETTER_AUTH_SECRET` before it is stored.

## Turning a domain on

Press **Receive mail here** on each domain.

::: danger This replaces the zone's MX records
Turning Email Routing on for a zone points its MX at Cloudflare. Anything
receiving mail on that domain today stops receiving it.

Set `FORWARD_TO` first if you want a copy to keep reaching your old inbox.
:::

## Where mail lands

An arriving message goes to the mailbox whose address it was sent to. If no
mailbox matches:

- A mailbox marked **catch-all** on that domain collects it.
- A domain with **Capture every address** switched on creates a mailbox for
  the address on the spot.
- Otherwise the message is dropped.

## What you get with each message

Inbound mail carries the authentication results Cloudflare saw:

| Field | Meaning |
| --- | --- |
| `spf` | Did the sending server have permission |
| `dkim` | Was the signature valid |
| `dmarc` | What the domain's own policy says about the two above |
| `spam_score` | Cloudflare's score, when it gave one |
| `mailed_by` | The envelope sender's domain — who actually handed it over |
| `signed_by` | The domain in the DKIM signature, preferring the one that matches `From` |
| `tls` | How the last hop reached you: `TLS1.3`, or `none` for a plaintext hop |

Mailroom does not filter on these. It records them so you can, in a filter
rule or in your own code.

## The raw message

Every inbound message is stored byte for byte in R2. Fetch it with
[`GET /api/v1/messages/:id/raw`](/api/messages#the-original-message) when you
need to run it through a MIME parser, re-send it, or keep it for an audit.

Outbound mail has no raw copy: it is assembled at send time and handed
straight to SES.

## Filters

**Settings → Filters.** Rules match on sender, recipient, subject or body, and
can move a message to a folder, mark it read, star it or label it before you
ever see it. They run in priority order as the message arrives.
