# Reading mail

Inbound mail lives in **threads**. A thread is the conversation; a message is
one item in it.

## The inbox

```ts
const inbox = await mail.threads.list({
  folder: "inbox",
  unread: true,
  limit: 20,
});

for (const thread of inbox.data) {
  console.log(thread.subject, thread.unread_count, thread.participants);
}
```

Filters: `folder`, `label` or `label_id`, `q`, `unread`, `starred`,
`has_attachments`, `participant`, `subject`, `since`, `until`, and
`mailbox_id` / `mailbox` / `domain` to narrow to part of the account.

## Paging

`listAll` holds the cursor for you:

```ts
for await (const thread of mail.threads.listAll({ folder: "inbox" })) {
  console.log(thread.subject);
  if (enough) break; // stopping early stops fetching
}
```

It is on `emails`, `threads`, `messages`, `contacts`, `suppressions`, and as
`webhooks.listAllDeliveries`.

Or hold it yourself:

```ts
let cursor: string | undefined;
do {
  const page = await mail.threads.list({ cursor, limit: 100 });
  await handle(page.data);
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

## One conversation

```ts
const thread = await mail.threads.get(id);

for (const message of thread.messages ?? []) {
  console.log(message.from.address, message.subject);
  console.log(message.text ?? message.html);
}
```

Pass `{ includeBody: false }` for a lighter reply when only the shape matters.

## Filing

```ts
await mail.threads.update(id, {
  folder: "archive",
  is_read: true,
  add_labels: ["Refunds"],      // by name or by id
  remove_labels: ["Needs reply"],
});
```

Only what you send is changed. An unknown label is a `ValidationError` and
**nothing is changed** — labels are resolved before anything is written, so
you never get an error next to a move that already happened.

```ts
// To the trash, and out of it for good on a second call.
await mail.threads.delete(id);
await mail.threads.delete(id, { permanent: true });
```

## Replying

```ts
await mail.threads.reply(id, {
  text: "Thanks — sorted.",
  reply_all: true,
  quote: true, // on by default
});
```

| Field | |
| --- | --- |
| `text`, `html` | One is required |
| `reply_all` | Also answer everyone else on the last message |
| `to`, `cc`, `bcc` | Replace the worked-out recipients |
| `subject` | Defaults to `Re: …` |
| `quote` | Append the message being answered. On by default |
| `attachments` | As on a normal send |

## Messages on their own

```ts
const unread = await mail.messages.list({
  direction: "inbound",
  unread: true,
  include_body: true,
});

await mail.messages.update(id, { is_read: true, is_starred: true });
```

Bodies are left out of a list unless you ask, because fifty of them is mostly
HTML you did not want.

## The original message

```ts
import { writeFile } from "node:fs/promises";

const eml = await mail.messages.raw(id); // Uint8Array of message/rfc822
await writeFile("message.eml", eml);
```

Only inbound mail has one. Outbound is assembled at send time and its wire
form is not stored.

## Attachments

```ts
const file = await mail.attachments.get(attachmentId);
console.log(file.filename, file.size_bytes);
console.log(file.download_url); // signed, good for 5 minutes

// Or the bytes, in one call:
const bytes = await mail.attachments.download(attachmentId);
```

Use `download_url` for anything large or headed to a browser — it goes
straight to storage and does not spend your rate limit.

## A worked example

An agent that answers unread support mail and files it:

```ts
import { Mailroom } from "@shahriyardx/mailroom";

const mail = new Mailroom();

for await (const thread of mail.threads.listAll({
  mailbox: "support@yourdomain.com",
  folder: "inbox",
  unread: true,
})) {
  const full = await mail.threads.get(thread.id);
  const last = full.messages?.at(-1);
  if (!last || last.direction === "outbound") continue;

  const answer = await draftReply(last.text ?? "");
  if (!answer) continue;

  await mail.threads.reply(thread.id, { text: answer });
  await mail.threads.update(thread.id, {
    is_read: true,
    folder: "archive",
    add_labels: ["Answered"],
  });
}
```
