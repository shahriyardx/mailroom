/**
 * Fills an empty database with a whole fictional company, for screenshots.
 *
 * This is not the demo seeder next door: that one adds awkward mail to a
 * mailbox you already have. This one builds the instance from nothing — the
 * account, the company, its domains, its addresses, its labels and a few weeks
 * of mail — so a screenshot shows a system in use rather than an empty one.
 *
 * Point it at a throwaway database. It writes an owner whose only purpose is
 * to be photographed.
 *
 *   DATABASE_URL=postgres://…/mailroom_demo node scripts/seed-showcase.mjs
 *
 * The domains are real ones this instance owns; every correspondent on the
 * other end of the mail is invented, and .example addresses cannot resolve.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url =
  process.env.DATABASE_URL ??
  (() => {
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
    return env.DATABASE_URL;
  })();

const sql = postgres(url);

const id = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "")}`;
const ago = (minutes) => new Date(Date.now() - minutes * 60_000);
const snippetOf = (text) => text.replace(/\s+/g, " ").trim().slice(0, 140);

const reply = (body) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#27272a">${body
    .trim()
    .split("\n\n")
    .map((paragraph) => `<p>${paragraph.trim()}</p>`)
    .join("")}</div>`;

/* ------------------------------------------------------------ the company */

const orgId = id("org");
const userId = randomUUID();
const memberId = id("mem");

await sql`delete from "user"`;
await sql`delete from organization`;

await sql`insert into "user" ${sql({
  id: userId,
  name: "Ada Whitfield",
  email: "ada@shahriyar.dev",
  email_verified: true,
})}`;

await sql`insert into organization ${sql({
  id: orgId,
  name: "Northwind",
  slug: "northwind",
})}`;

await sql`insert into member ${sql({
  id: memberId,
  organization_id: orgId,
  user_id: userId,
  role: "owner",
})}`;

/** A second and third face, so People and Teams have something in them. */
const colleagues = [
  { name: "Tomas Vrba", email: "tomas@shahriyar.dev", role: "admin" },
  { name: "Priya Raman", email: "priya@shahriyar.dev", role: "member" },
  { name: "Ola Nilsen", email: "ola@shahriyar.dev", role: "member" },
];

for (const person of colleagues) {
  const personId = randomUUID();
  await sql`insert into "user" ${sql({
    id: personId,
    name: person.name,
    email: person.email,
    email_verified: true,
  })}`;
  await sql`insert into member ${sql({
    id: id("mem"),
    organization_id: orgId,
    user_id: personId,
    role: person.role,
  })}`;
}

/* -------------------------------------------------------------- the domains */

const domains = [
  { name: "shahriyar.dev", status: "verified", sending: true },
  { name: "ccbot.app", status: "verified", sending: true },
  { name: "makeown.cc", status: "verified", sending: true },
  // A subdomain of a verified domain needs no records of its own, which is
  // worth showing: the tree in the sidebar nests them under their parent.
  { name: "billing.ccbot.app", status: "verified", sending: true },
  { name: "alerts.ccbot.app", status: "verified", sending: true },
];

const domainIds = {};
for (const item of domains) {
  const domainId = id("dom");
  domainIds[item.name] = domainId;
  await sql`insert into domain ${sql({
    id: domainId,
    organization_id: orgId,
    name: item.name,
    region: "eu-west-1",
    status: item.status,
    sending_enabled: item.sending,
    dkim_status: item.status,
    dkim_origin: "AWS_SES",
    dkim_tokens: [
      "k5m2xq7wvz3jc4hb6n8pdy9rtf2sgu",
      "p3rw9nqk5vx7mz2hc8jb4dy6tgf1su",
      "t7hb2mxq4vz9cn5kp3rw8jy6df1gsu",
    ],
    mail_from_domain: `mail.${item.name}`,
    mail_from_status: "verified",
  })}`;
}

/* ------------------------------------------------------------ the mailboxes */

const boxes = [
  {
    address: "hello@shahriyar.dev",
    display: "Northwind",
    domain: "shahriyar.dev",
    color: "oklch(0.55 0.16 278)",
    isDefault: true,
  },
  {
    address: "billing@makeown.cc",
    display: "Northwind Billing",
    domain: "makeown.cc",
    color: "oklch(0.54 0.11 158)",
  },
  {
    address: "support@ccbot.app",
    display: "Northwind Support",
    domain: "ccbot.app",
    color: "oklch(0.58 0.13 68)",
  },
  {
    address: "invoices@billing.ccbot.app",
    display: "Northwind Invoices",
    domain: "billing.ccbot.app",
    color: "oklch(0.55 0.11 238)",
  },
  {
    address: "alerts@alerts.ccbot.app",
    display: "Northwind Alerts",
    domain: "alerts.ccbot.app",
    color: "oklch(0.52 0.13 318)",
  },
];

