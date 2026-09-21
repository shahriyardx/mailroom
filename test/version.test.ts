import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNewer } from "@/lib/version";

/**
 * An update notice that never appears looks exactly like being up to date, so
 * the cases worth writing down are the ones where comparing the strings would
 * have given the wrong answer quietly.
 */
describe("comparing releases", () => {
  it("counts the parts as numbers, not as text", () => {
    assert.equal(isNewer("0.2.10", "0.2.9"), true, "ten follows nine");
    assert.equal(isNewer("0.2.9", "0.2.10"), false);
    assert.equal(isNewer("0.10.0", "0.9.9"), true);
  });

  it("says nothing is newer than itself", () => {
    assert.equal(isNewer("0.2.1", "0.2.1"), false);
    assert.equal(isNewer("v0.2.1", "0.2.1"), false, "the tag's v is not a difference");
  });

  it("walks left to right", () => {
    assert.equal(isNewer("1.0.0", "0.99.99"), true);
    assert.equal(isNewer("0.3.0", "0.2.99"), true);
    assert.equal(isNewer("0.2.0", "0.2.1"), false);
  });

  it("treats a missing part as nought", () => {
    assert.equal(isNewer("0.3", "0.2.9"), true);
    assert.equal(isNewer("0.2", "0.2.0"), false);
    assert.equal(isNewer("0.2.1", "0.2"), true);
  });

  it("does not mistake a prerelease for a version of its own", () => {
    // "0.3.0-rc.1" reads as 0.3.0 here, which is close enough to not nag
    // somebody already running the release it became.
    assert.equal(isNewer("0.3.0-rc.1", "0.2.9"), true);
    assert.equal(isNewer("0.3.0-rc.1", "0.3.0"), false);
  });

  it("does not fall over on something that is not a version", () => {
    assert.equal(isNewer("latest", "0.2.1"), false);
    assert.equal(isNewer("", "0.2.1"), false);
  });
});
