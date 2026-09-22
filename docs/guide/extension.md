# Browser extension

Your inbox in the toolbar, for Chrome, Firefox and Edge. It tells you when
mail arrives, shows the conversation, and hands you back to the dashboard the
moment you want to write something.

It lives in [`packages/extension`](https://github.com/shahriyardx/mailroom/tree/main/packages/extension)
and talks to your own instance over the public API. Nothing passes through
anybody else, because there is no anybody else: the extension holds an API key
you made, and calls your server directly.

## What it does

| | |
| --- | --- |
| **Notifications** | A desktop notification for new unread mail, and the count on the toolbar icon |
| **Reading** | The list, the conversation, every message in it, attachments named |
| **Triage** | Star, mark read or unread, archive, report spam, delete |
| **Search** | The same full-text search the web app uses |
| **Views** | Inbox, Unread, Starred, Sent, Archive, Spam, Trash |
| **Mailboxes** | Watch every address the key reaches, or pick one |

Writing is deliberately not in the popup. **Reply**, **Reply to all** and
**Forward** open the conversation in the dashboard with the composer already
up, so you get drafts, attachments and your signature instead of a worse
version of all three in a 400-pixel box.

## Installing it

There is no store listing yet, so it is loaded from a build.

```sh
pnpm install
pnpm ext:build          # chrome, firefox and edge, all three
```

The output lands in `packages/extension/.output/`.

::: code-group

```txt [Chrome and Edge]
1. Open chrome://extensions (edge://extensions)
2. Turn on Developer mode
3. Load unpacked → packages/extension/.output/chrome-mv3
```

```txt [Firefox]
1. Open about:debugging#/runtime/this-firefox
2. Load Temporary Add-on…
3. Pick packages/extension/.output/firefox-mv3/manifest.json
```

:::

`pnpm ext:zip` produces store-ready archives instead, and `pnpm ext:dev`
starts a browser with the extension loaded and reloading as you edit.

## Connecting it

The extension asks for two things, once.

1. **Address** — where your Mailroom lives, for example
   `https://mail.example.com`.
2. **API key** — from [Settings → API keys](/guide/api-keys).

The key needs `mail:read` to show anything, and `mail:write` for the triage
buttons. The **Inbox agent** preset is exactly right; **Read only** works too
if you would rather the extension could not change anything.

Reach works as it does everywhere else: a key restricted to one address shows
one address.

### Which mailboxes it watches

**Every mailbox** is its own switch, on by default, and it means every
mailbox — including addresses you add months from now, without coming back to
this screen.

Turn it off and you get your own list, which starts empty. Tick the addresses
you want; leave it empty and the extension watches nothing at all, shows an
empty popup and announces nothing. That is allowed, and it says so on screen.

The two are kept apart on purpose. "All of them, whatever they turn out to be"
and "these six" look identical on the day you choose them and differ on the
day a seventh address is made — so ticking every box by hand does **not**
silently become "every mailbox", and unticking your last box does not silently
become it either.

### The permission prompt

The browser will ask whether the extension may reach that address. It has to:
a self-hosted instance has no address that could be declared up front, so the
permission is requested for your origin only, at the moment you connect. Say
no and there is nothing to read.

## Where the key is kept

In `storage.local`, in that browser profile, on that machine. Not in
`storage.sync` — that would copy a credential to every machine signed into the
same browser account, including ones you never meant to read mail on.

Treat it like any other key: if the machine is shared or lost, revoke it in
**Settings → API keys** and the extension stops working immediately.

## How new mail is noticed

A timer, every two minutes by default, adjustable from one minute to an hour.

Not a live stream, though the web app uses one. An extension's background
worker is stopped by the browser whenever it feels like it, so a held-open
connection would be cut within the minute and spend its life reconnecting. An
alarm survives the worker being stopped, which is the property that matters
here.

The first check after connecting is taken as the starting point rather than
announced, so pasting a key does not produce a notification for every unread
message you already dealt with elsewhere.

## Reading a message safely

Message bodies are sanitised, then drawn inside a sandboxed frame that is not
allowed to run scripts. Remote images are held back until you ask for them,
the same as in the web app — a remote image in mail is a tracking pixel about
as often as it is a picture.
