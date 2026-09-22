# Mailroom browser extension

Your [Mailroom](https://github.com/shahriyardx/mailroom) inbox in the toolbar.
One codebase, three browsers: Chrome, Firefox and Edge.

It holds the address of your instance and an API key you made, and calls your
server directly. Nothing passes through anybody else.

## What it does

- A desktop notification when mail arrives, and the unread count on the icon
- The list, the conversation, and every message in it
- Star, read, unread, archive, spam, delete
- Search, and the seven views the web app has
- Reply, reply to all and forward hand over to the dashboard with the
  composer already open — writing mail belongs where drafts, attachments and
  signatures are

## Building it

```sh
pnpm install

pnpm dev              # chrome, with reloading
pnpm dev:firefox

pnpm build            # one browser
pnpm build:all        # chrome, firefox and edge
pnpm zip:all          # store-ready archives
```

Output lands in `.output/<target>/`. From the repository root the same things
are `pnpm ext:dev`, `pnpm ext:build` and `pnpm ext:zip`.

### Loading a build

**Chrome / Edge** — `chrome://extensions` → Developer mode → Load unpacked →
`.output/chrome-mv3`.

**Firefox** — `about:debugging#/runtime/this-firefox` → Load Temporary
Add-on… → `.output/firefox-mv3/manifest.json`.

## How it is put together

```
entrypoints/
  background.ts     the alarm, the badge, the notifications
  popup/            the toolbar window, and the same page opened in a tab
  options/          connecting to an instance, and the preferences
components/         a miniature of the web app's kit, same tokens
lib/
  api.ts            the six endpoints this thing calls
  settings.ts       what is stored, and where
  sanitize.ts       turning a stranger's HTML into something safe to draw
```

MV3 on every target, including Firefox, so there is one background model to
reason about rather than two.

### Decisions worth knowing about

**A timer, not a live stream.** The web app holds an SSE connection open. An
MV3 background worker is stopped whenever the browser likes, so the same
connection would be cut within the minute and reconnect forever. An alarm
survives the worker dying.

**Host permission asked for at connect time.** A self-hosted instance has no
address that could be named in the manifest, so `optional_host_permissions`
covers http and https and the extension narrows the request to the one origin
you typed.

**`storage.local`, never `storage.sync`.** The API key is a credential, and
sync would copy it to every machine signed into the browser profile.

**No server changes.** Everything here runs against the public v1 API as it
already is. The one exception is `?reply=` on the dashboard's mail page, which
opens the composer on arrival, and which the web app ignores when it is not
there.

## Licence

PolyForm Noncommercial 1.0.0, the same as the rest of Mailroom.
