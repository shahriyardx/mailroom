import { ApiError, listThreads, threadUrl } from "@/lib/api";
import { displayName, rowPerson, threadSubject } from "@/lib/format";
import { type Settings, getSettings, isConnected } from "@/lib/settings";
import type { ApiThread } from "@/lib/types";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

/**
 * The part that runs when nobody is looking.
 *
 * It asks the instance for unread mail on a timer, draws the number on the
 * toolbar, and raises a notification for anything that arrived since the last
 * look. A timer and not a live stream: an MV3 worker is stopped whenever the
 * browser feels like it, so a held-open connection would be cut within the
 * minute and reconnected forever. An alarm survives the worker dying, which
 * is exactly the property needed here.
 */

const ALARM = "mailroom:poll";
const SEEN_KEY = "seen";
const STATE_KEY = "state";

/** Ids already announced, with when their thread last moved. */
type Seen = Record<string, number>;

interface State {
  unread: number;
  lastPolledAt: number | null;
  /** Set once the first poll has been taken as the starting point. */
  primed: boolean;
  error: string | null;
}

const BLANK: State = { unread: 0, lastPolledAt: null, primed: false, error: null };

/** More than this at once is a wall of pop-ups, so the rest become one line. */
const MAX_NOTIFICATIONS = 4;

async function getState(): Promise<State> {
  const stored = await browser.storage.local.get(STATE_KEY);
  return { ...BLANK, ...((stored[STATE_KEY] ?? {}) as Partial<State>) };
}

async function setState(patch: Partial<State>) {
  const next = { ...(await getState()), ...patch };
  await browser.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function getSeen(): Promise<Seen> {
  const stored = await browser.storage.local.get(SEEN_KEY);
  return (stored[SEEN_KEY] ?? {}) as Seen;
}

/* ------------------------------------------------------------- the toolbar */

async function paintBadge(count: number, settings: Settings) {
  const text = !settings.badge || count === 0 ? "" : count > 99 ? "99+" : String(count);
  try {
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color: "#5b5bd6" });
    // Firefox picks its own text colour, and picks a poor one against indigo.
    // Chrome grew this call later than the rest, so it is allowed to be absent.
    const action = browser.action as typeof browser.action & {
      setBadgeTextColor?: (details: { color: string }) => Promise<void>;
    };
    await action.setBadgeTextColor?.({ color: "#ffffff" });
  } catch {
    // A browser that cannot paint a badge still polls and notifies.
  }
}

async function setTitle(text: string) {
  try {
    await browser.action.setTitle({ title: text });
  } catch {
    // Not worth failing a poll over.
  }
}

/* ------------------------------------------------------------ the poll loop */

async function poll(): Promise<void> {
  const settings = await getSettings();

  if (!isConnected(settings)) {
    await paintBadge(0, settings);
    await setTitle("Mailroom — not connected");
    await setState({ unread: 0, error: null });
    return;
  }

  let threads: ApiThread[];
  try {
    const result = await listThreads(settings, "unread", { limit: 25 });
    threads = result.threads;
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : "Something went wrong while checking for new mail.";
    await setState({ error: message, lastPolledAt: Date.now() });
    await setTitle(`Mailroom — ${message}`);
    // The badge is left as it was: blanking it on a dropped connection would
    // read as "you have nothing", which is a different and wrong claim.
    return;
  }

  const unread = threads.length;
  const state = await getState();
  const seen = await getSeen();

  await paintBadge(unread, settings);
  await setTitle(unread === 0 ? "Mailroom" : `Mailroom — ${unread} unread`);

  const fresh = threads.filter((thread) => {
    const stamp = Date.parse(thread.last_message_at);
    const known = seen[thread.id];
    return known === undefined || stamp > known;
  });

  // The first poll after connecting decides what "already there" means.
  // Announcing a full inbox the moment somebody pastes their key would be a
  // notification storm for mail they have already read somewhere else.
  if (state.primed && settings.notifications && fresh.length > 0) {
    await announce(fresh);
  }

  const next: Seen = {};
  for (const thread of threads) next[thread.id] = Date.parse(thread.last_message_at);
  // Only unread threads are kept, so the record cannot grow without bound:
  // reading something drops it from the list and from here on the next poll.
  await browser.storage.local.set({ [SEEN_KEY]: next });

  await setState({ unread, lastPolledAt: Date.now(), primed: true, error: null });
}

