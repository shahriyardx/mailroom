import "server-only";
import { db } from "@/db";
import { automationSend, broadcastRecipient, workspace } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * How much bulk mail this instance may still send this hour.
 *
 * The reason any of this exists is domain warming. A sending domain that goes
 * from nothing to forty thousand messages in an afternoon is treated by every
 * provider as a compromised account, and the reputation that costs takes
 * weeks to earn back. The cure is boring and slow, and nobody can follow it
 * by sitting and watching a progress bar.
 *
 * A ceiling rather than a schedule. Nothing is dropped when it is reached —
 * the rest goes out in the hours that follow, because a broadcast already
 * picks up wherever it stopped.
 */

/** A rolling window, not a clock hour: a cap that resets on the hour is a cap
 *  somebody sends their whole list through at one minute past. */
const WINDOW_MS = 60 * 60 * 1000;

export interface SendBudget {
  /** Null when no cap is set — send as fast as the batches allow. */
  limit: number | null;
  sentThisHour: number;
  /** Infinity when uncapped, so callers can compare without a special case. */
  remaining: number;
}

/**
 * Counted across campaigns and automations together.
 *
 * A cap that only covered broadcasts would be a cap somebody trusted while an
 * automation quietly sent ten times as much beside it, which is worse than
 * having no cap at all: they would stop watching.
 */
export async function sendBudget(orgId: string): Promise<SendBudget> {
  const site = await db.query.workspace.findFirst({
    where: eq(workspace.organizationId, orgId),
    columns: { sendRatePerHour: true },
  });

  const limit = site?.sendRatePerHour ?? null;
  if (limit === null || limit <= 0) {
    return { limit: null, sentThisHour: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const since = new Date(Date.now() - WINDOW_MS);

  const [broadcasts, automations] = await Promise.all([
    db
      .select({ howMany: sql<number>`count(*)`.mapWith(Number) })
      .from(broadcastRecipient)
      .where(
        and(
          eq(broadcastRecipient.organizationId, orgId),
          eq(broadcastRecipient.status, "sent"),
          gte(broadcastRecipient.sentAt, since),
        ),
      ),
    db
      .select({ howMany: sql<number>`count(*)`.mapWith(Number) })
      .from(automationSend)
      .where(and(eq(automationSend.organizationId, orgId), gte(automationSend.sentAt, since))),
  ]);

  const sentThisHour = (broadcasts[0]?.howMany ?? 0) + (automations[0]?.howMany ?? 0);
  return { limit, sentThisHour, remaining: Math.max(0, limit - sentThisHour) };
}
