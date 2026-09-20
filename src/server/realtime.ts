import "server-only";

import { EventEmitter } from "node:events";
import { rawSql } from "@/db";

/** What a browser is told has happened. Kept small: NOTIFY caps at 8000 bytes. */
export interface MailEvent {
  type: "mail:received" | "mail:sent" | "mail:changed";
  userId: string;
  mailboxId?: string;
  threadId?: string;
  /** Only for a received message, so a notification can name the sender. */
  from?: string;
  subject?: string;
}

const CHANNEL = "mailroom_events";

/**
 * One LISTEN per process, fanned out to the connected browsers in it. A
 * listener holds its own connection, so opening one per browser would drain
 * the pool; and going through Postgres rather than an in-process emitter
 * means a message ingested by one container reaches a browser attached to
 * another.
 */
const globalForEvents = globalThis as unknown as {
  mailroomBus?: EventEmitter;
  mailroomListening?: Promise<unknown>;
};

function bus() {
  if (!globalForEvents.mailroomBus) {
    const emitter = new EventEmitter();
    // One per connected browser, not a leak.
    emitter.setMaxListeners(0);
    globalForEvents.mailroomBus = emitter;
  }
  return globalForEvents.mailroomBus;
}

function ensureListening() {
  if (globalForEvents.mailroomListening) return globalForEvents.mailroomListening;

  globalForEvents.mailroomListening = rawSql()
    .listen(CHANNEL, (payload) => {
      try {
        bus().emit("event", JSON.parse(payload) as MailEvent);
      } catch {
        // A payload we cannot read is not worth taking the listener down for.
      }
    })
    .catch((error) => {
      // Let the next subscriber try again rather than failing for good.
      globalForEvents.mailroomListening = undefined;
      throw error;
    });

  return globalForEvents.mailroomListening;
}

/** Tells every browser on this account that something happened. */
export async function publish(event: MailEvent) {
  try {
    // A subject can be arbitrarily long and NOTIFY caps the payload, so trim
    // it to what a notice would show anyway.
    const trimmed: MailEvent = {
      ...event,
      from: event.from?.slice(0, 120),
      subject: event.subject?.slice(0, 160),
    };
    await rawSql().notify(CHANNEL, JSON.stringify(trimmed));
  } catch {
    // Live updates are a convenience. Losing one must never fail the send or
    // the delivery that triggered it.
  }
}

/** Calls back for this user's events until the returned function is called. */
export async function subscribe(userId: string, onEvent: (event: MailEvent) => void) {
  await ensureListening();

  const handler = (event: MailEvent) => {
    if (event.userId === userId) onEvent(event);
  };

  bus().on("event", handler);
  return () => bus().off("event", handler);
}
