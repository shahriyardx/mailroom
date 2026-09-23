import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * The ceiling on how much bulk mail leaves in an hour.
 *
 * It exists for warming a new sending domain, where going from nothing to
 * tens of thousands of messages in an afternoon is read by every provider as
 * a compromised account. Two things about it are load-bearing: it counts
 * campaigns and automations together, because a cap that covered only one
 * would be a cap somebody trusted while the other quietly spent it, and it is
 * a ceiling rather than a schedule — nothing is dropped when it is reached.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("send-rate");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { workspace } = await import("@/db/schema");
  await db.delete(workspace);
});

async function cap(perHour: number | null) {
  const { saveWorkspaceSettings } = await import("@/server/workspace");
  await saveWorkspaceSettings(account.orgId, { sendRatePerHour: perHour });
}

describe("the hourly ceiling", () => {
  it("is uncapped when nobody set one", async () => {
    const { sendBudget } = await import("@/server/send-rate");
    const budget = await sendBudget(account.orgId);
    assert.equal(budget.limit, null);
    assert.equal(budget.remaining, Number.POSITIVE_INFINITY);
  });

  it("reports the whole allowance when nothing has gone out", async () => {
    const { sendBudget } = await import("@/server/send-rate");
    await cap(500);

    const budget = await sendBudget(account.orgId);
    assert.equal(budget.limit, 500);
    assert.equal(budget.remaining, 500);
  });

  it("treats zero as no limit rather than as a full stop", async () => {
    // Saving 0 must not silently block every send on the instance.
    const { sendBudget } = await import("@/server/send-rate");
    await cap(0);

    const budget = await sendBudget(account.orgId);
    assert.equal(budget.limit, null);
    assert.equal(budget.remaining, Number.POSITIVE_INFINITY);
  });
});
