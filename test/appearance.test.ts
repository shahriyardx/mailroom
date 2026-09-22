import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * How somebody likes the app to look is the sort of thing that must survive a
 * bad value in the row: an older release wrote a name this one does not know,
 * and a settings screen that renders nothing is worse than one that renders
 * the default.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("appearance");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { preference } = await import("@/db/schema");
  await db.delete(preference);
});

describe("appearance", () => {
  it("has an answer for somebody who has never chosen", async () => {
    const { APPEARANCE_DEFAULTS, getAppearance } = await import("@/server/preferences");
    assert.deepEqual(await getAppearance(account.userId), APPEARANCE_DEFAULTS);
  });

  it("keeps what was not named", async () => {
    const { getAppearance, saveAppearance } = await import("@/server/preferences");

    await saveAppearance(account.userId, { density: "compact" });
    await saveAppearance(account.userId, { theme: "light" });

    const saved = await getAppearance(account.userId);
    assert.equal(saved.density, "compact", "changing the theme did not undo this");
    assert.equal(saved.theme, "light");
    assert.equal(saved.readingLayout, "split", "never chosen, so still the default");
  });

  it("reads a value it does not recognise as the default", async () => {
    const { db } = await import("@/db");
    const { preference } = await import("@/db/schema");
    const { getAppearance } = await import("@/server/preferences");

    await db.insert(preference).values({
      userId: account.userId,
      // Something an older release wrote, or a hand-edited row.
      density: "spacious" as never,
      readingLayout: "split",
    });

    assert.equal((await getAppearance(account.userId)).density, "comfortable");
  });
});
