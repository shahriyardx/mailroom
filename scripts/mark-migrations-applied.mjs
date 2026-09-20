// The dev database already has this schema (applied with drizzle-kit push),
// so record the regenerated baseline as applied instead of re-running it.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

const sql = postgres(env.DATABASE_URL);
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));

await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
await sql`CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
)`;

for (const entry of journal.entries) {
  const file = readdirSync("drizzle").find((n) => n.startsWith(entry.tag.split("_")[0]));
  const body = readFileSync(`drizzle/${file}`, "utf8");
  const hash = createHash("sha256").update(body).digest("hex");
  const [existing] = await sql`select 1 from drizzle."__drizzle_migrations" where hash = ${hash}`;
  if (!existing) {
    await sql`insert into drizzle."__drizzle_migrations" (hash, created_at) values (${hash}, ${entry.when})`;
    console.log(`marked applied: ${entry.tag}`);
  } else {
    console.log(`already recorded: ${entry.tag}`);
  }
}

await sql.end();
