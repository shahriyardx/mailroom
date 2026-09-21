# Sending

## One message

```ts
const sent = await mail.emails.send({
  from: "Support <support@yourdomain.com>",
  to: ["a@example.net", "b@example.net"],
  cc: "manager@example.net",
  bcc: "archive@yourdomain.com",
  reply_to: "noreply@yourdomain.com",
  subject: "Your order shipped",
  html: "<h1>On its way</h1>",
  text: "On its way",
  headers: { "X-Order-Id": "4821" },
});

console.log(sent.id, sent.ses_message_id, sent.thread_id);
```

`to`, `cc` and `bcc` take a string or an array, and `Name <address>` is
understood.

`from` has to be an address on a verified domain. A key that reaches a whole
domain can use any address on it — the mailbox is created the first time it
does.

## Attachments

```ts
import { readFile } from "node:fs/promises";

const pdf = await readFile("invoice.pdf");

await mail.emails.send({
  from: "receipts@yourdomain.com",
  to: "customer@example.net",
  subject: "Your invoice",
  html: '<p>Attached.</p><img src="cid:logo">',
  attachments: [
    {
      filename: "invoice.pdf",
      content: pdf.toString("base64"),
      content_type: "application/pdf",
    },
    {
      filename: "logo.png",
      content: logoBase64,
      content_id: "logo", // embeds it, rather than attaching it
    },
  ],
});
```

At most **20 files**, and 30 MB for the whole request. Base64 adds about a
third, so that is roughly 22 MB of actual file.

## Sending exactly once

```ts
await mail.emails.send(
  { from: "receipts@yourdomain.com", to: "a@b.c", subject: "Receipt #4821" },
  { idempotencyKey: "receipt-4821" },
);
```

Repeat the call with the same key and you get the first reply back, not a
second message. Keys last 24 hours.

Use something **meaningful** — `receipt-4821`, not a UUID made at call time. A
fresh UUID on a retry is a different key and protects nothing.

It also switches automatic retries on for that call, since repeating it is now
safe.

## Many at once

```ts
const result = await mail.emails.sendBatch([
  { from: "news@yourdomain.com", to: "a@example.net", subject: "Hi", text: "…" },
  { from: "news@yourdomain.com", to: "b@example.net", subject: "Hi", text: "…" },
]);

console.log(`${result.sent} sent, ${result.failed} failed`);

for (const item of result.data) {
  if (!item.ok) console.error(`#${item.index}:`, item.error);
}
```

Up to **100**. Every one is attempted, so one bad address does not throw the
rest away. This does **not** throw when some fail — check `result.failed`.

## Replying to a conversation

```ts
await mail.threads.reply(threadId, {
  text: "Refunded — sorry for the trouble.",
  reply_all: true,
});
```

Recipients, subject and the headers that keep it threaded come off the last
message. See [Reading mail](/sdk/reading#replying).

## What was sent

```ts
const page = await mail.emails.list({
  status: ["bounced", "complained"],
  since: new Date(Date.now() - 7 * 24 * 3600 * 1000),
  limit: 50,
});

for (const message of page.data) {
  console.log(message.to[0]?.address, message.status, message.error);
}
```

A `Date` is serialised for you. So is an array — `status` goes out
comma-separated.

## One send in full

```ts
const detail = await mail.emails.get(sent.id);

console.log(detail.status);     // "delivered" | "bounced" | …
console.log(detail.opened_at);  // when the tracking image loaded, or null
console.log(detail.events);     // every SES event seen for it
```

The SES message id works here too, which is what a bounce report or a webhook
hands you.

## A worked example

Receipts, with a per-order idempotency key and bounces logged:

```ts
import { Mailroom, isMailroomError } from "@shahriyardx/mailroom";

const mail = new Mailroom();

export async function sendReceipt(order: Order) {
  try {
    return await mail.emails.send(
      {
        from: "Receipts <receipts@yourdomain.com>",
        to: order.customerEmail,
        subject: `Receipt for order ${order.id}`,
        html: receiptHtml(order),
        headers: { "X-Order-Id": String(order.id) },
      },
      { idempotencyKey: `receipt-${order.id}` },
    );
  } catch (error) {
    if (isMailroomError(error) && error.code === "invalid_request") {
      // A bad address is the order's problem, not something to retry.
      await flagBadEmail(order.id, error.message);
      return null;
    }
    throw error;
  }
}
```
