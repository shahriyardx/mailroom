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

## How people get on a list

Four ways, and each records where the person came from.

| | |
| --- | --- |
| **By hand** | Paste addresses into the Add people dialog |
| **A CSV** | Drop a file on the same dialog |
| **Your own signup form** | `POST /api/v1/lists/:id/members` from your site's backend |
| **Someone else's system** | The same call, from whatever already knows about your users |

### The subscribe API

```sh
curl -X POST https://your-instance/api/v1/lists/lst_123/members \
  -H "Authorization: Bearer mk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"address":"ada@example.com","name":"Ada","consent_source":"footer signup form"}'
```

`consent_source` is **required**. It is the answer to "why am I getting this",
and a field you cannot forget to fill in is worth more than a field you can.

The reply says what happened to that person, because a signup form has to show
them something:

| `status` | Meaning |
| --- | --- |
| `subscribed` | New, and now on the list |
| `already` | They were already subscribed; nothing changed |
| `resubscribed` | They had left and have now signed up again |

A `409` means the address hard-bounced or reported a previous message. It is
**not** resubscribed by a form submission — the address is broken or its owner
reported you, and writing there again costs the deliverability of everybody
else on the list.

The key needs the `lists:write` scope. `DELETE` on the same path with
`{"address":"…"}` takes somebody off, and `GET /api/v1/lists` lists your lists.

::: warning The API needs a key
Every call to `/api/v1/lists` needs one, so a form on your website posts to
**your own backend**, which then calls this.

There is also a **hosted signup page** with no key and no account — see below.
It is off for every list until you switch it on, because a keyless endpoint
anybody can find will be filled with junk addresses within a week, and junk
addresses are what get a sender blocked.
:::

### The hosted signup page

Open a list and turn on **Give this list a signup page**. The address shown
next to the switch is a plain page anybody can open:

```
https://your-instance/subscribe/lst_123
```

It is plain HTML that posts to itself — no JavaScript, so it works wherever
you link it from. Off, that address returns a 404 rather than an explanation:
confirming which list ids exist to anybody who guesses is not information
worth handing out.

None of its answers say whether the address was already on the list. "You are
already subscribed" on a public form is a way to find out who is on it, one
guess at a time.

### Putting the form on your own site

The same page, in an iframe. Turn the signup page on and the snippet is under
the switch, ready to paste:

```html
<iframe src="https://your-instance/subscribe/lst_123?embed=1"
        title="Subscribe" width="100%" height="320"
        style="border:0" loading="lazy"></iframe>
```

`?embed=1` drops the card, the centring and the background, so it takes the
styling of the page around it instead of looking like a window onto somewhere
else.

An iframe rather than a form you paste and point at us. A pasted form sends
the reader away from the page they were on to see "you are subscribed" on your
instance; the frame answers where it stands. It also keeps working when the
form changes.

::: tip It needs no JavaScript
The frame is a plain HTML form that posts to itself, so it works behind a
content blocker and on a static site.
:::

### Double opt-in

Turn on **Make people confirm by email** and a new signup lands as
`pending` instead of `subscribed`. They are sent one email with a link, and
until they click it they are in no audience and get nothing.

It costs you roughly half your signups. It is worth it: a form without it is a
way for a stranger to sign somebody else up, and that person reports your next
campaign as spam — which is counted against every other message from your
domain.

The confirmation link works twice. Mail providers run link scanners that
follow every URL in a message before the reader sees it, so the second visit
is usually not even a person.

## Segments

A segment is a **question about a list**, not a copy of one.

| It can ask about | Examples |
| --- | --- |
| Engagement | Opened nothing in the last 30 days; clicked a campaign |
| Their details | Address contains, name is set, joined after a date |
| Status | Subscribed, not confirmed, unsubscribed, bounced |
| Tags | Has `vip`; does not have `customer` |
| Merge fields | `plan is pro`, `city contains London` |

