import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readView, wayOut } from "@/lib/last-view";

/**
 * The one way out of settings.
 *
 * Settings is shared by both halves of the app, so the back link is the only
 * thing telling somebody which half they are returning to. Sending a
 * campaigns-only instance to the inbox is sending it to a screen that is
 * switched off.
 */

const BOTH = { inbox: true, campaigns: true };
const MAIL_ONLY = { inbox: true, campaigns: false };
const CAMPAIGNS_ONLY = { inbox: false, campaigns: true };

describe("where the way out of settings goes", () => {
  it("goes to the only half that is switched on", () => {
    assert.equal(wayOut(MAIL_ONLY, null).href, "/mail/all/inbox");
    assert.equal(wayOut(CAMPAIGNS_ONLY, null).href, "/campaigns");
  });

  it("ignores a remembered view that has since been switched off", () => {
    // Otherwise the door leads to a room that no longer exists.
    assert.equal(wayOut(CAMPAIGNS_ONLY, "mail").href, "/campaigns");
    assert.equal(wayOut(MAIL_ONLY, "campaigns").href, "/mail/all/inbox");
  });

  it("follows what was remembered when both are real places", () => {
    assert.equal(wayOut(BOTH, "campaigns").href, "/campaigns");
    assert.equal(wayOut(BOTH, "mail").href, "/mail/all/inbox");
  });

  it("falls back to mail when nothing was remembered", () => {
    assert.equal(wayOut(BOTH, null).href, "/mail/all/inbox");
  });

  it("says where it is going", () => {
    assert.equal(wayOut(BOTH, "campaigns").label, "Back to campaigns");
    assert.equal(wayOut(BOTH, "mail").label, "Back to mail");
  });

  it("refuses a cookie holding anything else", () => {
    assert.equal(readView("campaigns"), "campaigns");
    assert.equal(readView("mail"), "mail");
    assert.equal(readView("/somewhere/else"), null);
    assert.equal(readView(undefined), null);
    assert.equal(readView(""), null);
  });
});
