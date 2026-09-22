import "server-only";
import { db } from "@/db";
import { domain, mailbox, mailingList } from "@/db/schema";
import { env } from "@/lib/env";
import { and, eq } from "drizzle-orm";
import { cloudflareStatus } from "./integrations";
import { workspaceSettings } from "./workspace";

/**
 * What a new instance still has to do.
 *
 * This is a checklist rather than a wizard that walks you through each screen.
 * Four of these steps already have a screen of their own — domains, the
 * inbound worker, mailboxes — and a wizard that reimplemented them would be a
 * second copy to keep in step, and a dead end for anybody who needed to do
 * something the simplified version did not offer.
 *
 * So the wizard owns the two decisions that have no home elsewhere (what this
 * instance is for, and what it is called) and then reports on the rest,
 * linking to the real screen for each. Leaving and coming back is expected:
 * every item is a live check, not a stored "done" flag, so an item that stops
 * being true goes back to undone.
 */

export interface SetupStep {
  key: string;
  title: string;
  detail: string;
  href: string;
  done: boolean;
  /** Not needed by this instance — shown greyed rather than hidden, so the list does not shift. */
  skipped?: boolean;
}

export interface SetupState {
  brandName: string | null;
  inboxEnabled: boolean;
  campaignsEnabled: boolean;
  steps: SetupStep[];
  /** Every step that is neither done nor skipped. */
  remaining: number;
}

export async function setupState(orgId: string): Promise<SetupState> {
  const settings = await workspaceSettings(orgId);

  const [domains, verifiedDomains, mailboxes, lists, cloudflare] = await Promise.all([
    db.$count(domain, eq(domain.organizationId, orgId)),
    db.$count(domain, and(eq(domain.organizationId, orgId), eq(domain.sendingEnabled, true))),
    db.$count(mailbox, eq(mailbox.organizationId, orgId)),
    db.$count(mailingList, eq(mailingList.organizationId, orgId)),
    cloudflareStatus(orgId),
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
      href: "https://mailroom-docs.shahriyar.dev/guide/self-hosting",
      done: sesConfigured,
    },
    {
      key: "domain",
      title: "Add a domain",
      detail:
        verifiedDomains > 0
          ? `${verifiedDomains} verified.`
          : domains > 0
            ? "Added, waiting on DNS. Copy the records and check back."
            : "The domain your mail is sent from.",
      href: "/settings/domains",
      done: verifiedDomains > 0,
    },
    {
      key: "inbound",
      title: "Turn on receiving",
      detail: cloudflare.connected
        ? "Cloudflare connected."
        : "Deploy the worker with a Cloudflare token, then switch each domain on.",
      href: "/settings/inbound",
      done: cloudflare.connected,
      skipped: !settings.inboxEnabled,
    },
    {
      key: "mailbox",
      title: "Make a mailbox",
      detail: mailboxes > 0 ? `${mailboxes} so far.` : "An address people can write to.",
      href: "/settings/mailboxes",
      done: mailboxes > 0,
      skipped: !settings.inboxEnabled,
    },
    {
      key: "list",
      title: "Make a list",
      detail: lists > 0 ? `${lists} so far.` : "Who a broadcast goes to.",
      href: "/settings/lists",
      done: lists > 0,
      skipped: !settings.campaignsEnabled,
    },
  ];

  return {
    brandName: settings.brandName,
    inboxEnabled: settings.inboxEnabled,
    campaignsEnabled: settings.campaignsEnabled,
    steps,
    remaining: steps.filter((step) => !step.done && !step.skipped).length,
  };
}