The rules are stored and run **at send time**, never before. A stored list of
members goes quietly stale — somebody who unsubscribed on Tuesday is still in
Monday's copy of it, and they get mailed.

The builder counts how many people match as you type, because a segment is a
question and the only way to know it is the right one is the answer.

A campaign aimed at a segment that matches nobody is **refused with a reason**
rather than sent to nobody.

Segments live on the page of the list they are about, under **Segments of this
list** — which is where you are when you think of one, and where the people
they describe already are.

::: tip A segment about status is for looking, not sending
Mail only ever goes to people who are subscribed. A segment of unconfirmed
people is useful for seeing how many are stuck there; a campaign aimed at one
is refused rather than sent. The count for such a segment includes them, or it
would answer "0" to "who has not confirmed yet" and look like a broken rule.
:::

Tags are put on people by an [automation](/guide/automations) — an **Add or
remove a tag** box — and shown beside each person on the list's own page.

## Testing two subject lines

Fill in **Subject B** in the campaign panel. That is the whole switch — there
is nothing else to turn on.

The audience is split in half by a stable hash of the recipient, so both sides
are the same size and the same person always lands on the same side. The
campaign's report shows the open rate for each.

::: tip A difference of a point or two is noise
On a list of a few hundred, an A/B result only means something when it is
large. Two subject lines that land within a few points of each other have told
you they are equally good.
:::

## Sending it again to the people who never opened it

On a finished campaign's report, **Send again to non-openers** makes a new
draft aimed at exactly the people who were sent the original and never opened
it.

Its audience comes from that campaign's own recipients rather than from the
list, because somebody who joined afterwards was never sent the first one, and
a reminder about an email you never received is nonsense.

It is a **draft**, not a send. The point is to change the subject line —
sending the identical email to the same inbox twice is how you teach a mailbox
provider to filter you.

### Uploading a file

Drop a CSV on the **Add people** dialog, or pick one. It is read in your
browser and its contents put in the box, so you can see what you are about to
add before anything is written.

Three shapes are understood:

| The file | What happens |
| --- | --- |
| One address per line | Each becomes a person with no name |
| `ada@example.com, Ada Lovelace` | The part after the comma becomes the name |
| A CSV with a header row | Columns named `email` and `name` are found wherever they sit |

Quoted fields are handled, so `"Lovelace, Ada",ada@example.com` is a name and
an address rather than three broken columns — which is what every export from
every other tool looks like.

Any **other** column in a file with a header is kept as a merge field, so an
export carrying a plan or a city can be used in a subject line without
reshaping the file first.

### Taking them back out

**Export** on a list's page downloads everybody on it as a CSV — addresses,
names, status, tags, where the consent came from and when, and one column per
merge field. The download icon beside a segment exports only the people that
segment describes.

It is the same shape the importer reads, so a file exported here goes straight
back in, here or anywhere else. A tool that imports and does not export is one
you should think twice about putting a list into.

::: tip Re-importing is safe
Somebody already on the list is left exactly as they are. Importing last
month's file again will **not** resubscribe anybody who has left since — which
is the most common way a sender ends up in a spam folder, and it is always an
accident.
:::

## Writing a broadcast

A broadcast is saved as a **draft** first. Sending is a separate press, because
it is the one thing here that cannot be taken back.

Anything in double braces is filled in per person, in the subject and in the
body:

| | |
| --- | --- |
| <code v-pre>{{name}}</code> | Their name, or **there** if you have none |
| <code v-pre>{{address}}</code> | Their email address |
| <code v-pre>{{plan}}</code>, <code v-pre>{{city}}</code>, … | Any merge field they carry |
| <code v-pre>{{unsubscribe}}</code> | The link that takes them off this list |

Merge fields are whatever an import, an API call or an automation's **Set a
field** box put on somebody. The builder lists the ones the people on this
list actually have, next to the subject — click one to copy it.

