/**
 * Mailroom's service worker.
 *
 * It exists for one job: be awake when the browser is told mail has arrived,
 * even with every Mailroom tab closed. That is the whole point of a push
 * notification over one raised from the page — the page is usually not there.
 *
 * Deliberately not a cache or an offline shell. A mail client that serves a
 * stale inbox from disk is worse than one that says it cannot reach the
 * server, so nothing here touches fetch.
 */

self.addEventListener("install", () => {
  // Take over straight away rather than waiting for every old tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push we cannot read still means something arrived, so it is worth
    // saying so rather than dropping it silently.
  }

  const title = payload.title || "New mail";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/badge.png",
    // Repeats about the same conversation replace each other instead of
    // stacking up into a column of the same subject line.
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/mail/all/inbox" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = event.notification.data?.url || "/mail/all/inbox";
  const url = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Somebody with Mailroom already open wants that window brought
      // forward and pointed at the message, not a second copy of the app.
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      }

      await self.clients.openWindow(url);
    })(),
  );
});