const boxIds = {};
for (const box of boxes) {
  const mailboxId = id("mbx");
  boxIds[box.address] = { id: mailboxId, ...box };
  await sql`insert into mailbox ${sql({
    id: mailboxId,
    organization_id: orgId,
    address: box.address,
    domain: box.domain,
    domain_id: domainIds[box.domain],
    display_name: box.display,
    signature: "<p>— The Northwind team</p>",
    is_default: box.isDefault ?? false,
    color: box.color,
  })}`;
}

await sql`update member set default_mailbox_id = ${boxIds["hello@shahriyar.dev"].id} where id = ${memberId}`;

/* ---------------------------------------------------------------- the labels */

const labels = [
  { name: "Customers", color: "oklch(0.55 0.16 278)" },
  { name: "Invoices", color: "oklch(0.54 0.11 158)" },
  { name: "Shipping", color: "oklch(0.58 0.13 68)" },
  { name: "Needs a reply", color: "oklch(0.55 0.15 22)" },
];

const labelIds = {};
for (const item of labels) {
  const labelId = id("lbl");
  labelIds[item.name] = labelId;
  await sql`insert into label ${sql({
    id: labelId,
    organization_id: orgId,
    name: item.name,
    color: item.color,
  })}`;
}

/* ------------------------------------------------------------------ the mail */

let messages = 0;

/**
 * One conversation and everything on it. `messages` are in the order they
 * arrived; anything with `mine: true` is a message this company sent.
 */
async function thread({
  box,
  subject,
  folder = "inbox",
  starred = false,
  labels: applied = [],
  attachments = false,
  messages: rows,
}) {
  const mailbox = boxIds[box];
  const me = { name: mailbox.display, address: mailbox.address };
  const threadId = id("thr");

  const built = rows.map((row, index) => ({
    ...row,
    id: id("msg"),
    at: row.at ?? ago((rows.length - index) * 47),
    folder: row.mine ? (folder === "inbox" ? "sent" : folder) : folder,
  }));

  const last = built.at(-1);
  const participants = [];
  for (const row of built) {
    const who = row.mine ? me : row.from;
    if (!participants.some((entry) => entry.address === who.address)) participants.push(who);
  }

  await sql`insert into thread ${sql({
    id: threadId,
    mailbox_id: mailbox.id,
    subject,
    snippet: snippetOf(last.text),
    folders: [...new Set(built.map((row) => row.folder))],
    participants: JSON.stringify(participants),
    message_count: built.length,
    unread_count: built.filter((row) => !row.mine && row.unread).length,
    is_starred: starred,
    has_attachments: attachments,
    last_message_at: last.at,
    created_at: built[0].at,
  })}`;

  for (const row of built) {
    const from = row.mine ? me : row.from;
    const to = row.mine ? row.from : me;
    await sql`insert into message ${sql({
      id: row.id,
      thread_id: threadId,
      mailbox_id: mailbox.id,
      rfc_message_id: `<${row.id}@shahriyar.dev>`,
      from_name: from.name,
      from_address: from.address,
      to: JSON.stringify([to]),
      cc: JSON.stringify([]),
      bcc: JSON.stringify([]),
      subject,
      snippet: snippetOf(row.text),
      text_body: row.text,
      html_body: row.html ?? reply(row.text),
      folder: row.folder,
      is_read: row.mine ? true : !row.unread,
      is_outbound: row.mine ?? false,
      spf: row.mine ? null : "pass",
      dkim: row.mine ? null : "pass",
      dmarc: row.mine ? null : "pass",
      mailed_by: row.mine ? null : from.address.split("@")[1],
      signed_by: row.mine ? null : from.address.split("@")[1],
      tls: row.mine ? null : "TLS1.3",
      delivery_status: row.mine ? (row.status ?? "delivered") : null,
      ses_message_id: row.mine ? `0100019${Math.random().toString(16).slice(2, 12)}` : null,
      opened_at: row.mine && row.opened ? new Date(row.at.getTime() + 900_000) : null,
      open_count: row.mine && row.opened ? 2 : 0,
      size_bytes: row.text.length + 1024,
      sent_at: row.at,
      received_at: row.at,
    })}`;
    messages += 1;
  }

  for (const name of applied) {
    await sql`insert into thread_label ${sql({ thread_id: threadId, label_id: labelIds[name] })}`;
  }

  return threadId;
}

