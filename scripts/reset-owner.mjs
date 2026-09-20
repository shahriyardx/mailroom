/**
 * Removes the current owner so the next GitHub sign-in claims the dashboard.
 *
 * Deleting the user cascades to their mailboxes, domains, threads and messages.
 * Domains re-import from SES in one click; mail already received does not come
 * back. Run with --yes to confirm.
 *
 *   node scripts/reset-owner.mjs --yes
 */
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

const users = await sql`select id, email, name from "user"`;
if (users.length === 0) {
  console.log("No owner yet — the next GitHub sign-in claims the dashboard.");
  await sql.end();
  process.exit(0);
}

const [counts] = await sql`
  select
    (select count(*) from mailbox) as mailboxes,
    (select count(*) from domain)  as domains,
    (select count(*) from thread)  as threads,
    (select count(*) from message) as messages
`;

console.log("current owner:");
for (const u of users) console.log(`  ${u.email}  ${u.name ?? ""}`);
console.log(
  `deleting also removes: ${counts.mailboxes} mailboxes, ${counts.domains} domains, ${counts.threads} threads, ${counts.messages} messages`,
);

if (!process.argv.includes("--yes")) {
  console.log("\nNothing changed. Re-run with --yes to go ahead.");
  await sql.end();
  process.exit(0);
}

await sql`delete from "user"`;
console.log("\nOwner removed. The next GitHub sign-in claims the dashboard.");
await sql.end();
