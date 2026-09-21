# Managing the account

## Mailboxes

```ts
const boxes = await mail.mailboxes.list();
const box = await mail.mailboxes.get(id);

await mail.mailboxes.create({
  address: "billing@yourdomain.com",
  display_name: "Billing",
  signature: "— Accounts",
});

await mail.mailboxes.update(id, { signature: null }); // null clears it
```

The address cannot change. Make a new mailbox instead.

```ts
// Deletes the mail in it too, so the flag is required.
await mail.mailboxes.delete(id, { confirm: true });
```

Without `confirm` the API returns `409` and the SDK throws a `ConflictError`.

## Domains

```ts
const domain = await mail.domains.create("example.com");

for (const record of domain.records) {
  console.log(record.kind, record.name, "→", record.value, `(${record.purpose})`);
}
```

Only a key that reaches the whole account may add a domain.

Poll until it is ready:

```ts
async function waitForDomain(name: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const checked = await mail.domains.verify(name);
    if (checked.sending_enabled) return checked;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  throw new Error(`${name} did not verify in 20 minutes`);
}
```

`get`, `verify` and `delete` all take the **name** as well as the id.

```ts
await mail.domains.delete("example.com");                          // here only
await mail.domains.delete("example.com", { deleteInSes: true });   // and in SES
```

Deleting in SES cannot be undone, and other applications on the same AWS
account may be relying on that identity.

## Labels

```ts
const label = await mail.labels.create({ name: "Refunds", color: "#64748b" });
await mail.labels.update("Refunds", { color: "#0ea5e9" }); // by name works
await mail.labels.delete(label.id);                        // threads stay
```

Put one on a thread through the thread:

```ts
await mail.threads.update(threadId, { add_labels: ["Refunds"] });
```

## Contacts

```ts
for await (const person of mail.contacts.listAll({ order: "frequent" })) {
  console.log(person.address, person.message_count);
}
```

Only a key that reaches the whole account can read these — contacts are kept
per account, so there is no honest way to narrow them.

## Blocked addresses

```ts
const blocked = await mail.suppressions.list({ q: "example.net" });

await mail.suppressions.create({
  address: "unsubscribed@example.net",
  reason: "Asked to stop",
});

await mail.suppressions.delete("unsubscribed@example.net"); // id or address
```

Blocking an already-blocked address is not an error. Unblocking one that hard
bounced risks your sending reputation — see
[Blocked addresses](/api/suppressions).

## Webhooks

```ts
const hook = await mail.webhooks.create({
  url: "https://api.example.com/hooks/mail",
  events: ["mail.received", "email.bounced"],
  description: "Production receiver",
});

console.log(hook.secret); // shown once. Store it now.
```

An endpoint hears about the whole account unless it is scoped. Pass
`domain_id` for every address on one domain (including ones added later), or
`mailbox_id` for a single address. One or the other, never both.

```ts
await mail.webhooks.create({
  url: "https://api.example.com/hooks/acme",
  events: ["*"],
  domain_id: "dom_…", // everything sent from or to @acme.com
});
```

```ts
await mail.webhooks.update(id, { enabled: true });          // also clears failures
await mail.webhooks.update(id, { rotate_secret: true });    // new secret, once
await mail.webhooks.disable(id);                            // keep the history
await mail.webhooks.delete(id);                             // endpoint and history

const ping = await mail.webhooks.ping(id);
console.log(ping.succeeded, ping.status_code, ping.response_body);
```

A failed ping is a **result**, not a throw — the call worked, the endpoint did
not.

Catch an endpoint up after an outage:

```ts
for await (const delivery of mail.webhooks.listAllDeliveries({ succeeded: false })) {
  await mail.webhooks.replay(delivery.id);
}
```

## Statistics

```ts
const stats = await mail.stats.get({ days: 30 });

if (stats.sending.bounce_rate > 3) {
  await alert(`Bounce rate at ${stats.sending.bounce_rate}%`);
}

for (const day of stats.days) {
  console.log(day.day, day.sent, day.delivered, day.bounced);
}
```

`days` has a row for every day in the window, quiet ones included. Rates are
shares out of 100 — SES warns above **5** bounces and **0.1** complaints.

## An endpoint not yet wrapped

```ts
const custom = await mail.http.request<{ ok: boolean }>({
  method: "POST",
  path: "/some/new/endpoint",
  query: { limit: 10 },
  body: { hello: "world" },
});
```

The key, base URL, timeout, retries and error mapping all still apply.
