import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Remote images stay blocked until a reader says otherwise, and that answer
 * belongs to the reader who gave it. Two things are worth proving: that no is
 * remembered as firmly as yes, and that one person's decision is not quietly
 * made on another's behalf — loading a remote image tells the sender that a
 * particular someone opened the message.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("imagetrust");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

async function otherReader() {
  const { db } = await import("@/db");
  const { user } = await import("@/db/schema");
  const { newId } = await import("@/lib/utils");

  const userId = newId("usr");
  await db.insert(user).values({
    id: userId,
    name: "Someone Else",
    email: `${userId}@example.test`,
    emailVerified: true,
  });
  return { userId, orgId: account.orgId };
}

const me = () => ({ userId: account.userId, orgId: account.orgId });

describe("remembering what to do with a sender's images", () => {
  it("says nothing about a sender nobody has decided about", async () => {
    const { imageChoices } = await import("@/server/image-trust");
    const choices = await imageChoices(me(), ["stranger@example.com"]);
    assert.equal(choices.has("stranger@example.com"), false, "no row means the default");
  });

  it("remembers a yes", async () => {
    const { imageChoices, rememberImageChoice } = await import("@/server/image-trust");
    await rememberImageChoice(me(), "news@example.com", true);

    const choices = await imageChoices(me(), ["news@example.com"]);
    assert.equal(choices.get("news@example.com"), true);
  });

  it("remembers a no just as firmly", async () => {
    const { imageChoices, rememberImageChoice } = await import("@/server/image-trust");
    await rememberImageChoice(me(), "tracker@example.com", false);

    const choices = await imageChoices(me(), ["tracker@example.com"]);
    assert.equal(
      choices.get("tracker@example.com"),
      false,
      "a refusal must not read the same as never having been asked",
    );
  });

  it("lets a reader change their mind", async () => {
    const { imageChoices, rememberImageChoice } = await import("@/server/image-trust");
    await rememberImageChoice(me(), "shop@example.com", true);
    await rememberImageChoice(me(), "shop@example.com", false);

    const choices = await imageChoices(me(), ["shop@example.com"]);
    assert.equal(choices.get("shop@example.com"), false, "the later answer stands");
  });

  it("does not answer for somebody else", async () => {
    const { imageChoices, rememberImageChoice } = await import("@/server/image-trust");
    const them = await otherReader();

    await rememberImageChoice(me(), "private@example.com", true);

    const theirs = await imageChoices(them, ["private@example.com"]);
    assert.equal(
      theirs.has("private@example.com"),
      false,
      "my choice reveals my reading, not theirs",
    );
  });

  it("matches on the address however it was typed", async () => {
    const { imageChoices, rememberImageChoice } = await import("@/server/image-trust");
    await rememberImageChoice(me(), "  Mixed@Example.COM ", true);

    const choices = await imageChoices(me(), ["mixed@example.com"]);
    assert.equal(choices.get("mixed@example.com"), true);
  });

  it("answers for a whole conversation at once", async () => {
    const { imageChoices, rememberImageChoice } = await import("@/server/image-trust");
    await rememberImageChoice(me(), "a@example.com", true);
    await rememberImageChoice(me(), "b@example.com", false);

    const choices = await imageChoices(me(), ["a@example.com", "b@example.com", "c@example.com"]);
    assert.equal(choices.get("a@example.com"), true);
    assert.equal(choices.get("b@example.com"), false);
    assert.equal(choices.has("c@example.com"), false);
  });
});
