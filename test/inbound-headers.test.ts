import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMailedBy, parseSignedBy, parseTls } from "../worker/src/headers";

/**
 * These three are regexes over text written by thousands of different senders,
 * and they end up on screen as claims about who a message came from. The
 * samples below are shaped like real headers rather than minimal ones, because
 * the failure worth catching is a pattern that matches the tidy case and picks
 * the wrong domain out of a message carrying several.
 */

const headers = (pairs: [string, string][]) => pairs.map(([key, value]) => ({ key, value }));

/** An npm receipt relayed through Amazon SES: two signatures, one envelope. */
const npm = headers([
  [
    "Received",
    "from a8-96.smtp-out.amazonses.com (a8-96.smtp-out.amazonses.com [54.240.8.96]) by mx.cloudflare.net with ESMTPS id abc123 (version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256) for <contact@ccbot.app>; Sun, 21 Sep 2026 17:56:21 +0000",
  ],
  ["Return-Path", "<0101019-bounces@us-west-2-amazonses.npmjs.com>"],
  ["DKIM-Signature", "v=1; a=rsa-sha256; c=relaxed/simple; s=224i4yxa; d=amazonses.com; t=1789"],
  ["DKIM-Signature", "v=1; a=rsa-sha256; c=relaxed/relaxed; d=npmjs.com; s=s1; h=From:To:Subject"],
  [
    "Authentication-Results",
    "mx.cloudflare.net; dkim=pass header.d=npmjs.com; spf=pass (domain of 0101019-bounces@us-west-2-amazonses.npmjs.com designates 54.240.8.96) smtp.mailfrom=0101019-bounces@us-west-2-amazonses.npmjs.com; dmarc=pass",
  ],
]);

describe("mailed-by", () => {
  it("reports the envelope sender's domain, not the From domain", () => {
    assert.equal(parseMailedBy(npm), "us-west-2-amazonses.npmjs.com");
  });

  it("falls back to the sender Cloudflare checked SPF against", () => {
    const only = headers([
      [
        "Authentication-Results",
        "mx.cloudflare.net; spf=pass smtp.mailfrom=bounce@mail.stripe.com",
      ],
    ]);
    assert.equal(parseMailedBy(only), "mail.stripe.com");
  });

  it("says nothing rather than guessing", () => {
    assert.equal(parseMailedBy(headers([])), null);
  });
});

describe("signed by", () => {
  it("prefers the signature that lines up with the From address", () => {
    assert.equal(parseSignedBy(npm, "support@npmjs.com"), "npmjs.com");
  });

  it("treats a subdomain From as aligned with the signing domain", () => {
    const two = headers([
      ["DKIM-Signature", "v=1; d=amazonses.com; s=a"],
      ["DKIM-Signature", "v=1; d=github.com; s=b"],
    ]);
    assert.equal(parseSignedBy(two, "noreply@notifications.github.com"), "github.com");
  });

  it("reports the relay when nothing aligns, rather than claiming alignment", () => {
    const relay = headers([["DKIM-Signature", "v=1; d=sendgrid.net; s=x"]]);
    assert.equal(parseSignedBy(relay, "news@brand.com"), "sendgrid.net");
  });

  it("says nothing when the message is unsigned", () => {
    assert.equal(parseSignedBy(headers([]), "a@b.com"), null);
  });
});

describe("security", () => {
  it("reads the TLS version off the hop that accepted the message", () => {
    assert.equal(parseTls(npm), "TLS1.3");
  });

  it("calls a plaintext hop what it is", () => {
    const clear = headers([
      [
        "Received",
        "from old.example.com by mx.cloudflare.net with ESMTP id x1; Sun, 21 Sep 2026 10:00:00 +0000",
      ],
    ]);
    assert.equal(parseTls(clear), "none");
  });

  it("settles for ESMTPS when no version is stated", () => {
    const vague = headers([
      ["Received", "from x by mx.cloudflare.net with ESMTPS id x1 for <a@b.c>"],
    ]);
    assert.equal(parseTls(vague), "TLS");
  });

  it("says nothing when there is no Received header to read", () => {
    assert.equal(parseTls(headers([])), null);
  });
});
