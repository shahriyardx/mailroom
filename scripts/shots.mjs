/**
 * Takes the screenshots the README and the docs site use.
 *
 * Drives a headless Chromium over the DevTools protocol, which Node can speak
 * on its own — no browser-automation dependency for something that runs twice
 * a release. The instance it photographs is expected to be the showcase one
 * that scripts/seed-showcase.mjs builds, signed in with a session cookie.
 *
 *   BASE=http://localhost:3100 COOKIE=<signed session cookie> \
 *     node scripts/shots.mjs
 *
 * Writes PNGs into docs/public/shots, which both the docs site and the README
 * point at.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

const BASE = process.env.BASE ?? "http://localhost:3100";
const COOKIE = process.env.COOKIE;
const OUT = process.env.OUT ?? "docs/public/shots";
const BROWSER = process.env.CHROME ?? "/usr/bin/chromium";

if (!COOKIE) {
  console.error("COOKIE is required: a signed better-auth session cookie value.");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

/** Every picture, in the order a reader meets them. */
const SHOTS = [
  { name: "inbox", path: "/mail/all/inbox", width: 1440, height: 900 },
  { name: "conversation", path: "/mail/all/inbox?t=", width: 1440, height: 900, openFirst: true },
  { name: "compact", path: "/mail/all/inbox", width: 1440, height: 900, density: "compact" },
  { name: "settings-overview", path: "/settings/overview", width: 1440, height: 900 },
  { name: "settings-mailboxes", path: "/settings/mailboxes", width: 1440, height: 900 },
  { name: "settings-appearance", path: "/settings/appearance", width: 1440, height: 900 },
  { name: "settings-api-keys", path: "/settings/api-keys", width: 1440, height: 900 },
  { name: "mobile-inbox", path: "/mail/all/inbox", width: 414, height: 860, scale: 2 },
];

/* ------------------------------------------------------- the browser, by hand */

const browser = spawn(
  BROWSER,
  [
    "--headless=new",
    "--remote-debugging-port=9333",
    "--user-data-dir=/tmp/mailroom-shots-profile",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--disable-gpu",
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);

process.on("exit", () => browser.kill());

/** The debugging port is not open the moment the process is. */
async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9333/json/version");
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await wait(250);
  }
  throw new Error("Chromium never opened its debugging port.");
}

const socket = new WebSocket(await endpoint());
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let nextId = 0;
const waiting = new Map();

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    const { resolve, reject } = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});

function send(method, sessionId, params = {}) {
  nextId += 1;
  const id = nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

/* ------------------------------------------------------------------ the page */

const { targetId } = await send("Target.createTarget", undefined, { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", undefined, {
  targetId,
  flatten: true,
});

const page = (method, params) => send(method, sessionId, params);

await page("Page.enable");
await page("Runtime.enable");
await page("Network.enable");

const host = new URL(BASE).hostname;
await page("Network.setCookie", {
  name: "better-auth.session_token",
  value: COOKIE,
  domain: host,
  path: "/",
});

/** Asks the page a question until it says yes, or gives up. */
async function until(expression, tries = 80) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const { result } = await page("Runtime.evaluate", { expression, returnByValue: true });
    if (result.value) return result.value;
    await wait(250);
  }
  return null;
}

for (const shot of SHOTS) {
  const scale = shot.scale ?? 2;
  await page("Emulation.setDeviceMetricsOverride", {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: scale,
    mobile: shot.width < 700,
  });

  // Appearance lives in the database, so a different density is a different
  // cookie-free round trip: set it, then come back.
  if (shot.density) {
    await page("Page.navigate", { url: `${BASE}/settings/appearance` });
    await until("!!document.querySelector('button[aria-pressed]')");
    await page("Runtime.evaluate", {
      expression: `[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Compact'))?.click()`,
    });
    await wait(1500);
  }

  let url = `${BASE}${shot.path}`;

  if (shot.openFirst) {
    await page("Page.navigate", { url: `${BASE}/mail/all/inbox` });
    await until("!!document.querySelector('li a[href*=\"t=thr_\"]')");
    const href = await until(
      "document.querySelector('li a[href*=\"t=thr_\"]')?.getAttribute('href')",
    );
    url = new URL(href, BASE).toString();
  }

  await page("Page.navigate", { url });
  await until("document.readyState === 'complete'");
  // The list and the message frames settle a beat after the document does.
  await wait(2500);

  const { data } = await page("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(`${OUT}/${shot.name}.png`, Buffer.from(data, "base64"));
  console.log(`${shot.name}.png  ${shot.width}×${shot.height} @${scale}x`);
}

// Put the instance back the way it was found.
await page("Page.navigate", { url: `${BASE}/settings/appearance` });
await until("!!document.querySelector('button[aria-pressed]')");
await page("Runtime.evaluate", {
  expression: `[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Comfortable'))?.click()`,
});
await wait(1200);

socket.close();
browser.kill();
console.log(`Written to ${OUT}`);
