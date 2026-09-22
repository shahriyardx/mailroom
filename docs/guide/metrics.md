# Metrics

**Settings → Metrics**, or **Metrics** in the campaigns view. The same screen
either way.

The email log answers *what happened to this message*. This answers the other
half: whether the account as a whole is healthy. A bounce rate means nothing
on its own — it means something against the volume it sits on and the
direction it is moving in.

## What is on it

| | |
| --- | --- |
| **Emails** | Everything sent in the window, one bar per day. Bounces sit on top of each bar rather than beside it: they are part of what was sent, not a second thing that happened. |
| **Delivered** | Of everything sent. |
| **Opened** | Of everything *delivered*. A message that bounced was never going to be opened. |
| **Bounce rate** | Mail SES could not deliver, split by the type it gave. |
| **Complaint rate** | People who pressed the spam button. |

Filter by domain and by how far back to look: 7, 15, 30 or 90 days. Both live
in the URL, so a view is a link you can send somebody.

## The two lines you must not cross

The dashed red line on each chart is Amazon's, not ours.

| | Under review | Suspended |
| --- | --- | --- |
| Bounce rate | 5% | above it |
| Complaint rate | 0.1% | above it |

That is why the rates carry two decimals. A complaint rate rounded to whole
percent reads 0% right up to the point the account is suspended.

::: tip A rising bounce rate is usually a list, not a server
Permanent bounces mean addresses that do not exist — an old list, or one
bought rather than collected. Transient means a full mailbox or a server
having a bad day, and fixes itself. The split on the card tells you which
you have.
:::

## What is counted

- Outbound mail only. Receiving has no delivery to rate.
- Drafts are not counted. Nothing has been attempted.
- [Test sends](/guide/test-mode) are left out everywhere. They never reach
  SES, so counting them would make every rate here a rate of something that
  did not happen.
- A complaint counts as delivered as well. It could not exist otherwise, and
  a deliverability rate that falls when somebody presses the spam button is
  measuring the wrong thing.
- Days are bucketed in UTC, and every day in the range gets a bar — including
  the ones nothing went out on.

## Where the numbers come from

Straight out of the message table and the SES events written against it, in
one pass, every time the page is opened. There is no nightly rollup and no
summary table: an instance that has to summarise its own mail before it can
draw a chart is an instance with a second set of numbers to keep in step.

Bounce and complaint figures need [delivery reporting](/guide/domains)
connected — without the SES event feed nothing ever tells this instance that
a message bounced, and the rate stays at zero while the bounces pile up.
