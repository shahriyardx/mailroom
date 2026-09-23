# Automations

A campaign goes to everybody at once. An **automation** starts when one person
does something, so its third email lands three days after *their* signup —
whenever that was.

Find it under **Campaigns → Automations**.

## The canvas

An automation is a flow drawn top to bottom: a trigger, then boxes, with
conditions branching into a **yes** side and a **no** side.

| Box | What it does |
| --- | --- |
| **Send an email** | Written in the same builder templates and campaigns use |
| **Wait** | Holds somebody here for a while |
| **Split on a condition** | Two ways on — one for yes, one for no |
| **Set a field** | Writes something onto the person that a later condition or a segment can ask about |
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

## What can be asked

A condition asks one of three things:

| | |
| --- | --- |
| **They opened the last email** | The most recent one Mailroom sent them |
| **They clicked the last email** | Same, for clicks — needs click tracking on in SES |
| **A field on them** | `plan is pro`, `city contains London`, `stage is empty` |

The fields are the same ones a [segment](/guide/campaigns#segments) uses, and
the same ones a CSV import brings in. A **Set a field** box earlier in the
flow is how you mark where somebody got to.

## Who gets put through it

Only people who **join after you switch it on**.

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

Somebody can only be in an automation once. Re-subscribing does not start a
second copy of the welcome series while the first is still running.

## The clock

A run is a row with a box and a date on it. There is no timer per person, so a
flow with a fortnight's wait in the middle costs the same as one with no wait
at all.

Boxes that take no time — a condition, a field write — are walked straight
through, so a person does not spend thirty seconds sitting on each one.

An email that fails to send is tried again in an hour rather than dropped.
Almost everything that fails is temporary, and abandoning the second email of
a welcome series over a blip is worse than being an hour late.

## Before you switch it on

- Every email box needs a body. An empty one is flagged on the canvas, and an
  empty email still goes out — blank.
- Your [postal address](/guide/campaigns#your-postal-address) is printed at
  the foot of every one of these, the same as a campaign.
- It starts as a **draft** and sends nothing until you press **Switch on**.
