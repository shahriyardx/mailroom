/**
 * Fills a mailbox with mail that is awkward to render, so the interface can be
 * looked at in both themes without waiting for the right message to arrive.
 *
 * The hard cases are not long threads. They are messages whose own HTML fights
 * the theme around it: a newsletter that hard-codes a white card sits inside a
 * dark app, and a dark-mode template sits inside a light one. Both are here,
 * along with a message that fails its checks, one that crossed the network in
 * the clear, and one that wants to load a tracking image.
 *
 *   node scripts/seed-demo.mjs                              # the first mailbox
 *   node scripts/seed-demo.mjs --mailbox=you@yours.com      # a particular one
 *   node scripts/seed-demo.mjs --count=100                  # plus 100 ordinary ones
 *   node scripts/seed-demo.mjs --count=200 --no-samples     # only the ordinary ones
 *   node scripts/seed-demo.mjs --unread=20 --no-samples     # 20 recent, all unread
 *   node scripts/seed-demo.mjs --remove                     # take it all back out
 *
 * Everything it writes is tagged, so --remove touches nothing else.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [
        line.slice(0, i).trim(),
        line
          .slice(i + 1)
          .trim()
          .replace(/^"|"$/g, ""),
      ];
    }),
);

const sql = postgres(env.DATABASE_URL);

/** Demo rows carry this in their RFC id, which is the only mark --remove needs. */
const TAG = "seed-demo.mailroom.invalid";

const id = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "")}`;
const ago = (minutes) => new Date(Date.now() - minutes * 60_000);
const snippetOf = (text) => text.replace(/\s+/g, " ").trim().slice(0, 140);

if (process.argv.includes("--remove")) {
  const [{ count }] = await sql`
    select count(*)::int as count from message where rfc_message_id like ${`%@${TAG}>`}
  `;
  const threads = await sql`
    select distinct thread_id from message where rfc_message_id like ${`%@${TAG}>`}
  `;
  await sql`delete from message where rfc_message_id like ${`%@${TAG}>`}`;
  if (threads.length > 0) {
    await sql`delete from thread where id in ${sql(threads.map((row) => row.thread_id))}`;
  }
  console.log(`Removed ${count} demo messages in ${threads.length} threads.`);
  await sql.end();
  process.exit(0);
}

const wanted = process.argv.find((arg) => arg.startsWith("--mailbox="))?.split("=")[1];
const boxes = await sql`
  select id, organization_id, address, display_name from mailbox order by created_at
