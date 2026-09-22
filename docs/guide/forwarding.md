# Forwarding

**Settings → Forwarding.**

A copy of inbound mail, sent on to an address outside Mailroom. Useful for
keeping an old inbox fed while you move over, for an archive copy, or for
getting one mailbox onto a phone that is already set up for something else.

**Nothing is forwarded until you set it up.** A fresh instance forwards
nowhere. It takes two steps: add the address you want mail copied to and let
its owner verify it, then write a rule saying what to copy there. Neither
happens on its own.

## How it decides

Rules sit at one of three widths:

| | |
| --- | --- |
| **Everything** | Every message this instance receives. |
| **By domain** | Every message to any address on that domain. |
| **By mailbox** | One address. |

**Every rule that matches applies.** A company-wide archive copy and a copy of
`support@` going to a shared phone are two rules, and a message to `support@`
satisfies both, so it is copied twice.

To keep something out of the wider rules, switch **Skip wider rules** on for
that domain or mailbox. It only stops the widths above it — a mailbox with the
switch on still follows its own rules.

::: tip Worked example
`hr@acme.com` in a company that copies everything to `archive@backup.example`:
switch **Skip wider rules** on for the `hr@acme.com` row, and the archive stops
receiving it. Everything else still goes.
:::

## The address list is Cloudflare's

A forwarding destination really lives on your Cloudflare account, so this page
shows what Cloudflare holds rather than a second list to keep in step by hand.

- Addresses already verified in the **Cloudflare dashboard** appear here on
  your next visit, already verified, with nothing to press.
- Adding one here creates it there.
- Removing one here deletes it there, along with every rule on this page that
  pointed at it.

The one thing not adopted is an address on a domain this instance receives on:
offering it would only offer a mail loop.

## Verifying an address

Cloudflare will not forward to an address whose owner has not agreed to it.
Adding one registers it with Cloudflare, which emails it a link. Until that
link is clicked the address shows as **Waiting**, and a rule pointing at it
does nothing at all.

**Check again** asks Cloudflare what it now thinks — there is no notification
when somebody clicks, so the page asks when it is opened and when you press the
button. **Send again** removes the address and re-adds it, which is the only
way Cloudflare offers to resend.

Verification is per address and account-wide: an address verified once works
for every domain on the account.

An address marked **Gone** is one Cloudflare no longer has — somebody deleted
the destination there. Its rules are kept rather than quietly dropped, so you
can add the address again and carry on.

::: warning The token needs one more permission
Adding and verifying addresses needs **Account → Email Routing Addresses →
Edit** on the Cloudflare token, on top of what [receiving](/guide/receiving)
already needs. Without it the page says Cloudflare rejected the token.

It is an *account* permission, not the *zone* one of a similar name that
receiving already uses — [the token guide](/guide/receiving#the-cloudflare-token)
has a picture of the whole list. Add it to the token you already have; editing
a token's permissions does not change its value, so there is nothing to
reconnect here. Creating a *new* token does, since a new token has a new value.
:::

## How the worker knows

It asks. Nothing is stored in the worker and nothing is cached in KV.

For every message, the worker already posts the whole thing to `/api/inbound`
on your instance — that is how mail gets stored. The reply now also carries the
addresses to forward to, worked out from the rules at the moment the message
arrived:

```json
{ "stored": 1, "forward": ["archive@backup.example"] }
```

So a rule changed on this page applies to the next message. There is no
redeploy, and no window where the worker and the dashboard disagree.

::: warning Redeploy the worker once
This only works with a worker built after forwarding was added. If you are
upgrading, press **Deploy worker** on Settings → Inbound worker once. Until you
do, the old worker ignores this page.
:::

## Mail to an address nobody owns

When no mailbox claims the address, Mailroom cannot apply a mailbox rule —
there is no mailbox. It falls back to the domain and instance rules, so mail to
a retired address still reaches somebody instead of bouncing.

If nothing matches, the message is rejected with `550 5.1.1 No such recipient
here`, exactly as before.

## What is not forwarded

- Mail you send. Only inbound messages.
- Anything, if the address is still **Waiting**.
- Anything, if no Cloudflare token is connected.

## When it stops working

Forwarding happens after the message is stored, so a forwarding failure never
costs you the copy in Mailroom — Cloudflare retries the whole delivery and the
app ignores the duplicate.

If one address stops receiving, check it still shows **Verified**. Somebody
removing the destination in the Cloudflare dashboard, or unsubscribing from the
link in the verification mail, takes it back to waiting.
