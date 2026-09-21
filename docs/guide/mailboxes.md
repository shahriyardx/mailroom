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

**Settings → Team.** You invite people by email, and an invitation is sent
from a mailbox you choose.

Each person gets a **role**, which decides what they can do:

| Role | Can |
| --- | --- |
| **Owner** | Everything, including billing-shaped settings and removing people |
| **Admin** | Manage domains, mailboxes, keys, webhooks and people |
| **Member** | Read and send from the mailboxes they are given |

Roles are about *what kind of thing* somebody can do. Which mail they can see
is separate, and is decided by the mailboxes granted to them.

## Scope switching

The switcher at the top of the mail view changes what you are looking at:

- **All mail** — every mailbox you can reach
- **One domain** — everything on `example.com`
- **One address** — just `you@example.com`

The folder list and the search follow whatever is selected, so "unread in
support@" is two clicks rather than a query.
