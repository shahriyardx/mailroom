# Desktop notifications

**Settings → Notifications.**

A notice on the desktop when mail arrives, whether or not Mailroom is open in
a tab. It uses Web Push, so the browser itself is woken by the push service —
there is no tab polling in the background and nothing to leave running.

## Turning it on

Two things have to be true.

### 1. The instance needs a key pair

Generate one once:

```sh
pnpm push:keys
```

It prints three lines to put in your environment:

```
VAPID_PUBLIC_KEY="…"
VAPID_PRIVATE_KEY="…"
VAPID_SUBJECT="mailto:you@example.com"
```

`VAPID_SUBJECT` is how a push service reaches whoever runs the instance if
something goes wrong; any address you actually read is fine. Restart Mailroom
after setting them.

::: warning Generate the pair once and leave it alone
The keys identify your instance to every browser that has subscribed. Change
them and every existing subscription stops working, and everybody has to turn
notifications on again. Keep `VAPID_PRIVATE_KEY` secret; the public one is
meant to be handed out.
:::

Without a pair, the Notifications page says so and offers nothing. Everything
else in Mailroom works exactly as before.

### 2. Each person switches it on, per browser

**Settings → Notifications → Notify me on this browser.** The browser asks for
permission the first time.

It is per browser on purpose, because that is what the permission is: allowing
it on a laptop says nothing about a phone. Every browser you have switched on
is listed under **Devices**, and any of them can be turned off from any of
them — useful for a machine you no longer have.

**Send a test** does exactly that. Worth using: between the switch and a notice
on screen sit a push service, an operating system and a notification daemon,
and any of them can swallow it without saying so.

## What gets announced

Inbound mail, to a mailbox you are allowed to read. Nothing else — not mail you
send, not mail in a mailbox you have no grant on.

The notice carries the sender and the subject. Clicking it opens that
conversation, reusing a Mailroom window if one is already open.

Several messages in one conversation replace each other rather than stacking
into a column of the same subject line.

## Requirements

| | |
| --- | --- |
| **https** | Web Push needs a secure connection. On plain http the page says so and the switch is off. `localhost` counts as secure. |
| **A modern browser** | Chrome, Edge, Firefox and Safari 16.4+. |
| **Outbound network** | The server has to reach the browsers' push services (Google, Mozilla, Apple). A locked-down egress firewall will block it. |

## What it is not

Not the live updates in the app — those are a separate stream over SSE, they
need no setup, and they are what makes the list fill in while you are looking
at it.

Not the [browser extension](/guide/extension) either. The extension is a
separate thing with its own API key and its own notifications; this one needs
nothing installed.

## When it stops working

A subscription that a push service reports as gone — somebody cleared their
browser data, or revoked the permission — is deleted on the spot, so it never
gets retried. One that merely fails is retried for a while and then dropped.

If notifications stop for you and nobody else, turn the switch off and on
again: that makes a fresh subscription.
