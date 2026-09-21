# The send queue

A message that has not gone out yet lives in a queue: one SES could not take
right now, and one that was scheduled for later. Both are the same problem — a
message that exists and has not been sent — so both are the same table, and
the worker carrying them cannot tell them apart.

## Why it exists

Handing a message to SES used to be one attempt. If SES throttled the account,
or the socket broke, or AWS had a bad minute, the send failed and the message
was gone. That is the wrong answer for the one thing an email service is for.

## What is retried, and what is not

A refusal that will still be true in an hour is final, and the send fails
immediately with nothing recorded:

- an unverified identity
- a malformed address
- a suspended or paused account
- credentials that are not valid

Anything else is a *not right now*, and goes into the queue:

- throttling, and quota limits
- an SES outage, or any `5xx`
- a dropped or refused connection, a DNS failure, a timeout

## What happens then

The attempt gap widens each time — about 30 seconds, then a minute, two, four,
eight, and then a quarter of an hour — with a little randomness so a hundred
messages queued by one outage do not all wake at once. After eight attempts,
roughly three quarters of an hour, it gives up: the message is marked `failed`
with the reason on it, and an `email.failed` webhook fires.

While it waits, the message sits in Sent marked `queued`, and you can
[call it off](/api/emails#call-one-off).

## Where the worker runs

Inside the web process. A self-hosted instance is usually one container, and a
queue that needs a scheduler wired up separately is a queue that silently does
nothing for everyone who skipped that step.

Running more than one container is still fine. Jobs are claimed with
`FOR UPDATE SKIP LOCKED`, so each worker takes rows no other worker is
holding, rather than two of them sending the same message twice.

Set `OUTBOX_WORKER=false` to turn it off and drive the queue from somewhere
else instead.

::: tip It is at-least-once, not exactly-once
If a container is killed in the moment between SES accepting a message and the
row being written, the job looks unfinished and is tried again — which sends
that message twice. The window is milliseconds wide, and the alternative
would be losing a message every time a container restarts.
:::