/* The hand-written conversations, which are the ones that end up on screen. */

await thread({
  box: "hello@shahriyar.dev",
  subject: "Bulk order for the Hamburg store",
  starred: true,
  labels: ["Customers", "Needs a reply"],
  messages: [
    {
      from: { name: "Lena Brandt", address: "lena@fjordworks.example" },
      at: ago(41),
      unread: true,
      text: "We are opening in Hamburg in November and want to place a standing order for the ceramic range.\n\nRoughly 400 units a month, split across the three glazes. Can you hold that volume, and what does the lead time look like once the first order is in?",
    },
  ],
});

await thread({
  box: "hello@shahriyar.dev",
  subject: "Re: Samples arrived — two questions",
  labels: ["Customers"],
  messages: [
    {
      from: { name: "Marcus Hale", address: "marcus@stonebridge.example" },
      at: ago(190),
      text: "The samples landed this morning and they are lovely. Two things before we commit.\n\nFirst, is the matt glaze dishwasher safe, or is that hand wash only? Second, can we have the crate marked with our own SKUs?",
    },
    {
      mine: true,
      at: ago(150),
      opened: true,
      text: "Glad they arrived safely.\n\nThe matt glaze is dishwasher safe at 60 degrees — we run every batch through a hundred cycles before it ships. Anything above that will dull it over time.\n\nSKU marking is no trouble. Send the list and we will print them onto the crate labels from the first order onwards.",
    },
    {
      from: { name: "Marcus Hale", address: "marcus@stonebridge.example" },
      at: ago(96),
      unread: true,
      text: "Perfect, that answers both. SKU list attached — same format as last year.\n\nWe would like the first crate to arrive before the 14th if that is still possible.",
    },
  ],
  attachments: true,
});

await thread({
  box: "billing@makeown.cc",
  subject: "Invoice NW-2041 — September",
  labels: ["Invoices"],
  messages: [
    {
      mine: true,
      at: ago(300),
      opened: true,
      text: "September's invoice is attached, due on the 30th.\n\nNothing has changed from August apart from the two extra seats you added on the 12th.",
    },
    {
      from: { name: "Accounts", address: "accounts@stonebridge.example" },
      at: ago(240),
      text: "Received and approved. It will go out in Friday's payment run.",
    },
  ],
  attachments: true,
});

await thread({
  box: "support@ccbot.app",
  subject: "Tracking number has not updated since Tuesday",
  labels: ["Shipping", "Needs a reply"],
  messages: [
    {
      from: { name: "Ines Costa", address: "ines@harbourline.example" },
      at: ago(75),
      unread: true,
      text: "The tracking number you sent has not moved since Tuesday morning. It still says the parcel is at the depot.\n\nThe order is for a wedding on the 28th, so I would rather find out now than on the day.",
    },
  ],
});

await thread({
  box: "support@ccbot.app",
  subject: "Replacement sent for the cracked bowl",
  labels: ["Shipping"],
  messages: [
    {
      from: { name: "Sam Okafor", address: "sam@quayside.example" },
      at: ago(460),
      text: "One of the bowls arrived cracked — photo attached. Everything else is fine.",
    },
    {
      mine: true,
      at: ago(430),
      opened: true,
      text: "Sorry about that. A replacement went out this afternoon and should reach you on Thursday.\n\nNo need to send the broken one back. We log the breakages and it goes to the glaze test pile.",
    },
    {
      from: { name: "Sam Okafor", address: "sam@quayside.example" },
      at: ago(410),
      text: "That was quick. Thank you.",
    },
  ],
  attachments: true,
});

await thread({
  box: "hello@shahriyar.dev",
  subject: "Stock for the winter catalogue",
  labels: ["Customers"],
  messages: [
    {
      from: { name: "Priya Raman", address: "priya@shahriyar.dev" },
      at: ago(620),
      text: "Winter catalogue goes to print on the 3rd. I need final stock figures for the ceramic and glass ranges by Friday.\n\nAnything we cannot hold through January should come out now rather than be listed and sold out in week one.",
    },
    {
      mine: true,
      at: ago(590),
      text: "Figures are with the workshop. They come back Thursday, which leaves a day to pull anything short.",
    },
  ],
});