async function announce(threads: ApiThread[]) {
  const icon = browser.runtime.getURL("/icon/128.png");
  const shown = threads.slice(0, MAX_NOTIFICATIONS);

  for (const thread of shown) {
    const from = displayName(rowPerson(thread, "inbox"));
    try {
      await browser.notifications.create(`thread:${thread.id}`, {
        type: "basic",
        iconUrl: icon,
        title: from,
        message: threadSubject(thread),
      });
    } catch {
      // A browser with notifications switched off at the OS level throws
      // here. The badge already said the same thing.
    }
  }

  const rest = threads.length - shown.length;
  if (rest > 0) {
    try {
      await browser.notifications.create(`more:${Date.now()}`, {
        type: "basic",
        iconUrl: icon,
        title: "Mailroom",
        message: `and ${rest} more new ${rest === 1 ? "message" : "messages"}`,
      });
    } catch {
      // As above.
    }
  }
}

/* ------------------------------------------------------------------ wiring */

async function schedule() {
  const settings = await getSettings();
  const minutes = Math.max(1, Math.min(60, settings.pollMinutes || 2));
  await browser.alarms.clear(ALARM);
  await browser.alarms.create(ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void schedule().then(poll);
  });

  browser.runtime.onStartup.addListener(() => {
    void schedule().then(poll);
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void poll();
  });

  /**
   * A changed instance, key or mailbox selection means everything counted so
   * far is about somewhere else. The record of what has been announced is
   * dropped with it, and the next poll becomes the new starting point.
   */
  browser.storage.local.onChanged.addListener((changes) => {
    const change = changes.settings;
    if (!change) return;

    const before = (change.oldValue ?? {}) as Partial<Settings>;
    const after = (change.newValue ?? {}) as Partial<Settings>;

    const movedInstance =
      before.baseUrl !== after.baseUrl ||
      before.apiKey !== after.apiKey ||
      before.watchAll !== after.watchAll ||
      JSON.stringify(before.mailboxIds ?? []) !== JSON.stringify(after.mailboxIds ?? []);

    if (movedInstance) {
      void browser.storage.local
        .set({ [SEEN_KEY]: {}, [STATE_KEY]: BLANK })
        .then(schedule)
        .then(poll);
      return;
    }

    if (before.pollMinutes !== after.pollMinutes) void schedule();
    if (before.badge !== after.badge) void poll();
  });

  browser.notifications.onClicked.addListener((id) => {
    void openFromNotification(id);
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    const kind = (message as { type?: string } | null)?.type;

    // Returning a promise is how both browsers hand a reply back from MV3.
    if (kind === "poll") return poll().then(() => ({ ok: true }));
    if (kind === "state") return getState();
    if (kind === "schedule") return schedule().then(() => ({ ok: true }));
    return undefined;
  });

  // The worker is started fresh far more often than it is installed, and an
  // alarm that was never created would leave the badge frozen for good.
  void schedule();
  void poll();
});

async function openFromNotification(id: string) {
  try {
    await browser.notifications.clear(id);
  } catch {
    // Already dismissed.
  }

  const settings = await getSettings();
  if (!isConnected(settings)) return;

  const threadId = id.startsWith("thread:") ? id.slice("thread:".length) : null;
  const url = threadId
    ? threadUrl(settings, { id: threadId }, "inbox")
    : `${settings.baseUrl}/mail/all/inbox`;

  await browser.tabs.create({ url });
}
