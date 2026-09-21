# How it fits together

Four moving parts. Knowing which one is at fault is most of debugging a mail
problem, so it is worth five minutes.

## The pieces

| Piece | What it does | Where it runs |
| --- | --- | --- |
| **The app** | The web UI, the API, the database | Your server, in Docker |
| **Amazon SES** | Hands your outbound mail to the internet | AWS |
| **The inbound worker** | Catches mail for your domains, posts it to the app | Cloudflare |
| **R2** | Holds attachments and raw messages | Cloudflare |

Postgres holds everything else, and is the only thing you have to back up
besides the R2 bucket.

## Sending

```
your code ──▶ POST /api/v1/emails ──▶ the app ──▶ SES ──▶ the internet
                                         │
                                         └──▶ Postgres (the message, its thread)
```

SES then reports what happened to the message — delivered, bounced,
complained, opened — through an **SNS topic** that posts back to the app. That
is what fills in a message's `status`, and what fires the `email.*`
[webhooks](/webhooks/events).

Delivery reporting only works when a message was sent with a **configuration
set** attached. Setting `SES_CONFIGURATION_SET` is what attaches it.

## Receiving

```
the internet ──▶ Cloudflare Email Routing ──▶ the inbound worker
                                                    │
                                                    ▼
                                    POST /api/inbound (signed) ──▶ the app
                                                                     │
                                                          ┌──────────┴────────┐
                                                          ▼                   ▼
                                                      Postgres            R2 (raw, files)
```

The worker is deployed **from the app**, under Settings → Inbound worker. You
paste a Cloudflare API token once; there is no `wrangler` step of your own.

Every call from the worker is signed with `INBOUND_WEBHOOK_SECRET`, so
nothing else can post mail into your instance.

## Live updates

The app uses Postgres `LISTEN`/`NOTIFY` with server-sent events, so a message
that arrives appears in an open browser without a refresh. Nothing polls.

## Where mail is threaded

An arriving message joins an existing thread if its `In-Reply-To` or
`References` matches one already stored. Failing that, an identical subject in
the same mailbox within thirty days joins it too. Otherwise it starts a new
thread.
