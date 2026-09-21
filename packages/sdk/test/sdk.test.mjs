import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Mailroom,
  NotFoundError,
  RateLimitError,
  ValidationError,
  constructWebhookEvent,
  isMailroomError,
  signWebhookPayload,
  verifyWebhook,
} from "../dist/index.js";

const KEY = "mk_live_test";

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(replies) {
  const calls = [];
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const { status = 200, body = {}, headers = {} } = next;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  };
  return { fetch, calls };
}

function client(replies, options = {}) {
  const { fetch, calls } = fakeFetch(replies);
  return {
    mail: new Mailroom({ apiKey: KEY, baseUrl: "https://m.test", fetch, ...options }),
    calls,
  };
}

test("the base URL gains /api/v1 when it is left off", () => {
  const { mail } = client({ body: {} });
  assert.equal(mail.baseUrl, "https://m.test/api/v1");

  const withSuffix = new Mailroom({
    apiKey: KEY,
    baseUrl: "https://m.test/api/v1/",
    fetch: async () => new Response("{}"),
  });
  assert.equal(withSuffix.baseUrl, "https://m.test/api/v1");
});

test("a missing key or URL is refused before any call is made", () => {
  assert.throws(() => new Mailroom({ baseUrl: "https://m.test", apiKey: "" }), /API key/);
  assert.throws(() => new Mailroom({ apiKey: KEY, baseUrl: "" }), /base URL/);
});

test("send posts the body and carries the key", async () => {
  const { mail, calls } = client({ status: 202, body: { id: "msg_1", to: ["a@b.c"] } });
  const sent = await mail.emails.send({ from: "me@m.test", to: "a@b.c", subject: "Hi" });

  assert.equal(sent.id, "msg_1");
  assert.equal(calls[0].url, "https://m.test/api/v1/emails");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    from: "me@m.test",
    to: "a@b.c",
    subject: "Hi",
  });
});

test("an idempotency key becomes a header", async () => {
  const { mail, calls } = client({ status: 202, body: {} });
  await mail.emails.send({ from: "a@m.test", to: "b@c.d" }, { idempotencyKey: "order-42" });
  assert.equal(calls[0].init.headers["Idempotency-Key"], "order-42");
});

test("query values are encoded, and empty ones are left out", async () => {
  const { mail, calls } = client({ body: { object: "list", data: [], has_more: false } });
  await mail.emails.list({
    status: ["bounced", "complained"],
    opened: true,
    since: new Date("2026-01-02T03:04:05.000Z"),
    limit: 50,
    subject: undefined,
  });

  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get("status"), "bounced,complained");
  assert.equal(query.get("opened"), "true");
  assert.equal(query.get("since"), "2026-01-02T03:04:05.000Z");
  assert.equal(query.get("limit"), "50");
  assert.equal(query.has("subject"), false);
});

test("an error reply becomes the class that matches its status", async () => {
  const { mail } = client({ status: 404, body: { error: "No such thread", code: "not_found" } });
  await assert.rejects(mail.threads.get("thr_missing"), (error) => {
    assert.ok(error instanceof NotFoundError);
    assert.ok(isMailroomError(error));
    assert.equal(error.code, "not_found");
    assert.equal(error.status, 404);
    assert.equal(error.message, "No such thread");
    return true;
  });
});

test("a 422 keeps the field the server objected to", async () => {
  const { mail } = client({
    status: 422,
    body: { error: "to: Required", code: "invalid_request", param: "to" },
  });
  await assert.rejects(mail.emails.send({ from: "a@m.test", to: "" }), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.param, "to");
    return true;
  });
});

test("a GET is retried after a 429 and the second reply is used", async () => {
  const { mail, calls } = client(
    [
      {
        status: 429,
        body: { error: "Too many requests", code: "rate_limited" },
        headers: { "Retry-After": "0" },
      },
      { status: 200, body: { object: "list", data: [{ id: "lbl_1" }], has_more: false } },
    ],
    { maxRetries: 1 },
  );

  const page = await mail.labels.list();
  assert.equal(calls.length, 2);
  assert.equal(page.data[0].id, "lbl_1");
});

test("a POST without an idempotency key is not repeated", async () => {
  const { mail, calls } = client(
    {
      status: 429,
      body: { error: "Too many requests", code: "rate_limited" },
      headers: { "Retry-After": "0" },
    },
    { maxRetries: 3 },
  );
  await assert.rejects(mail.emails.send({ from: "a@m.test", to: "b@c.d" }), RateLimitError);
  assert.equal(calls.length, 1);
});

test("rate-limit headers are kept from the last reply", async () => {
  const { mail } = client({
    body: {},
    headers: {
      "X-RateLimit-Limit": "300",
      "X-RateLimit-Remaining": "297",
      "X-RateLimit-Reset": "1800000000",
    },
  });
  await mail.me();
  assert.equal(mail.rateLimit.limit, 300);
  assert.equal(mail.rateLimit.remaining, 297);
  assert.equal(mail.rateLimit.resetAt.getTime(), 1800000000000);
});

test("listAll walks every page and stops when the server says so", async () => {
  const pages = [
    { body: { object: "list", data: [{ id: "a" }], has_more: true, next_cursor: "c1" } },
    { body: { object: "list", data: [{ id: "b" }], has_more: false, next_cursor: null } },
  ];
  const { mail, calls } = client(pages);

  const seen = [];
  for await (const thread of mail.threads.listAll({ folder: "inbox" })) seen.push(thread.id);

  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.has("cursor"), false);
  assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "c1");
});

