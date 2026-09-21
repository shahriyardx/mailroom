/**
 * What a test send is made to look like.
 *
 * A test key never hands anything to SES, so nothing will ever arrive from
 * the event stream to say what became of the message. The address it is going
 * to decides instead: that way a receiver can be pointed at this and watch a
 * bounce arrive without anybody having to bounce a real message.
 */
export type SimulatedOutcome = "delivered" | "bounced" | "complained" | "delayed";

export function simulatedOutcome(address: string): SimulatedOutcome {
  const local = address.split("@")[0]?.toLowerCase() ?? "";
  if (local.startsWith("bounce")) return "bounced";
  if (local.startsWith("complain")) return "complained";
  if (local.startsWith("delay")) return "delayed";
  return "delivered";
}

/** The SES event type each outcome would have arrived as. */
export const SIMULATED_EVENT = {
  delivered: "delivery",
  bounced: "bounce",
  complained: "complaint",
  delayed: "delivery_delay",
} as const;
