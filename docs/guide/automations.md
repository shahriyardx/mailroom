# Automations

A campaign goes to everybody at once. An **automation** starts when one person
does something, so its third email lands three days after *their* signup —
whenever that was.

Find it under **Campaigns → Automations**.

## What starts one

A new automation is an empty canvas with one thing on it: **Start with a
trigger**. There are two.

| Trigger | Starts when |
| --- | --- |
| **Somebody joins a list** | They subscribe — by hand, by import, through the API, or through the signup page |
| **An event you post** | Your own code calls the API to say something happened to somebody |

The first covers a welcome series. The second covers everything else a
product wants to say, because only the product knows it happened: a trial
ending, an order shipping, a card being declined.

Both kinds name a list. For a joining trigger it is the list to watch; for an
event it is where those people live, which is what unsubscribe links and
merge fields are read from.

Either kind can be narrowed to a **segment** — *only if they match* on the
trigger card. The rules are asked at the moment somebody would be put in, so
a flow for "people on the pro plan" is right on the day it runs rather than
on the day the segment was written. An event for somebody outside the segment
comes back `skipped`, naming the segment.

::: warning You cannot switch one on until the trigger is answered
A half-answered trigger — an event flow with no event, either kind with no
list — leaves the **Switch on** button disabled and the trigger card marked in
amber. It is the one thing that cannot be discovered later, because "nothing
happened" looks the same either way.
:::

## Events

An event is a name your own code posts, listed under **Campaigns → Events**.

Declare one there, or simply post it — an event arriving under a name nobody
declared is recorded anyway, marked **Not declared**, because that is the
answer to "why did my flow not run" and it can only be given if it was kept.
Names are lowercased and tidied on the way in, so `Trial.Ended` and
`trial.ended` are the same event.

```bash
curl -X POST https://mail.example.com/api/v1/events \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "event": "trial.ended",
        "email": "person@example.com",
        "fields": { "plan": "pro" },
        "consent_source": "signed up at checkout"
      }'
```

The key needs the **Events** scope. What comes back names every automation
that heard it and what happened to that person in each:

