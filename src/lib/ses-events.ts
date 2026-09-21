import type { EventType } from "@aws-sdk/client-sesv2";

/**
 * Everything SES can tell us about a message after it leaves, and what each
 * one costs. Two of them change the message itself rather than only reporting
 * on it, so they are described plainly enough to decide against.
 *
 * Kept out of `server/events.ts` because the settings panel is a client
 * component and that module is server-only.
 */
export interface EventKind {
  type: EventType;
  label: string;
  hint: string;
  /** Turning this off would break something the app relies on. */
  required?: boolean;
  /** SES alters outgoing HTML to collect this. */
  altersMessage?: boolean;
}

export const EVENT_KINDS: EventKind[] = [
  { type: "SEND", label: "Accepted", hint: "SES took the message", required: true },
  {
    type: "DELIVERY",
    label: "Delivered",
    hint: "The receiving server accepted it",
    required: true,
  },
  {
    type: "BOUNCE",
    label: "Bounced",
    hint: "Refused for good. Adds the address to the suppression list",
    required: true,
  },
  {
    type: "COMPLAINT",
    label: "Marked as spam",
    hint: "Adds the address to the suppression list",
    required: true,
  },
  { type: "REJECT", label: "Rejected", hint: "SES refused to send it at all", required: true },
  { type: "DELIVERY_DELAY", label: "Delayed", hint: "Still being retried. Not a failure yet" },
  {
    type: "RENDERING_FAILURE",
    label: "Render failure",
    hint: "A template placeholder had no value",
  },
  {
    type: "OPEN",
    label: "Opens",
    hint: "SES adds an invisible tracking image to every HTML message",
    altersMessage: true,
  },
  {
    type: "CLICK",
    label: "Clicks",
    hint: "SES rewrites every link to route the reader through AWS first",
    altersMessage: true,
  },
  {
    type: "SUBSCRIPTION",
    label: "Unsubscribes",
    hint: "Someone used the unsubscribe link SES manages",
  },
];

export const KNOWN_EVENTS = new Set<EventType>(EVENT_KINDS.map((kind) => kind.type));

/** The ones the app reads to decide what happened to a message. */
export const REQUIRED_EVENTS: EventType[] = EVENT_KINDS.filter((kind) => kind.required).map(
  (kind) => kind.type,
);

/** What a fresh pipeline asks for. Clicks are left out: they rewrite links. */
export const DEFAULT_EVENTS: EventType[] = [
  ...REQUIRED_EVENTS,
  "DELIVERY_DELAY",
  "RENDERING_FAILURE",
  "OPEN",
];
