/**
 * A database of its own for each test file.
 *
 * Tests that share one database share its rows, and a test that fails then
 * leaves the next one guessing. A scratch database per file costs a second and
 * removes the whole class of problem.
 */
import { execFileSync } from "node:child_process";
import { newId } from "@/lib/utils";

const ADMIN_URL =
  process.env.TEST_ADMIN_URL ??
  process.env.TEST_DATABASE_URL ??
  "postgres://mail:mail@localhost:5433/postgres";

/** Migrated once by scripts/test.mjs, then copied rather than rebuilt. */
const TEMPLATE = process.env.TEST_TEMPLATE_DB;

function adminUrlFor(name: string) {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

export interface Scratch {
  url: string;
  name: string;
  drop: () => void;
}

/**
 * Makes the database, runs every migration into it, and points the app's
 * connection at it. Must be called before anything imports `@/db`.
 */
export function makeScratchDatabase(label: string): Scratch {
  const name = `mail_test_${label}_${Date.now().toString(36)}`;
  const admin = ADMIN_URL;

  psql(admin, `DROP DATABASE IF EXISTS "${name}"`);

  if (TEMPLATE) {
    psql(admin, `CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE}"`);
  } else {
    // Running a built test file directly, without the harness around it.
    psql(admin, `CREATE DATABASE "${name}"`);
    execFileSync("npx", ["drizzle-kit", "migrate"], {
      env: { ...process.env, DATABASE_URL: adminUrlFor(name) },
      stdio: "pipe",
    });
  }

  const url = adminUrlFor(name);
  process.env.DATABASE_URL = url;

  return {
    url,
    name,
    drop: () => {
      // The pool holds connections open; Postgres will not drop out from
      // under them.
      psql(
        admin,
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`,
      );
      psql(admin, `DROP DATABASE IF EXISTS "${name}"`);
    },
  };
}

function psql(url: string, statement: string) {
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: "pipe" });
}

/* -------------------------------------------------------------------------- */
/* Something to send from                                                     */
/* -------------------------------------------------------------------------- */

export interface Seeded {
  orgId: string;
  userId: string;
  domainId: string;
  mailboxId: string;
  address: string;
}

/**
 * The smallest account that can send: one organization, one verified domain,
 * one mailbox on it.
 */
export async function seedAccount(): Promise<Seeded> {
  const { db } = await import("@/db");
  const { domain, mailbox, organization, user } = await import("@/db/schema");

  const userId = newId("usr");
  const orgId = newId("org");
  const domainId = newId("dom");
  const mailboxId = newId("mbx");
  const name = "example.test";
  const address = `sender@${name}`;

  await db.insert(user).values({
    id: userId,
    name: "Test Owner",
    email: `owner-${userId}@example.test`,
    emailVerified: true,
  });
  await db.insert(organization).values({ id: orgId, name: "Test Co", slug: `test-${orgId}` });
  await db.insert(domain).values({
    id: domainId,
    organizationId: orgId,
    name,
    region: "us-east-1",
    status: "verified",
    sendingEnabled: true,
  });
  await db.insert(mailbox).values({
    id: mailboxId,
    organizationId: orgId,
    domainId,
    address,
    domain: name,
    displayName: "Test Sender",
  });

  return { orgId, userId, domainId, mailboxId, address };
}