test("a failed ping comes back as a result, not a thrown error", async () => {
  const { mail } = client({
    status: 502,
    body: {
      object: "webhook_ping",
      succeeded: false,
      status_code: 500,
      error: "Endpoint replied 500",
    },
  });
  const result = await mail.webhooks.ping("whk_1");
  assert.equal(result.succeeded, false);
  assert.equal(result.status_code, 500);
});

test("a raw message comes back as bytes", async () => {
  const { mail } = client({
    body: "From: a@b.c\r\n\r\nhello",
    headers: { "Content-Type": "message/rfc822" },
  });
  const bytes = await mail.messages.raw("msg_1");
  assert.ok(bytes instanceof Uint8Array);
  assert.match(new TextDecoder().decode(bytes), /hello/);
});

test("a signature this package makes is one it accepts", async () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "whd_1", object: "event", type: "email.sent", data: {} });
  const signature = await signWebhookPayload(secret, payload);

  assert.equal(await verifyWebhook({ secret, payload, signature }), true);
  assert.equal(await verifyWebhook({ secret: "wrong", payload, signature }), false);
  assert.equal(await verifyWebhook({ secret, payload: `${payload} `, signature }), false);
  assert.equal(await verifyWebhook({ secret, payload, signature: null }), false);
});

test("a signature older than the tolerance is refused", async () => {
  const secret = "whsec_test";
  const payload = "{}";
  const old = Math.floor(Date.now() / 1000) - 3600;
  const signature = await signWebhookPayload(secret, payload, old);

  assert.equal(await verifyWebhook({ secret, payload, signature }), false);
  assert.equal(await verifyWebhook({ secret, payload, signature, toleranceSeconds: 7200 }), true);
});

test("constructWebhookEvent parses a good body and refuses a bad one", async () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "whd_1", object: "event", type: "mail.received", data: {} });
  const signature = await signWebhookPayload(secret, payload);

  const event = await constructWebhookEvent({ secret, payload, signature });
  assert.equal(event.type, "mail.received");

  await assert.rejects(
    constructWebhookEvent({ secret: "wrong", payload, signature }),
    /signature did not match/,
  );
});

test("the payload may be bytes as well as a string", async () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ ok: true });
  const signature = await signWebhookPayload(secret, payload);
  const bytes = new TextEncoder().encode(payload);
  assert.equal(await verifyWebhook({ secret, payload: bytes, signature }), true);
});

/* -------------------------------------------------------------------------- */
/* Scheduling, templates and test keys                                        */
/* -------------------------------------------------------------------------- */

test("a scheduled send passes the time through untouched", async () => {
  const { mail, calls } = client({
    status: 202,
    body: { id: "msg_1", status: "scheduled", scheduled_at: "2026-10-01T09:00:00.000Z" },
  });

  const sent = await mail.emails.send({
    from: "me@m.test",
    to: "a@b.c",
    subject: "Later",
    scheduled_at: "in 30 minutes",
  });

  assert.equal(sent.status, "scheduled");
  assert.equal(JSON.parse(calls[0].init.body).scheduled_at, "in 30 minutes");
});

test("cancel posts to the message's cancel path", async () => {
  const { mail, calls } = client({ body: { id: "msg_1", status: "canceled" } });
  const result = await mail.emails.cancel("msg_1");

  assert.equal(result.status, "canceled");
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /\/emails\/msg_1\/cancel$/);
});

test("reschedule sends a Date as an ISO string", async () => {
  const { mail, calls } = client({ body: { id: "msg_1" } });
  const at = new Date("2026-10-01T09:00:00.000Z");
  await mail.emails.reschedule("msg_1", at);

  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(JSON.parse(calls[0].init.body).scheduled_at, "2026-10-01T09:00:00.000Z");
});

test("sending a template passes the name and the data", async () => {
  const { mail, calls } = client({ status: 202, body: { id: "msg_1", status: "sent" } });

  await mail.emails.send({
    from: "me@m.test",
    to: "a@b.c",
    template: "welcome",
    data: { name: "Ada" },
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.template, "welcome");
  assert.deepEqual(body.data, { name: "Ada" });
});

test("templates can be listed, read, changed and removed", async () => {
  const { mail, calls } = client([
    { body: { object: "list", data: [{ id: "tpl_1", slug: "welcome" }], has_more: false } },
    { body: { object: "template", id: "tpl_1", slug: "welcome" } },
    { body: { object: "template", id: "tpl_1", subject: "New" } },
    { body: { object: "template", id: "tpl_1", deleted: true } },
  ]);

  await mail.templates.list();
  await mail.templates.get("welcome");
  await mail.templates.update("welcome", { subject: "New" });
  await mail.templates.delete("welcome");

  assert.deepEqual(
    calls.map((call) => call.init.method),
    ["GET", "GET", "PATCH", "DELETE"],
  );
  assert.match(calls[1].url, /\/templates\/welcome$/);
});

test("listing can ask for the test side, or for both", async () => {
  const { mail, calls } = client({ body: { object: "list", data: [], has_more: false } });
  await mail.emails.list({ test: "all" });
  assert.match(calls[0].url, /[?&]test=all/);
});

test("a simulated delivery reads as the real event, and says it was simulated", async () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({
    id: "evt_1",
    type: "email.delivered",
    created_at: "2026-09-21T00:00:00.000Z",
    data: {
      email: { id: "msg_1", status: "delivered", test: true },
      recipients: ["a@b.c"],
      detail: "Simulated by a test key",
      occurred_at: "2026-09-21T00:00:00.000Z",
      simulated: true,
    },
  });

  const signature = await signWebhookPayload(secret, payload);
  const event = await constructWebhookEvent({ secret, payload, signature });

  assert.equal(event.type, "email.delivered");
  assert.equal(event.data.simulated, true);
  assert.deepEqual(event.data.recipients, ["a@b.c"]);
});