`;
const box = wanted ? boxes.find((row) => row.address === wanted) : boxes[0];

if (!box) {
  if (wanted) {
    console.error(`No mailbox called ${wanted}. There is:`);
    for (const row of boxes) console.error(`  ${row.address}`);
  } else {
    console.error("No mailbox to put demo mail in. Add one in Settings first.");
  }
  await sql.end();
  process.exit(1);
}

const me = { name: box.display_name ?? null, address: box.address };

/** One thread and its messages, written in the order they would have arrived. */
async function thread({ subject, starred = false, messages }) {
  const threadId = id("thr");
  const rows = messages.map((message, index) => ({
    ...message,
    id: id("msg"),
    at: message.at ?? ago((messages.length - index) * 47),
  }));

  const last = rows[rows.length - 1];
  const participants = [];
  for (const row of rows) {
    const who = row.outbound ? me : row.from;
    if (!participants.some((entry) => entry.address === who.address)) participants.push(who);
  }

  await sql`
    insert into thread ${sql({
      id: threadId,
      mailbox_id: box.id,
      subject,
      snippet: snippetOf(last.text),
      folders: ["inbox"],
      participants: JSON.stringify(participants),
      message_count: rows.length,
      unread_count: rows.filter((row) => !row.outbound && row.unread).length,
      is_starred: starred,
      has_attachments: false,
      last_message_at: last.at,
      created_at: rows[0].at,
    })}
  `;

  for (const row of rows) {
    const from = row.outbound ? me : row.from;
    await sql`
      insert into message ${sql({
        id: row.id,
        thread_id: threadId,
        mailbox_id: box.id,
        rfc_message_id: `<${row.id}@${TAG}>`,
        from_name: from.name,
        from_address: from.address,
        to: JSON.stringify([row.outbound ? row.from : me]),
        cc: JSON.stringify(row.cc ?? []),
        bcc: JSON.stringify([]),
        subject,
        snippet: snippetOf(row.text),
        text_body: row.text,
        html_body: row.html ?? null,
        folder: "inbox",
        is_read: row.outbound ? true : !row.unread,
        is_outbound: row.outbound ?? false,
        spf: row.outbound ? null : (row.spf ?? "pass"),
        dkim: row.outbound ? null : (row.dkim ?? "pass"),
        dmarc: row.outbound ? null : (row.dmarc ?? "pass"),
        mailed_by: row.outbound ? null : (row.mailedBy ?? from.address.split("@")[1]),
        signed_by: row.outbound ? null : (row.signedBy ?? from.address.split("@")[1]),
        tls: row.outbound ? null : (row.tls ?? "TLS1.3"),
        delivery_status: row.outbound ? (row.status ?? "delivered") : null,
        delivery_error: row.error ?? null,
        size_bytes: (row.html ?? row.text).length + 512,
        sent_at: row.at,
        received_at: row.at,
      })}
    `;
  }

  return rows.length;
}

/* ---------------------------------------------------------------- the mail */

/** A newsletter that hard-codes a light card, the usual case in a dark app. */
const lightHtml = `
<div style="background:#f4f4f5;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px">
    <p style="margin:0 0 6px;font:600 12px/1 system-ui;letter-spacing:.12em;color:#6d28d9">NORTHWIND</p>
    <h1 style="margin:0 0 16px;font:600 22px/1.3 system-ui;color:#18181b">Your September invoice</h1>
    <p style="margin:0 0 16px;font:15px/1.6 system-ui;color:#3f3f46">
      Thanks for another month. Your invoice for September is ready, and the card
      ending 4242 will be charged on the 1st.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font:14px/1.6 system-ui;color:#3f3f46">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7">Plan — Team</td><td align="right" style="padding:8px 0;border-bottom:1px solid #e4e4e7">$48.00</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7">Extra seats (2)</td><td align="right" style="padding:8px 0;border-bottom:1px solid #e4e4e7">$18.00</td></tr>
      <tr><td style="padding:8px 0;font-weight:600;color:#18181b">Total</td><td align="right" style="padding:8px 0;font-weight:600;color:#18181b">$66.00</td></tr>
    </table>
    <a href="https://example.com/invoice" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font:600 14px system-ui">View invoice</a>
    <p style="margin:24px 0 0;font:12px/1.6 system-ui;color:#a1a1aa">Northwind Ltd · 4 Bridge St · Unsubscribe</p>
  </div>
</div>`;

/** The mirror image: a template that assumes the reader is in the dark. */
const darkHtml = `
<div style="background:#0b0b0f;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#141419;border:1px solid #26262e;border-radius:14px;padding:32px">
    <p style="margin:0 0 6px;font:600 12px/1 system-ui;letter-spacing:.12em;color:#7dd3fc">DEPLOY LOG</p>
    <h1 style="margin:0 0 16px;font:600 22px/1.3 system-ui;color:#f4f4f5">api-gateway is live</h1>
    <p style="margin:0 0 20px;font:15px/1.6 system-ui;color:#a1a1aa">
      Build <code style="color:#7dd3fc">4f2a91c</code> finished in 3m 12s and is
      serving all three regions.
    </p>
    <pre style="margin:0 0 20px;background:#0b0b0f;border:1px solid #26262e;border-radius:10px;padding:14px;font:12px/1.7 ui-monospace,Menlo,monospace;color:#d4d4d8;overflow-x:auto">✓ build      3m 12s
✓ migrate    0m 04s
✓ us-east-1  healthy
✓ eu-west-1  healthy
✓ ap-south-1 healthy</pre>
    <a href="https://example.com/deploy" style="display:inline-block;background:#7dd3fc;color:#0b0b0f;text-decoration:none;padding:11px 20px;border-radius:9px;font:600 14px system-ui">Open the run</a>
  </div>
</div>`;

/** Remote images are blocked until asked for, so this should show the notice. */
const trackedHtml = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#27272a">
  <p>Hi there,</p>
  <p>Just checking you saw the plan for next week. No rush — Monday is fine.</p>
  <p>— Priya</p>
  <img src="https://tracker.example.com/open/9f3a2b.gif" width="1" height="1" alt="">
</div>`;

