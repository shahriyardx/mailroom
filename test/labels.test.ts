import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Making a label from the conversation it is for only works if the caller is
 * given the label that ended up in the table. A name that is already taken
 * inserts nothing, and an id for a row that was never written is worse than
 * an error: the label appears to be applied and is not.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("labels");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { label } = await import("@/db/schema");
  await db.delete(label);
});

describe("adding a label", () => {
  it("gives back an id that is really there", async () => {
    const { db } = await import("@/db");
    const { label } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { upsertLabel } = await import("@/server/labels");

    const id = await upsertLabel(account.orgId, "Newsletters", "#ff0000");
    const [row] = await db.select().from(label).where(eq(label.id, id));
    assert.equal(row?.name, "Newsletters");
  });

  it("hands back the existing one rather than a second of the same name", async () => {
    const { db } = await import("@/db");
    const { label } = await import("@/db/schema");
    const { upsertLabel } = await import("@/server/labels");

    const first = await upsertLabel(account.orgId, "Newsletters", "#ff0000");
    const again = await upsertLabel(account.orgId, "Newsletters", "#00ff00");

    assert.equal(again, first, "the same label, so a conversation can be put in it");
    assert.equal((await db.select().from(label)).length, 1, "and only one of it");
  });

  it("leaves the colour the label already had", async () => {
    const { db } = await import("@/db");
    const { label } = await import("@/db/schema");
    const { upsertLabel } = await import("@/server/labels");

    await upsertLabel(account.orgId, "Newsletters", "#ff0000");
    await upsertLabel(account.orgId, "Newsletters", "#00ff00");

    const [row] = await db.select().from(label);
    assert.equal(row?.color, "#ff0000", "finding a label is not restyling it");
  });
});