Capitalisation and spacing do not matter: a column headed `Plan Name` is
reached by <code v-pre>{{plan name}}</code>, <code v-pre>{{plan_name}}</code>
or <code v-pre>{{planname}}</code>. An export's header is not something
anybody should have to reproduce exactly in a subject line.

### When somebody does not have it

Say what to use instead after a `|`:

```
Your {{plan|free}} plan renews on the {{renews|1st}}
```

With no fallback, a field nobody has becomes **nothing** — the sentence closes
up around it. What it never does is reach the reader as `{{plan}}`, which is
the one outcome that cannot be explained away.

::: tip Send yourself a test first
A fallback is only ever exercised by the people who are missing the field, and
they are the ones you are not looking at while you write.
:::

Values are escaped on their way into an HTML body, so a city of
`<b>London</b>` arrives as text rather than as markup. They came from a
spreadsheet somebody else exported; they are not trusted to be HTML.

Leave <code v-pre>{{unsubscribe}}</code> out and a plain one is added at the bottom. There is no
way to send without it, and that is deliberate.

### View in browser

Put <code v-pre>{{view_in_browser}}</code> in a campaign and it becomes a link
to a web copy of that message. It is also on the campaign's report, as **Web
copy**, for putting a newsletter somewhere that is not an inbox.

The page needs no sign-in — somebody whose mail client mangled your layout is
by definition not a user of your instance. Its link is signed rather than
stored, so one dug out of a year-old email still works, and it is marked
`noindex`: a campaign is not a page anybody asked to publish.

The link carries the **campaign**, not the reader. It is the link in an email
most likely to be forwarded, and one that identified the person it was sent to
would hand their row to whoever it reached. So the web copy is not
personalised — a greeting reads "Hi there".

A draft has no web copy. A link that worked before a campaign was sent would
be a way to read one early.

## The report

A campaign that has started opens as its report rather than in the builder.
What went out is what went out, and an editor over it would be offering to
change history.

| | |
| --- | --- |
| Sent, failed, skipped | What happened to each copy |
| Opened, clicked | People, not events — a newsletter forwarded round an office is one reader |
| Unsubscribed | Who this campaign cost you |
| Bounced, complained | Fed back from SES, often hours later |
| Links | How many **people** followed each one |

Every rate is over the number **sent**, not the number delivered. Sent is the
number you pressed a button for; dividing by delivered is the flattering
version most tools quietly use.

::: warning Clicks need switching on in SES
Link tracking is done by SES rewriting the links in your message, which it
only does when the configuration set says to. Without it the Links panel stays
empty — Mailroom never sees a click.

Nothing here is a redirect of our own, deliberately. A tracking domain has to
answer forever or every link in every email you have ever sent breaks.
:::

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

## Choosing what you get

Put <code v-pre>{{preferences}}</code> in a campaign or an automation and it
becomes a link to a page of switches — one per list that address is already
on. It is also offered on the unsubscribe page, **after** they have left,
never instead of leaving.

That ordering is the whole point. Making somebody manage preferences in order
to unsubscribe is the trick that produces spam reports, and a spam report
costs you the deliverability of everybody else on the list. They are off the
list before the page loads; the other lists are something they may now want to
look at.

Clearing every box stops all of it, so "unsubscribe from everything" needs no
button of its own.

::: warning It can never add somebody to a list
Only lists that address is already known to are shown. A preference centre
that offered new ones would be a signup form wearing a different hat, and this
page is reached from a link rather than from a decision to join anything.

An address that hard-bounced or reported you is shown but locked. A spam
report is not a preference, and a forwarded link must not be able to undo one.
:::

## Your postal address

Set it in **Settings → Company**. It is printed at the foot of every campaign
and every automation.

This is not decoration. US CAN-SPAM requires a valid physical postal address
in commercial email, and Gmail's bulk sender rules lean on the same thing.

Campaigns still send without one — Mailroom is not the right place to block
your work — but every campaign screen will keep saying so until it is filled
in.

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
