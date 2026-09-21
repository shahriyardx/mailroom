# Sending domains

**Settings → Domains.**

A domain has to be verified in SES before anything can be sent from it.
Mailroom creates the SES identity for you and shows the DNS to publish.

## Adding one

Type the domain in and press add. The screen then lists the records — one
click copies each. Publish them at your DNS host and the status moves to
**verified** on its own, usually within minutes.

Domains **already verified in SES** import themselves the first time you open
the page. You do not have to add them again.

## What the records are for

| Record | Why |
| --- | --- |
| Three **CNAME**s, `…_domainkey` | DKIM. Signs your mail so receivers can tell it really came from you |
| **MX** and **TXT** on the mail-from subdomain | The return path, so bounces come back to SES rather than to nothing |
| **TXT** SPF | Says SES is allowed to send for this domain |
| **TXT** DMARC | Tells receivers what to do when a message fails the two above |

SPF and DMARC are probed by Mailroom itself rather than by SES, so the ticks
next to them mean "we can see it resolving in DNS".

## Subdomains are free

A subdomain of a domain you have already verified needs **nothing**. Add
`billing.example.com` under a verified `example.com` and it is ready
immediately — SES inherits verification downwards, and Mailroom records it as
covered by its parent.

Such a domain shows no records of its own, because there are none to publish.

## Delivery reporting

Press **Set up delivery reporting** on the same screen. It creates the SNS
topic, wires SES to it, and subscribes your instance.

One manual step follows: set

```sh
SES_CONFIGURATION_SET=mail-events
```

in your environment and redeploy. SES only reports on a message that was sent
**with a configuration set attached**, and that variable is what attaches it.
Without it, every message stays at `sent` forever.

The panel shows the topic ARN if you also want to pin `SES_SNS_TOPIC_ARN` so
only that topic is accepted.

## The sending limit

The strip at the top of the page shows your SES quota.

It is a **rolling 24-hour window, not a daily allowance**. There is no reset
at midnight: each message stops counting exactly 24 hours after it was sent.
When you are close to the cap, Mailroom shows when the oldest message in the
window ages out, which is when headroom comes back.

A brand-new SES account is in the **sandbox**: 200 messages a day, and only to
addresses you have verified. Ask AWS for production access before you rely on
it.
