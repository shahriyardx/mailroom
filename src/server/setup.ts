import "server-only";
import { db } from "@/db";
import { domain } from "@/db/schema";
import { env } from "@/lib/env";
import { and, eq } from "drizzle-orm";
import { hasWorkspace, workspaceSettings } from "./workspace";

/**
 * What a new instance still has to do.
 *
 * Two things, and deliberately only two.
 *
 * It used to list five: the inbound worker, a mailbox, a list. Each of those
 * is a real job with a real screen, and none of them can be done from here —
 * so they were five links off the end of a wizard, three of which needed a
 * Cloudflare token or a verified domain that did not exist yet. A checklist
 * of things you cannot yet do is a list of ways to feel behind.
 *
 * What is left is what a new instance genuinely cannot start without: keys to
 * send with, and a domain to send from. The domain is added here, in a
 * dialog, because adding one is a single field — publishing its DNS records
 * is the long part, and that belongs in Settings → Domains where somebody
 * will be coming back to check on it anyway.
 *
 * Neither is a stored "done" flag. Both are live checks, so an item that
 * stops being true goes back to undone.
 */

export interface SetupStep {
  key: string;
  title: string;
  detail: string;
  /** Only where a step is somebody else's page entirely, like the docs. */
  href?: string;
  done: boolean;
}

export interface SetupState {
  /**
   * True once the first two questions have been answered at least once.
   *
   * Which is how coming back lands on the checklist rather than on "what will
   * you use this for?" — a reload used to send somebody to the first screen
   * to answer a question they had already answered.
   */
  started: boolean;
  brandName: string | null;
  inboxEnabled: boolean;
  campaignsEnabled: boolean;
  steps: SetupStep[];
  /** Every step that is neither done nor skipped. */
  remaining: number;
}

export async function setupState(orgId: string): Promise<SetupState> {
  const settings = await workspaceSettings(orgId);
  // The row is written by the first answer, so its existence is the mark.
  const started = await hasWorkspace(orgId);

  const [domains, verifiedDomains] = await Promise.all([
    db.$count(domain, eq(domain.organizationId, orgId)),
    db.$count(domain, and(eq(domain.organizationId, orgId), eq(domain.sendingEnabled, true))),
  ]);

  /*
   * SES credentials come from the environment, not from a screen, so this
   * cannot be a step somebody completes here. It is still listed: an instance
   * with no keys sends nothing, and finding that out from a failed send is
   * worse than finding out from a checklist.
   *
   * Empty keys are also how an instance running on an EC2 instance role is
   * configured, so this reports what it can see rather than claiming failure.
   */
  const sesConfigured = Boolean(env.aws.accessKeyId && env.aws.secretAccessKey);

  const steps: SetupStep[] = [
    {
      key: "ses",
      title: "Connect Amazon SES",
      detail: sesConfigured
        ? `Keys found, region ${env.aws.region}.`
        : "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, then restart. Leave them empty only if this instance uses an IAM role.",
      href: "/docs/guide/self-hosting",
      done: sesConfigured,
    },
    {
      key: "domain",
      title: "Add a domain",
      /*
       * Added counts, verified does not.
       *
       * Verification is DNS, which is somebody else's console and up to a
       * day of waiting. Holding the checklist open on it would mean nobody
       * finishes setting up on the day they install this.
       */
      detail:
        verifiedDomains > 0
          ? `${verifiedDomains} verified.`
          : domains > 0
            ? "Added. Publish its DNS records in Settings → Domains."
            : "The domain your mail is sent from.",
      done: domains > 0,
    },
  ];

  return {
    started,
    brandName: settings.brandName,
    inboxEnabled: settings.inboxEnabled,
    campaignsEnabled: settings.campaignsEnabled,
    steps,
    remaining: steps.filter((step) => !step.done).length,
  };
}