await thread({
  box: "billing@makeown.cc",
  subject: "Card on file expires this month",
  labels: ["Invoices"],
  messages: [
    {
      mine: true,
      at: ago(900),
      status: "delivered",
      opened: true,
      text: "The card we have for your account expires at the end of the month.\n\nNothing is due until the 30th, so there is time — but the payment will fail if it runs against the old card.",
    },
  ],
});

await thread({
  box: "hello@shahriyar.dev",
  subject: "Press enquiry — the workshop piece",
  starred: true,
  messages: [
    {
      from: { name: "Ola Nilsen", address: "ola@courierpress.example" },
      at: ago(1400),
      text: "I am writing a piece on small potteries for the March issue and would like to include Northwind.\n\nIt would be a visit, a couple of hours, and photographs of the workshop. Would somebody be free in the last week of February?",
    },
  ],
});

await thread({
  box: "hello@shahriyar.dev",
  subject: "Delivery slot moved to Thursday",
  folder: "archive",
  labels: ["Shipping"],
  messages: [
    {
      from: { name: "Depot", address: "depot@parcelline.example" },
      at: ago(2600),
      text: "Your collection has moved from Wednesday to Thursday, same window.",
    },
  ],
});

/** Enough ordinary mail underneath that the list looks lived in. */
const FILLER = [
  ["Hanna Kovac", "hanna@lowfield.example", "Reorder — the small jugs"],
  ["Deploy bot", "noreply@parcelline.example", "Shipment PL-8841 is out for delivery"],
  ["Ines Costa", "ines@harbourline.example", "Question about the glaze colours"],
  ["Accounts", "accounts@stonebridge.example", "Remittance advice for NW-2038"],
  ["Sam Okafor", "sam@quayside.example", "Are the tall vases back in stock?"],
  ["Lena Brandt", "lena@fjordworks.example", "Opening date confirmed"],
  ["Marcus Hale", "marcus@stonebridge.example", "Pallet spec for the next run"],
  ["Studio Voss", "studio@voss.example", "Collaboration for the spring range"],
  ["Hanna Kovac", "hanna@lowfield.example", "Invoice NW-2036 paid"],
  ["Depot", "depot@parcelline.example", "Two crates collected this morning"],
  ["Ines Costa", "ines@harbourline.example", "Gift wrapping options"],
  ["Studio Voss", "studio@voss.example", "Dates for the studio visit"],
  ["Sam Okafor", "sam@quayside.example", "Trade account application"],
  ["Accounts", "accounts@lowfield.example", "Purchase order 5512 attached"],
  ["Marcus Hale", "marcus@stonebridge.example", "Christmas order deadline"],
  ["Lena Brandt", "lena@fjordworks.example", "Shelf dimensions for the display"],
  ["Hanna Kovac", "hanna@lowfield.example", "Photos from the shop floor"],
  ["Depot", "depot@parcelline.example", "Weekly collection summary"],
];

const BODIES = [
  "Short one — is this still the right address for orders, or should it go to the trade account?",
  "No action needed. Sending this over so it is on the record before the end of the month.",
  "Could you confirm the quantities below before I put the order through?",
  "Following up on last week. Happy to speak on the phone if that is easier than writing it all out.",
  "This went out this morning and should be with you inside three working days.",
  "Nothing urgent — when you have a moment, could you check the second line of the spec?",
];

const boxCycle = [
  "hello@shahriyar.dev",
  "support@ccbot.app",
  "billing@makeown.cc",
  "hello@shahriyar.dev",
];

for (const [index, [name, address, subject]] of FILLER.entries()) {
  await thread({
    box: boxCycle[index % boxCycle.length],
    subject,
    starred: index % 9 === 0,
    labels: index % 4 === 0 ? ["Customers"] : [],
    messages: [
      {
        from: { name, address },
        unread: index % 6 === 0,
        at: ago(1600 + index * 210),
        text: BODIES[index % BODIES.length],
      },
    ],
  });
}

console.log(`Seeded Northwind: ${messages} messages, ${boxes.length} mailboxes.`);
console.log(`Owner: ada@shahriyar.dev (${userId})`);
await sql.end();
