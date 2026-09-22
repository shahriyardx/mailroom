import "server-only";
import { db } from "@/db";
import { workspace } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * What this instance is, and what it looks like.
 *
 * Two products share this codebase: a team's mailboxes, and a marketing list.
 * Which of them an instance shows is a decision made once, in the first-run
 * wizard, and changed rarely — so it is read on nearly every page and written
 * almost never. That shape is why the row is created on demand rather than at
 * sign-up: an instance that upgraded into this feature has no row yet, and a
 * missing row has to mean the defaults rather than an error.
 */

export interface WorkspaceSettings {
  inboxEnabled: boolean;
  campaignsEnabled: boolean;
  brandName: string | null;
  brandLogo: string | null;
  brandAccent: string | null;
  /** Null until the first-run wizard has been finished. */
  setupCompletedAt: Date | null;
}

/*
 * Inbox on, campaigns off.
 *
 * An instance that has never answered the question is the one this codebase
 * started as, and turning campaigns on for somebody who did not ask for it
 * would put a "Broadcasts" item in their navigation overnight.
 */
const DEFAULTS: WorkspaceSettings = {
  inboxEnabled: true,
  campaignsEnabled: false,
  brandName: null,
  brandLogo: null,
  brandAccent: null,
  setupCompletedAt: null,
};

export async function workspaceSettings(orgId: string): Promise<WorkspaceSettings> {
  const row = await db.query.workspace.findFirst({
    where: eq(workspace.organizationId, orgId),
  });
  if (!row) return DEFAULTS;

  return {
    inboxEnabled: row.inboxEnabled,
    campaignsEnabled: row.campaignsEnabled,
    brandName: row.brandName,
    brandLogo: row.brandLogo,
    brandAccent: row.brandAccent,
    setupCompletedAt: row.setupCompletedAt,
  };
}

/**
 * Changes some of it, leaving the rest alone.
 *
 * Upserts rather than updates, because the row is made on first write: the
 * wizard's first step must work on an instance that has never had one.
 */
export async function saveWorkspaceSettings(
  orgId: string,
  patch: Partial<Omit<WorkspaceSettings, "setupCompletedAt">> & { setupCompleted?: boolean },
) {
  const { setupCompleted, ...rest } = patch;

  /*
   * Never both on and off at once.
   *
   * An instance with neither switch on has navigation with nothing in it and
   * no way back except the settings page it just hid. Refusing is kinder than
   * rendering that, and there is no sensible reason to ask for it.
   */
  const current = await workspaceSettings(orgId);
  const inbox = rest.inboxEnabled ?? current.inboxEnabled;
  const campaigns = rest.campaignsEnabled ?? current.campaignsEnabled;
  if (!inbox && !campaigns) {
    throw new Error("Leave at least one of Inbox and Campaigns switched on");
  }

  const values = {
    ...rest,
    ...(setupCompleted === true ? { setupCompletedAt: new Date() } : {}),
    updatedAt: new Date(),
  };

  await db
    .insert(workspace)
    .values({ organizationId: orgId, ...values })
    .onConflictDoUpdate({ target: workspace.organizationId, set: values });
}

/** True when nobody has been through the first-run wizard yet. */
export async function needsSetup(orgId: string) {
  const settings = await workspaceSettings(orgId);
  return settings.setupCompletedAt === null;
}
