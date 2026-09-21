import { db } from "@/db";
import { domain, mailbox, organization } from "@/db/schema";
import { ok } from "@/lib/api-http";
import { SCOPES } from "@/lib/api-scopes";
import { env } from "@/lib/env";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { WEBHOOK_EVENTS } from "@/server/webhooks";
import { asc, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/me — what this key is and what it may do.
 *
 * The first call anybody makes while wiring up a client, and the fastest way
 * to tell a missing scope from a wrong URL.
 */
export const GET = apiRoute(null, async ({ caller }) => {
  const [company] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, caller.orgId))
    .limit(1);

  const reachable = await callerMailboxIds(caller);

  const [named, domains] = await Promise.all([
    reachable.length > 0
      ? db
          .select({ id: mailbox.id, address: mailbox.address })
          .from(mailbox)
          .where(inArray(mailbox.id, reachable))
          .orderBy(asc(mailbox.address))
      : Promise.resolve([] as { id: string; address: string }[]),
    caller.reach.domainIds.length > 0
      ? db
          .select({ id: domain.id, name: domain.name })
          .from(domain)
          .where(inArray(domain.id, caller.reach.domainIds))
          .orderBy(asc(domain.name))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return ok({
    object: "api_key",
    id: caller.keyId,
    name: caller.keyName,
    /** "live" or "test". A test key never hands anything to SES. */
    mode: caller.testMode ? "test" : "live",
    scopes: caller.rawScopes,
    organization: company ? { id: company.id, name: company.name } : null,
    reach: {
      unrestricted: caller.reach.unrestricted,
      domains,
      mailboxes: named,
    },
    reachable_mailboxes: reachable.length,
    rate_limit_per_minute: caller.rateLimit,
    api: {
      version: "v1",
      base_url: `${env.appUrl.replace(/\/+$/, "")}/api/v1`,
      all_scopes: SCOPES,
      webhook_events: WEBHOOK_EVENTS,
    },
  });
});
