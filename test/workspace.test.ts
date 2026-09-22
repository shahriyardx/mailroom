import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * What an instance shows, and whether it has been set up.
 *
 * Two things here are load-bearing and neither is obvious from the table: an
 * organisation with no row at all has to read as the defaults rather than as
 * an error, because that is every instance that upgraded into this feature —
 * and both switches off has to be refused, because it renders navigation with
 * no way back to the page that turned them off.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("workspace");
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

describe("an instance that has never been configured", () => {
  it("reads as inbox on, campaigns off", async () => {
    const { workspaceSettings } = await import("@/server/workspace");
    const settings = await workspaceSettings(account.orgId);

    assert.equal(settings.inboxEnabled, true);
    assert.equal(settings.campaignsEnabled, false);
  });

  it("is sent to the wizard", async () => {
    const { needsSetup } = await import("@/server/workspace");
    assert.equal(await needsSetup(account.orgId), true);
  });
});

describe("changing what the instance shows", () => {
  it("creates the row on the first write", async () => {
    const { saveWorkspaceSettings, workspaceSettings } = await import("@/server/workspace");
    await saveWorkspaceSettings(account.orgId, { campaignsEnabled: true });

    const settings = await workspaceSettings(account.orgId);
    assert.equal(settings.campaignsEnabled, true);
    // Untouched, not reset to the default by the upsert.
    assert.equal(settings.inboxEnabled, true);
  });

  it("lets both be on at once", async () => {
    const { saveWorkspaceSettings, workspaceSettings } = await import("@/server/workspace");
    await saveWorkspaceSettings(account.orgId, { inboxEnabled: true, campaignsEnabled: true });

    const settings = await workspaceSettings(account.orgId);
    assert.equal(settings.inboxEnabled, true);
    assert.equal(settings.campaignsEnabled, true);
  });

  it("refuses to turn both off", async () => {
    const { saveWorkspaceSettings } = await import("@/server/workspace");
    await assert.rejects(
      () => saveWorkspaceSettings(account.orgId, { inboxEnabled: false, campaignsEnabled: false }),
      /at least one/,
    );
  });

  it("refuses to turn off the only one that is on", async () => {
    const { saveWorkspaceSettings } = await import("@/server/workspace");
    // Campaigns is off by default, so this would leave nothing.
    await assert.rejects(
      () => saveWorkspaceSettings(account.orgId, { inboxEnabled: false }),
      /at least one/,
    );
  });

  it("keeps the wizard away once it has been finished", async () => {
    const { needsSetup, saveWorkspaceSettings } = await import("@/server/workspace");
    await saveWorkspaceSettings(account.orgId, { setupCompleted: true });

    assert.equal(await needsSetup(account.orgId), false);
  });
});
