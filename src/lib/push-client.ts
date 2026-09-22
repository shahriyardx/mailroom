/**
 * The browser half of desktop notifications.
 *
 * Three separate things have to be true before one can be shown, and they
 * fail differently: the browser has to support push at all, the person has to
 * grant permission, and the push service has to hand back a subscription. So
 * each step says which one it was rather than resolving to a bare false.
 */

export type PushSupport = "ready" | "unsupported" | "insecure";

/**
 * Whether asking is even worth offering.
 *
 * Push needs a secure context, which is https or localhost. Self-hosted
 * instances get set up over plain http often enough that saying so beats a
 * button that silently does nothing.
 */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window)) return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return "ready";
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function registration() {
  // Registering the same worker twice is a no-op, so this is safe to call on
  // every visit to the settings page.
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** The subscription this browser already has, if it has one. */
export async function currentSubscription(): Promise<PushSubscriptionJSON | null> {
  if (pushSupport() !== "ready") return null;
  try {
    const worker = await navigator.serviceWorker.getRegistration("/");
    const existing = await worker?.pushManager.getSubscription();
    return existing ? existing.toJSON() : null;
  } catch {
    return null;
  }
}

export interface Subscribed {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
}

/**
 * Asks for permission and subscribes, returning what the server needs to
 * reach this browser.
 *
 * Throws with a sentence worth showing, because every failure here is
 * something the person has to act on: a blocked permission, a browser without
 * a push service, a key the server has not been given.
 */
export async function subscribe(publicKey: string): Promise<Subscribed> {
  const support = pushSupport();
  if (support === "insecure") {
    throw new Error("Notifications need a secure connection. Open Mailroom over https.");
  }
  if (support === "unsupported") {
    throw new Error("This browser cannot show push notifications.");
  }
  if (!publicKey) {
    throw new Error("This instance has no push keys set, so it cannot send notifications.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in the browser's site settings."
        : "Notifications were not allowed.",
    );
  }

  const worker = await registration();
  // A worker that is installing cannot be subscribed to yet.
  await navigator.serviceWorker.ready;

  const existing = await worker.pushManager.getSubscription();

  /**
   * An existing subscription made against a different key is useless: the
   * push service checks the signature, so messages signed with the new pair
   * would be refused. That happens whenever the instance's keys are rotated,
   * and the fix is to start again rather than to keep a dead one.
   */
  if (existing && !sameKey(existing, publicKey)) {
    await existing.unsubscribe();
  }

  const subscription =
    existing && sameKey(existing, publicKey)
      ? existing
      : await worker.pushManager.subscribe({
          // Every push must result in something visible. Browsers enforce it,
          // and it is also the only honest thing to promise.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser did not return a usable subscription.");
  }

  return {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    label: describeBrowser(),
  };
}

/** Stops this browser being sent anything, on this device only. */
export async function unsubscribe(): Promise<string | null> {
  const worker = await navigator.serviceWorker.getRegistration("/");
  const existing = await worker?.pushManager.getSubscription();
  if (!existing) return null;

  const { endpoint } = existing;
  await existing.unsubscribe();
  return endpoint;
}

function sameKey(subscription: globalThis.PushSubscription, publicKey: string) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  return bytesToBase64Url(new Uint8Array(current)) === publicKey.replace(/=+$/, "");
}

/** A name for this device in a list of them. Rough on purpose. */
function describeBrowser() {
  const agent = navigator.userAgent;
  const browser = /Firefox\//.test(agent)
    ? "Firefox"
    : /Edg\//.test(agent)
      ? "Edge"
      : /OPR\//.test(agent)
        ? "Opera"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : "Browser";

  const platform = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad/.test(agent)
      ? "iOS"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "";

  return platform ? `${browser} on ${platform}` : browser;
}

/** VAPID keys travel as base64url; `subscribe` wants the bytes. */
function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
