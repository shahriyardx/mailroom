/**
 * The events an endpoint can subscribe to.
 *
 * Kept out of the server module so the settings screen can list them without
 * pulling the delivery machinery — and everything it imports — into the
 * browser bundle.
 */
export const WEBHOOK_EVENTS = [
  "mail.received",
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.opened",
  "email.delayed",
  "email.rejected",
  "thread.updated",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** What each event means, in the words the settings screen shows. */
export const WEBHOOK_EVENT_NOTES: Record<WebhookEvent, string> = {
  "mail.received": "A message arrived in a mailbox",
  "email.sent": "A message was handed to SES",
  "email.delivered": "The receiving server accepted it",
  "email.bounced": "It came back",
  "email.complained": "Somebody marked it as spam",
  "email.opened": "The tracking image was loaded",
  "email.delayed": "SES is still trying",
  "email.rejected": "SES refused to send it",
  "thread.updated": "A thread was moved, read, starred or labelled through the API",
};
