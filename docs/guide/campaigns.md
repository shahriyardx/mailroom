# Campaigns

**Campaigns**, the second view of the app.

One message, written once, sent to everybody on a list. Switched off by
default — turn **Campaigns** on in [Settings → Features](/guide/features), and
a switcher appears at the top of the sidebar to move between your mail and
your campaigns.

An instance with **only** Campaigns on has no mail view at all, and opens
straight onto the campaigns overview.

## Lists are not your contacts

Mailroom already keeps a `contact` for every address it has seen mail from.
That is an address book, not an audience: somebody writing to your support
address once has not agreed to a newsletter.

So a list is its own thing, and nobody is on one by accident.

## Consent is recorded, not assumed

Every time you add addresses, you say where they came from — a signup form, an
import from somewhere else, added by hand. It is stored against each person and
shown next to them.

This matters on the day somebody asks why you are emailing them. "We do not
record that" is a bad answer, and under GDPR it is the wrong one.

::: tip Re-importing is safe
Somebody already on the list is left exactly as they are. Importing last
month's file again will **not** resubscribe anybody who has left since — which
is the most common way a sender ends up in a spam folder, and it is always an
accident.
:::

## Writing a broadcast

A broadcast is saved as a **draft** first. Sending is a separate press, because
it is the one thing here that cannot be taken back.

Three placeholders are filled in per person:

| | |
| --- | --- |
| `{{name}}` | Their name, or their address if you have no name |
| `{{address}}` | Their email address |
| `{{unsubscribe}}` | The link that takes them off this list |

Leave `{{unsubscribe}}` out and a plain one is added at the bottom. There is no
way to send without it, and that is deliberate.

## How it is sent

Each copy goes out through the same path the composer and the API use, one
recipient at a time, a small batch every few seconds.

That is slower than handing the whole list to SES at once, and it buys things a
bulk send has none of: every copy gets a row in the email log, bounces and
complaints come back per person, and an address that hard-bounces is suppressed
automatically.

A send that is interrupted — a restart, a crash — picks up where it stopped.
Everybody not yet sent to is still marked pending, and nothing is sent twice.

::: warning The audience is frozen when you press Send
Who it goes to is decided at that moment, so what went out can be explained
afterwards. Somebody subscribing mid-send is not included.

Somebody who **unsubscribes** mid-send is still dropped. Each recipient is
checked again as their copy goes out.
:::

## Unsubscribing

Every broadcast carries a `List-Unsubscribe` header and the one-click form of
it (RFC 8058). This is not a courtesy — **Gmail and Yahoo refuse bulk mail
without it.**

The link needs no sign-in. Somebody unsubscribing is, by definition, not a user
of your instance, and asking them to log in to stop receiving mail is how a
complaint becomes a spam report.

Unsubscribing is **per list**. Leaving the newsletter does not stop the release
notes they also asked for, and it never blocks a message somebody sends them
directly.

The link is signed rather than stored, so one dug out of a year-old email still
works.

## Keep marketing away from your real mail

Sending campaigns from the same domain your team's mail comes from puts one
reputation behind both. A bad campaign then costs you your password resets and
your replies to customers.

Send broadcasts from their own domain, or at least their own subdomain. It is
the single most valuable thing on this page.

## Limits worth knowing

| | |
| --- | --- |
| Amazon SES | Rate limits per second and a daily quota; new accounts start small |
| Cloudflare Email Routing | 200 verified destination addresses per account |

Mailroom paces sending to stay under the SES rate rather than burning retries
on the first minute of a large send.