const reply = (body) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#27272a">${body
    .trim()
    .split("\n\n")
    .map((paragraph) => `<p>${paragraph.trim()}</p>`)
    .join("")}</div>`;

const plain = (body) => body.trim();

let total = 0;

/**
 * The seven hand-written threads. Skip them with --no-samples when the mailbox
 * already has them and all that is wanted is more rows to scroll.
 */
if (!process.argv.includes("--no-samples")) {
  total += await thread({
    subject: "Your September invoice",
    messages: [
      {
        from: { name: "Northwind Billing", address: "billing@northwind.example" },
        text: plain(`Thanks for another month. Your invoice for September is ready,
  and the card ending 4242 will be charged on the 1st. Total $66.00.`),
        html: lightHtml,
        mailedBy: "bounces.northwind.example",
        signedBy: "northwind.example",
        unread: true,
      },
    ],
  });

  total += await thread({
    subject: "api-gateway is live",
    messages: [
      {
        from: { name: "Deploy bot", address: "deploys@buildpipe.example" },
        text: plain("Build 4f2a91c finished in 3m 12s and is serving all three regions."),
        html: darkHtml,
        mailedBy: "mail.buildpipe.example",
        signedBy: "buildpipe.example",
      },
    ],
  });

  const priya = { name: "Priya Raman", address: "priya@harbourline.example" };
  const dev = { name: "Tomas Vrba", address: "tomas@harbourline.example" };

  total += await thread({
    subject: "Migrating the reporting job off cron",
    starred: true,
    messages: [
      {
        from: priya,
        unread: false,
        text: plain(`The nightly reporting job overran again — it finished at 06:40,
  which is after the first customers are already in.`),
        html: reply(`The nightly reporting job overran again — it finished at 06:40, which is
        after the first customers are already in.

        I think we have outgrown cron for this. Can we move it onto the queue and
        let it retry on its own?`),
      },
      {
        outbound: true,
        from: priya,
        text: plain(`Agreed. Cron has no idea whether the last run finished, which is
  exactly how we ended up with two of them writing the same rows.`),
        html: reply(`Agreed. Cron has no idea whether the last run finished, which is exactly
        how we ended up with two of them writing the same rows last Tuesday.

        I will put it behind the queue this week. One job per tenant rather than one
        job for everybody, so a slow tenant stops holding up the rest.`),
      },
      {
        from: dev,
        text: plain(`One per tenant means a few thousand jobs a night. Is the queue
  happy with that?`),
        html: reply(`One per tenant means a few thousand jobs a night. Is the queue happy with
        that volume, or do we need to batch them?

        Not blocking — I would just rather find out now than at 03:00.`),
      },
      {
        outbound: true,
        from: dev,
        text: plain(`It handles that comfortably. The old job did the same work, it
  just did it in one process where nobody could see it.`),
        html: reply(`It handles that comfortably — we already push more than that through it on
        a busy send day.

        The old job did the same amount of work. It just did it inside one process
        where nobody could see which tenant was slow.`),
      },
      {
        from: priya,
        unread: true,
        text: plain(`Good. Ship it behind a flag and let it run beside cron for a
  night so we can compare the two.`),
        html: reply(`Good. Ship it behind a flag and let it run beside cron for a night so we
        can compare the output before we turn the old one off.

        If the numbers match in the morning, delete the crontab and let us never
        speak of it again.`),
      },
    ],
  });

  total += await thread({
    subject: "Monday plan",
    messages: [
      {
        from: priya,
        unread: true,
        text: plain("Just checking you saw the plan for next week. No rush — Monday is fine."),
        html: trackedHtml,
      },
    ],
  });

  total += await thread({
    subject: "Re: your account",
    messages: [
      {
        from: { name: "Account Services", address: "security@paypa1-verify.example" },
        unread: true,
        spf: "fail",
        dkim: "fail",
        dmarc: "fail",
        tls: "none",
        mailedBy: "bulk.mailer-77.example",
        signedBy: null,
        text: plain(`Dear customer, your account has been limited. Confirm your details
  within 24 hours to restore access.`),
        html: reply(`Dear customer,

        Your account has been limited. Confirm your details within 24 hours to
        restore access to your funds.`),
      },
    ],
  });

  total += await thread({
    subject: "Notes from the call",
    messages: [
      {
        from: { name: "Ola Nilsen", address: "ola@fjordworks.example" },
        text: plain(`Rough notes, no formatting, sent from a terminal:

    - they want SSO before the pilot, not after
    - invoicing in EUR, one invoice for all seats
    - security review is two weeks, starts when we send the questionnaire
    - Ana is the decision maker, not Henrik

  Next step is ours: questionnaire back to them by Thursday.`),
        unread: true,
      },
    ],
  });

  total += await thread({
    subject: "Welcome to Harbourline",
    messages: [
      {
        outbound: true,
        from: { name: "New signup", address: "closed@mailbox.invalid" },
        status: "bounced",
        error: "550 5.1.1 The email account that you tried to reach does not exist.",
        text: plain("Welcome aboard. Your workspace is ready whenever you are."),
        html: reply(`Welcome aboard. Your workspace is ready whenever you are — sign in and add
        your first domain to get going.`),
      },
    ],
  });
}

/* ------------------------------------------------------- filling the list */

/**
 * Ordinary mail, in whatever quantity the list needs to be worth scrolling.
 *
 * Seven hand-written threads show the rendering. They do not show what fifty
 * rows of a real inbox look like beside each other, or that paging works at
 * all, and those only turn up once there is enough mail to page through.
 */
const SENDERS = [
  ["Priya Raman", "priya@harbourline.example"],
  ["Tomas Vrba", "tomas@harbourline.example"],
  ["Ola Nilsen", "ola@fjordworks.example"],
  ["Support", "help@northwind.example"],
  ["Deploy bot", "deploys@buildpipe.example"],
  ["Hana Kovac", "hana@meridian.example"],
  ["Accounts", "accounts@westbay.example"],
  ["Sam Okafor", "sam@lanternco.example"],
];

const SUBJECTS = [
  "Re: onboarding for the pilot",
  "Invoice 2026-{n} is ready",
  "Weekly summary",
  "Question about rate limits",
  "Contract for review",
  "Re: the staging outage",
  "Access request for the reporting tool",
  "Notes from Thursday",
  "Renewal coming up",
  "Re: SSO rollout",
  "Backup finished",
  "New comment on your thread",
];

const BODIES = [
  "Sending this over before the end of the week so you have time to look at it.",
  "No action needed — this is the summary going out to everyone on the account.",
  "Could you confirm the numbers below before I pass them on?",
  "Following up on the thread from Tuesday. Happy to jump on a call if that is easier.",
  "This ran clean overnight. Nothing to do unless the report says otherwise.",
  "Short one: are we still on for the review, and is the room booked?",
];

const bulk = Number(process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] ?? 0);

for (let index = 0; index < bulk; index += 1) {
  const [name, address] = SENDERS[index % SENDERS.length];
  const subject = SUBJECTS[index % SUBJECTS.length].replace("{n}", String(1400 + index));
  const body = BODIES[index % BODIES.length];

  total += await thread({
    subject,
    // A real list is mostly read, with a scattering of unread and starred.
    starred: index % 17 === 0,
    messages: [
      {
        from: { name, address },
        unread: index % 5 === 0,
        // Spread over weeks so the list shows dates as well as times.
        at: ago(600 + index * 137),
        text: plain(body),
        html: reply(`${body}\n\n— ${name}`),
      },
    ],
  });
}

/**
 * Mail that has not been read, for looking at the Unread filter. Recent and
 * minutes apart, so they arrive at the top of the list together.
 */
const unread = Number(process.argv.find((arg) => arg.startsWith("--unread="))?.split("=")[1] ?? 0);

for (let index = 0; index < unread; index += 1) {
  const [name, address] = SENDERS[(index + 3) % SENDERS.length];
  const subject = SUBJECTS[(index + 5) % SUBJECTS.length].replace("{n}", String(2100 + index));
  const body = BODIES[(index + 2) % BODIES.length];

  total += await thread({
    subject,
    messages: [
      {
        from: { name, address },
        unread: true,
        at: ago(3 + index * 11),
        text: plain(body),
        html: reply(`${body}\n\n— ${name}`),
      },
    ],
  });
}

const crafted = process.argv.includes("--no-samples") ? 0 : 7;
console.log(`Added ${total} messages in ${crafted + bulk + unread} threads to ${box.address}.`);
console.log("Undo with: node scripts/seed-demo.mjs --remove");
await sql.end();
