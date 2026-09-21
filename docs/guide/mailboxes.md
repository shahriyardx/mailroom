# Mailboxes and people

## Mailboxes

**Settings → Mailboxes.** A mailbox is one address on one of your domains.
There is no limit on how many you have.

| Setting | What it does |
| --- | --- |
| **Display name** | The name on outgoing mail from this address |
| **Signature** | Appended when you compose from this address |
| **Catch-all** | Collects every unclaimed address on the domain |
| **Default** | The address the composer opens with. Only one at a time |
| **Colour** | How the mailbox is marked in lists |

The address itself cannot be changed after it is made. Make a new mailbox
instead — renaming one would orphan the mail already threaded under it.

### Created on first use

A mailbox does not have to exist before you send from it. A key that reaches a
whole domain can send as `receipts@` on that domain, and the mailbox is
created the first time it does. SES already permits it, and nobody wants to
hand-create `noreply@` before a script can run.

## People

**Settings → People.** You invite somebody by email, and the invitation is
sent from a mailbox you choose.

An invited person sets a **password** — your colleagues do not each need a
GitHub account to read their own mail. Only the owner signs in with GitHub.

### Roles

| Role | Can |
| --- | --- |
| **Owner** | Everything an admin can, **plus** sending domains, the inbound worker, and handing the instance to somebody else |
| **Admin** | Mailboxes, people, teams, access, API keys, webhooks, labels, filters and the blocked list |
| **Member** | Read and send from the mailboxes they have been given, and nothing else |

The split follows who carries the consequences. Adding a domain changes what
the company can send as and touches DNS, so it stays at owner level.
Running the place day to day is an administrator's work.

There can be more than one owner: an owner may promote somebody else to it.

An owner's role can only be changed by another owner, and nobody can remove an
owner from the list.

### Access

Roles say *what kind of thing* somebody may do. **Which mail they can see is
separate**, and is decided under **Settings → Access**.

Grant a mailbox to a person, or to a **team** so that several people get it at
once. A team can have a **lead**, who may change that team's membership
without being an admin of the whole instance.

A member with no grants sees no mail at all. That is the intended starting
point: access is given, not assumed.

## Scope switching

The switcher at the top of the mail view changes what you are looking at:

- **All mail** — every mailbox you can reach
- **One domain** — everything on `example.com`
- **One address** — just `you@example.com`

The folder list and the search follow whatever is selected, so "unread in
support@" is two clicks rather than a query.