```json
{
  "event": "trial.ended",
  "declared": true,
  "matched": 1,
  "automations": [
    { "id": "aut_…", "name": "After the trial", "status": "started" }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `started` | They are at the top of the flow |
| `restarted` | They had finished it before; they are back at the top |
| `already_running` | They are part-way through it, so nothing was done |
| `skipped` | Nothing happened, and `reason` says why |

`fields` are merged onto the person before the flow starts, so the first
email can say the order number and the first condition can read the plan.
Merged, not replaced — an event about one thing does not wipe what is known
about everything else.

::: tip consent_source is what adds somebody
An address nobody on the list has heard of is **skipped**, not added. An event
carrying an email is not that person asking for mail. Send `consent_source`
with it — the same field the subscribe endpoint requires — and they are added
first, and the flow starts.

On a double opt-in list they are added as *pending* and the flow waits: they
have to confirm first, which is the whole point of that setting.
:::

Unlike a joining trigger, an event can fire for the same person again and
again. A finished run starts over; a run still going is left alone rather
than doubled up.

## The canvas

An automation is a flow drawn top to bottom: a trigger, then boxes, with
conditions branching into a **yes** side and a **no** side.

| Box | What it does |
| --- | --- |
| **Send an email** | Written in the same builder templates and campaigns use |
| **Call a webhook** | Tells your own server that somebody got here |
| **Wait** | Holds somebody here — for a length of time, or until a date |
| **Split on a condition** | Two ways on — one for yes, one for no |
| **Wait for an event** | One way if the event arrives in time, the other if it does not |
| **Split at random** | Sends a share of people each way, to test two versions |
| **Set a field** | Writes something onto the person that a later condition or a segment can ask about |
| **Add or remove a tag** | Puts a label on them, or takes one off |
| **Copy or move to another list** | Puts them on a second list, with or without leaving this one |
| **Take them off the list** | Ends their journey here |

Nothing is dragged. Every arrow carries a **+**, empty branches included, and
whatever that arrow pointed at becomes the new box's own next — so inserting
in the middle never leaves anything unattached, and removing a box joins the
flow back up around the gap instead of severing everything below it.

::: tip Why you cannot move the boxes
The picture is worked out from the shape of the flow, not stored. Saved
positions drift: somebody drags a box, somebody else inserts one above it, and
the arrows cross. Laid out automatically the picture is always readable and
there is nothing to keep tidy.

The price is one rule — **branches never rejoin**. A box has one box before
it, which is what makes the flow a tree and a tree is what can be laid out.
:::

Click any box to open its settings beside the canvas. Drag the background to
move around, and use the zoom control in the corner for a flow that has
outgrown the window.

## Waiting for a while, or waiting for a date

A **Wait** box does one of two things, and the difference matters.

| | |
| --- | --- |
| **For a while** | Counted from the moment *that person* reaches the box. A hundred people reach the next box at a hundred different times |
| **Until a date** | The same instant for everybody waiting there |

Use the second one for anything with a date attached — a launch, a webinar,
an announcement. Somebody who joined in March and somebody who joined an hour
before all move on together at the moment you set.

Anybody who reaches the box *after* that moment has passed walks straight
through. Holding them until the same date next year is the only other
option, and nobody means that.

If you change how long a wait is, the people already sitting on it follow the
new length too. It is counted from when each of them arrived.

## Waiting for an event

A **Wait for an event** box holds somebody until one of two things happens:

| | |
| --- | --- |
| **Arrived** | Your code posts the event for them while they are on the box. They go down this side at once |
| **Timed out** | The time you set runs out first. They go down this side |

This is what a cart-recovery flow is built on: wait up to a day for
`order.placed`, thank the ones who bought, and nudge the ones who did not.

Only an event that arrives *while they are on the box* counts. One that came
before they got there is not saved up for them.

## Testing two versions

**Split at random** sends each person one way or the other by chance. You set
the share — 50/50, or 90/10 to try something new on a few people first.

Put a different email on each side. The numbers on each email box then tell
you which version gets more opens and clicks.

## Calling your own server

**Call a webhook** sends a `POST` to a URL you choose, with the person's email,
name, fields and tags as JSON:

```json
{
  "event": "automation.step",
  "automation": { "id": "aut_…", "name": "Welcome" },
  "step": "atn_…",
  "person": { "email": "person@example.com", "name": "Ada", "fields": {}, "tags": [] },
  "at": "2026-09-26T10:00:00.000Z"
}
```

It is signed in the `X-Mailroom-Signature` header, the same way as your
account's [webhooks](/webhooks/). Each automation has its own signing
secret, shown on the box. The URL must be `https` and a public address.

An answer that is not `2xx` counts as a failure and is tried again, the same
as an email that fails.

## Tags, and other lists

**Add or remove a tag** puts a label on somebody: `customer`, `vip`,
`webinar-march`. A tag is a set they are in or out of, so adding one twice
does nothing and removing one they never had is not an error. Tags show on
the list's own page, a [segment](/guide/campaigns#segments) can ask about
them, and so can a condition further down the same flow.

**Copy or move to another list** does what it says, and the difference is
what happens here:

| | |
| --- | --- |
| **Copy** | They go on the other list *and* stay on this one, carrying their name, fields and tags. The flow carries on |
| **Move** | They go on the other list and come off this one. This flow follows this list, so their journey here ends at that box |

Moving marks them off the list rather than deleting them, so everything ever
sent to them is still in the reports. If the other list asks people to confirm
by email, they arrive there as *not confirmed* and are sent the confirmation
— being copied is not a way around that setting.

## Letting people out early

A flow is usually trying to make something happen — a purchase, an upgrade, a
booking — and the worst thing it can do is keep writing to somebody after
they have already done it.

**Stop early when**, on the trigger card, says when to let them out. Two ways,
and both can be set:

| | |
| --- | --- |
| **They match a segment** | Checked before every step. Tag somebody `customer` when they buy, and a flow watching that segment drops them at the next step rather than at the end |
| **An event arrives** | Checked the moment it lands. `order.placed` ends the cart-recovery flow that second, not two days later at the next email |

The run is marked **stopped** with the reason, so the record of how far they
got survives.

## What can be asked

A condition asks one of three things:

| | |
| --- | --- |
| **They opened the last email** | The last one **this flow** sent them |
| **They clicked the last email** | Same, for clicks — needs click tracking on in SES |
| **A tag on them** | Whether they carry `customer`, `vip`, and so on |
| **A field on them** | `plan is pro`, `city contains London`, `stage is empty` |
| **Whether they match a segment** | Anything the segment language can ask, as one question |
| **Whether they are on another list** | Asked by email address, counting only people still subscribed there |

A condition placed before the flow has sent anything takes the **no** branch:
they were never written to, so they did not open it.

**Whether they match a segment** is the one worth knowing about: it borrows
the whole rule language rather than growing a second one here, so a condition
can ask "opened nothing in the last thirty days", "joined before March",
"has the tag `vip`" or any combination, without any of that being rebuilt on
the canvas.

The fields are the same ones a [segment](/guide/campaigns#segments) uses, and
the same ones a CSV import brings in. A **Set a field** box earlier in the
flow is how you mark where somebody got to.

## Who gets put through it

On a **joining** trigger, only people who **join after you switch it on**.

Switching on a welcome series must not send a welcome to ten thousand people
who have been subscribers for two years, so enrolment starts from the moment
the automation was created.

Everybody who joins the list from then on is put in, however they joined — by
hand, by import, through the API, or through the signup page. On a
double opt-in list that means when they *confirm*, not when they ask.

| What happens | Result |
| --- | --- |
| They unsubscribe part-way through | They stop where they are; nothing more is sent |
| You pause the automation | Sending stops, nobody loses their place, and it resumes on unpause |
| You delete a box they are sitting on | They move on to the next one |
| You delete the whole automation | Everybody in it stops. Mail already sent is unaffected |

Somebody can only be in an automation once at a time. Re-subscribing does not
start a second copy of the welcome series while the first is still running,
and neither does a second event while the first run is going.

## How each email did

Every email an automation sends is recorded, so each box carries its own
numbers — **sent**, **opened**, **clicked** — on the card and in its pane.
That is the sentence worth reading on this screen: the second email gets half
the opens of the first, and the third barely any.

Opens are the tracking pixel and mean "it was loaded", not "it was read".
Clicks need click tracking switched on in SES.

## Only sending at set hours

On the trigger card, **Only send email between** sets the hours and days email
may go out, in a time zone you choose. For example, 9:00 to 17:00, Monday to
Friday, in `Europe/London`.

Somebody who reaches an email outside those hours waits there until the window
opens. Everything else in the flow — waits, conditions, tags — still runs
straight away, because none of it lands in an inbox.

A window that starts later than it ends, such as 22:00 to 06:00, runs over
midnight.

## Who is in it

Every box with people on it carries a small count in its corner. Click it to
see who they are.

**People**, at the top right of the canvas, lists everybody the flow has put
through it:

- where each person is now, and until when
- what the flow sent them, and whether they opened or clicked it
- why anybody stopped: they left the list, they reached the goal, an email
  kept failing

You can take one person out of the flow from there. They stay on the list,
and they are not put back in if they join again.

## A test run

**Test run**, at the top right of the canvas, walks one person through the
flow on paper. Type an address, and the path they would take lights up on the
canvas, with each step written out beside it.

Nothing is sent, written or called. Their real fields, tags and segments
answer the questions they can. You answer the rest: whether they open the
emails, whether the events they wait for arrive, and which way a random split
sends them.

## Copying one

The copy button on an automation's row, or beside **Switch on**, makes a copy
of the whole canvas. The copy starts as a draft with nobody in it, so it sends
nothing until you switch it on.

## Warnings on the canvas

A box turns amber when it will run but not do what you meant:

- an email with nothing written in it
- **Opened the last email?** straight after the email, with no **Wait** in
  between — nobody has had time to open it, so the answer is always no
- **Opened the last email?** with no email before it at all
- a **Wait for an event** with no event, or a webhook with no URL

## The clock

A run is a row with a box and a date on it. There is no timer per person, so a
flow with a fortnight's wait in the middle costs the same as one with no wait
at all.

Boxes that take no time — a condition, a field write — are walked straight
through, so a person does not spend thirty seconds sitting on each one.

An email or webhook that fails is tried again rather than dropped: after 15
minutes, then 1 hour, 4 hours and 12 hours. Almost everything that fails is
temporary, and abandoning the second email of a welcome series over a blip is
worse than being late. After the fifth failure the person is stopped, with the
error as the reason, so a broken address does not retry forever.

A busy flow is not held back by a fixed batch size. Each pass keeps going
until nobody is due, so an import of thousands onto a welcome list starts
straight away. The [hourly sending limit](/guide/campaigns#slowing-it-down-on-purpose) still applies.

## Before you switch it on

- Every email box needs a body. An empty one is flagged on the canvas, and an
  empty email still goes out — blank.
- Your [postal address](/guide/campaigns#your-postal-address) is printed at
  the foot of every one of these, the same as a campaign.
- It starts as a **draft** and sends nothing until you press **Switch on**.
