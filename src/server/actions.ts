"use server";

import { db } from "@/db";
import {
  type Folder,
  apiKey,
  domain as domainTable,
  filterRule,
  label,
  mailbox,
  member,
  message,
  suppression,
  thread,
  threadLabel,
  webhook,
  webhookDelivery,
} from "@/db/schema";
import type { AutomationNodeKind, NodeConfig } from "@/db/schema";
import { generateApiKey, isKeyMode } from "@/lib/api-key";
import { WILDCARD, isScope } from "@/lib/api-scopes";
import { readDesign } from "@/lib/email-blocks";
import { coveringDomain, domainOf, makeSnippet, parseAddressList } from "@/lib/mail";
import { parseSchedule } from "@/lib/schedule";
import { renderTemplateParts, templateVariables } from "@/lib/template";
import { newId } from "@/lib/utils";
import { isWebhookEvent } from "@/lib/webhook-events";
import { requireAccess } from "@/server/access";
import {
  addNode,
  createAutomation,
  removeAutomation,
  removeNode,
  updateAutomation,
  updateNode,
} from "@/server/automations";
import {
  assertCanCreateList,
  assertCanManageList,
  assertCanRunAutomation,
  assertCanSendBroadcast,
  assertCanSendToList,
  automationOfNode,
  hasCampaignAccess,
  listOfMember,
  listOfSegment,
} from "@/server/campaign-access";
import {
  addMembers,
  audienceSize,
  cancelBroadcast,
  createBroadcast,
  createList,
  duplicateBroadcast,
  parseMemberList,
  removeList,
  removeMember,
  resendToNonOpeners,
  setMemberStatus,
  startBroadcast,
  updateBroadcast,
  updateList,
} from "@/server/campaigns";
import { createEvent, removeEvent, updateEvent } from "@/server/custom-events";
import {
  type Width,
  addForwardingAddress,
  addForwardingRule,
  refreshForwardingAddresses,
  removeForwardingAddress,
  removeForwardingRule,
  resendForwardingVerification,
  setForwardOff,
} from "@/server/forwarding";
import {
  assertCanManage,
  assertCanSendAs,
  creatableDomainIds,
  grantCreatorAccess,
  readableMailboxIds,
} from "@/server/grants";
import { rememberImageChoice } from "@/server/image-trust";
import { upsertLabel } from "@/server/labels";
import { assertCan, can } from "@/server/permissions";
import { type Appearance, saveAppearance } from "@/server/preferences";
import { forgetBrowser, forgetEveryBrowser, pushToUsers, rememberBrowser } from "@/server/push";
import {
  createSegment,
  readRules,
  removeSegment,
  segmentSize,
  updateSegment,
} from "@/server/segments";
import { emptyTrash, restoreThreads, trashThreads } from "@/server/trash";
import { saveWorkspaceSettings } from "@/server/workspace";
import type { EventType } from "@aws-sdk/client-sesv2";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recomputeThread } from "./aggregate";
import {
  addDomain,
  importFromSes,
  listDomainsForUser,
  refreshDomain,
  removeDomain,
  useOwnDkimKey,
} from "./domains";
import { setEventTypes, setUpEvents } from "./events";
import { type SubdomainReceiving, ensureSubdomainReceiving } from "./inbound";
import { deployWorker, removeWorker, routeZoneToWorker, unrouteZone } from "./inbound";
import { connectCloudflare, disconnectCloudflare } from "./integrations";
import { resolveScope } from "./mailboxes";
import { mailboxForSending, sendableMailboxesFor } from "./mailboxes";
import { forgetMedia } from "./media";
import { cancelJobForMessage } from "./outbox";
import { deliverMessage } from "./send";
import { markCanceled } from "./sent";
import { createTemplate, deleteTemplate, duplicateTemplate, updateTemplate } from "./templates";
import { checkWebhookUrl, makeWebhookSecret, pingWebhook } from "./webhooks";

async function assertOwnsThreads(orgId: string, threadIds: string[], allowed?: string[]) {
  if (threadIds.length === 0) return [];
  const mailboxIds = await resolveScope(orgId, { kind: "all" }, allowed);
  if (mailboxIds.length === 0) return [];
  const rows = await db
    .select({ id: thread.id })
    .from(thread)
    .where(and(inArray(thread.id, threadIds), inArray(thread.mailboxId, mailboxIds)));
  return rows.map((row) => row.id);
}

/* -------------------------------------------------------------------------- */
/* Compose and send                                                           */
/* -------------------------------------------------------------------------- */

const composeSchema = z.object({
  mailboxId: z.string().min(1),
  to: z.string().min(1),
  cc: z.string().optional().default(""),
  bcc: z.string().optional().default(""),
  subject: z.string().default(""),
  html: z.string().default(""),
  text: z.string().optional(),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  draftId: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
  /** ISO time to hold the message until. Absent means send now. */
  scheduledAt: z.string().optional(),
});

export type ComposeInput = z.input<typeof composeSchema>;

export async function sendMessageAction(raw: ComposeInput) {
  const access = await requireAccess();
  const input = composeSchema.parse(raw);
  await assertCanSendAs(access, input.mailboxId);

  let scheduledAt: Date | null = null;
  if (input.scheduledAt) {
    const parsed = parseSchedule(input.scheduledAt);
    if ("error" in parsed) throw new Error(parsed.error);
    scheduledAt = parsed.at;
  }

  const result = await deliverMessage({
    orgId: access.orgId,
    mailboxId: input.mailboxId,
    to: parseAddressList(input.to),
    cc: parseAddressList(input.cc),
    bcc: parseAddressList(input.bcc),
    subject: input.subject,
    html: input.html,
    text: input.text ?? null,
    attachmentIds: input.attachmentIds,
    senderUserId: access.userId,
    threadId: input.threadId,
    inReplyTo: input.inReplyTo,
    references: input.references,
    draftId: input.draftId,
    scheduledAt,
  });

  revalidatePath("/mail", "layout");
  return {
    threadId: result.threadId,
    messageId: result.messageId,
    status: result.status,
    scheduledAt: result.scheduledAt,
  };
}

/**
 * Calls off a message that has not gone out.
 *
 * Bounded by what this person may read, the same as every other action here:
 * a message id is not a secret, and without the check anyone signed in could
 * stop anyone else's mail.
 */
export async function cancelScheduledAction(messageId: string) {
  const access = await requireAccess();
  const mailboxIds = await resolveScope(
    access.orgId,
    { kind: "all" },
    await readableMailboxIds(access),
  );
  if (mailboxIds.length === 0) throw new Error("No such message");

  const [row] = await db
    .select({ msg: message, address: mailbox.address })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
    .where(and(eq(message.id, messageId), inArray(message.mailboxId, mailboxIds)))
    .limit(1);

  if (!row) throw new Error("No such message");
  if (row.msg.deliveryStatus !== "queued") throw new Error("That message has already been sent");

  const taken = await cancelJobForMessage(messageId);
  if (!taken) throw new Error("That message is already on its way to SES");

  await markCanceled({
    orgId: access.orgId,
    messageId: row.msg.id,
    threadId: row.msg.threadId,
    mailboxId: row.msg.mailboxId,
    mailboxAddress: row.address,
    rfcMessageId: row.msg.rfcMessageId,
    to: row.msg.to,
    cc: row.msg.cc,
    subject: row.msg.subject,
    apiKeyId: row.msg.apiKeyId,
    isTest: row.msg.isTest,
  });

  revalidatePath("/mail", "layout");
}

const draftSchema = composeSchema.partial({ to: true }).extend({ draftId: z.string().optional() });

export async function saveDraftAction(raw: z.input<typeof draftSchema>) {
  const access = await requireAccess();
  const input = draftSchema.parse(raw);
  await assertCanSendAs(access, input.mailboxId);

  const box = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, access.orgId)),
  });
  if (!box) throw new Error("Unknown mailbox");

  let threadId = input.threadId;
  if (threadId) {
    const owned = await assertOwnsThreads(
      access.orgId,
      [threadId],
      await readableMailboxIds(access),
    );
    if (owned.length === 0) threadId = undefined;
  }
  if (!threadId) {
    threadId = newId("thr");
    await db
      .insert(thread)
      .values({ id: threadId, mailboxId: box.id, subject: input.subject ?? "" });
  }

  const html = input.html ?? "";
  const values = {
    threadId,
    mailboxId: box.id,
    fromName: box.displayName,
    fromAddress: box.address,
    to: parseAddressList(input.to ?? ""),
    cc: parseAddressList(input.cc ?? ""),
    bcc: parseAddressList(input.bcc ?? ""),
    subject: input.subject ?? "",
    snippet: makeSnippet(null, html),
    htmlBody: html,
    folder: "drafts" as Folder,
    isRead: true,
    isDraft: true,
    isOutbound: true,
    receivedAt: new Date(),
  };

  const draftId = input.draftId ?? newId("msg");
  if (input.draftId) {
    await db.update(message).set(values).where(eq(message.id, input.draftId));
  } else {
    await db.insert(message).values({ id: draftId, ...values });
  }

  await recomputeThread(threadId);
  revalidatePath("/mail", "layout");
  return { draftId, threadId };
}

export async function deleteDraftAction(draftId: string) {
  const access = await requireAccess();
  // Bounded by what this person may read, not by the whole company.
  const mailboxIds = await resolveScope(
    access.orgId,
    { kind: "all" },
    await readableMailboxIds(access),
  );
  const [row] = await db
    .select({ threadId: message.threadId })
    .from(message)
    .where(
      and(
        eq(message.id, draftId),
        eq(message.isDraft, true),
        inArray(message.mailboxId, mailboxIds),
      ),
    );
  if (!row) return;
  await db.delete(message).where(eq(message.id, draftId));
  await recomputeThread(row.threadId);
  revalidatePath("/mail", "layout");
}

/* -------------------------------------------------------------------------- */
/* Thread state                                                               */
/* -------------------------------------------------------------------------- */

export async function moveThreadsAction(threadIds: string[], folder: Folder) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds, await readableMailboxIds(access));
  if (owned.length === 0) return;

  await db
    .update(message)
    .set({ folder })
    .where(and(inArray(message.threadId, owned), eq(message.isDraft, false)));

  for (const id of owned) await recomputeThread(id);
  revalidatePath("/mail", "layout");
}

export async function setReadAction(threadIds: string[], isRead: boolean) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds, await readableMailboxIds(access));
  if (owned.length === 0) return;
  await db.update(message).set({ isRead }).where(inArray(message.threadId, owned));
  for (const id of owned) await recomputeThread(id);
  revalidatePath("/mail", "layout");
}

export async function setStarAction(threadIds: string[], isStarred: boolean) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds, await readableMailboxIds(access));
  if (owned.length === 0) return;
  await db.update(message).set({ isStarred }).where(inArray(message.threadId, owned));
  await db.update(thread).set({ isStarred }).where(inArray(thread.id, owned));
  revalidatePath("/mail", "layout");
}

/**
 * Remembers whether this reader lets a sender's remote images load.
 *
 * No revalidation: the frame already has the images on screen by the time
 * this returns, and the answer only matters for the next message.
 */
export async function setImageChoiceAction(sender: string, allowed: boolean) {
  const access = await requireAccess();
  await rememberImageChoice(access, sender, allowed);
}

/**
 * Puts a conversation back where it came from.
 *
 * Each message returns to its own folder, which is the whole point: a reply
 * you wrote goes back to Sent and the message it answered goes back to the
 * inbox, and the conversation reads the way it did before. Anything with no
 * record of where it was — deleted before this was kept — goes to the inbox,
 * which is where "move to inbox" would have put it anyway.
 */
export async function restoreThreadsAction(threadIds: string[]) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds, await readableMailboxIds(access));
  await restoreThreads(owned);
  revalidatePath("/mail", "layout");
}

/** Trash first, permanent delete only from trash. */
export async function deleteThreadsAction(threadIds: string[]) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds, await readableMailboxIds(access));
  await trashThreads(owned);
  revalidatePath("/mail", "layout");
}

const appearanceSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  readingLayout: z.enum(["split", "stacked"]).optional(),
  navCollapsed: z.boolean().optional(),
});

/**
 * Changes how the app looks for whoever is signed in.
 *
 * One action for every appearance choice, because they are saved the same way
 * and a page that flips one switch should not need its own endpoint.
 */
export async function saveAppearanceAction(patch: unknown): Promise<Appearance> {
  const access = await requireAccess();
  const next = await saveAppearance(access.userId, appearanceSchema.parse(patch));
  revalidatePath("/mail", "layout");
  revalidatePath("/settings", "layout");
  return next;
}

const browserSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
  label: z.string().max(80).optional(),
});

/**
 * Registers this browser for desktop notifications.
 *
 * Saved against the signed-in person, never against an id the browser names:
 * a subscription decides whose mail gets announced on this screen, so letting
 * a caller choose the owner would be letting them read the subject lines of
 * anybody they liked.
 */
export async function subscribeToPushAction(keys: unknown) {
  const access = await requireAccess();
  await rememberBrowser(access.userId, browserSchema.parse(keys));
  revalidatePath("/settings/notifications");
}

/** Stops notifications on this one browser, leaving other devices alone. */
export async function unsubscribeFromPushAction(endpoint: unknown) {
  const access = await requireAccess();
  await forgetBrowser(access.userId, z.string().min(1).max(2000).parse(endpoint));
  revalidatePath("/settings/notifications");
}

/** Stops them everywhere, for the device that was lost rather than the one in hand. */
export async function unsubscribeEverywhereAction() {
  const access = await requireAccess();
  await forgetEveryBrowser(access.userId);
  revalidatePath("/settings/notifications");
}

/**
 * Sends one notification to this person's own browsers, and says how many it
 * reached.
 *
 * Worth having as a button: everything between the switch and a notice on
 * screen belongs to somebody else — a push service, an operating system, a
 * notification daemon — and any of them can swallow it silently.
 */
export async function testPushAction() {
  const access = await requireAccess();
  return pushToUsers([access.userId], {
    title: "Mailroom",
    body: "Notifications are working. This is what a new message will look like.",
    url: "/mail/all/inbox",
    tag: "mailroom-test",
  });
}

/** The view the trash is being emptied from, which is all it may reach. */
const scopeSchema = z.union([
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("domain"), domain: z.string().min(1) }),
  z.object({ kind: z.literal("mailbox"), mailboxId: z.string().min(1) }),
]);

/**
 * Empties the trash of whatever the reader is looking at, and says how many
 * conversations went. Scoped to the view rather than the whole account: the
 * button sits in one mailbox's trash, so it should not quietly clear another.
 */
export async function emptyTrashAction(scope: unknown) {
  const access = await requireAccess();
  const view = scopeSchema.parse(scope);
  const mailboxIds = await resolveScope(access.orgId, view, await readableMailboxIds(access));
  const count = await emptyTrash(mailboxIds);
  revalidatePath("/mail", "layout");
  return count;
}

export async function setThreadsLabelAction(threadIds: string[], labelId: string, on: boolean) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds, await readableMailboxIds(access));
  if (owned.length === 0) return;

  const owns = await db.query.label.findFirst({
    where: and(eq(label.id, labelId), eq(label.organizationId, access.orgId)),
  });
  if (!owns) return;

  if (on) {
    await db
      .insert(threadLabel)
      .values(owned.map((threadId) => ({ threadId, labelId })))
      .onConflictDoNothing();
  } else {
    await db
      .delete(threadLabel)
      .where(and(inArray(threadLabel.threadId, owned), eq(threadLabel.labelId, labelId)));
  }
  revalidatePath("/mail", "layout");
}

export async function toggleThreadLabelAction(threadId: string, labelId: string, on: boolean) {
  await setThreadsLabelAction([threadId], labelId, on);
}

/* -------------------------------------------------------------------------- */
/* Mailboxes, labels, rules                                                   */
/* -------------------------------------------------------------------------- */

const mailboxSchema = z.object({
  address: z.string().email(),
  displayName: z.string().min(1),
  signature: z.string().optional(),
  isCatchAll: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  color: z.string().optional(),
});

/** Turns wildcard capture on or off for one domain. */
export async function setDomainAutoCreateAction(domainId: string, on: boolean) {
  const access = await requireAccess();
  assertCan(access, "domain:manage");
  await db
    .update(domainTable)
    .set({ autoCreateMailboxes: on })
    .where(and(eq(domainTable.id, domainId), eq(domainTable.organizationId, access.orgId)));
  revalidatePath("/settings", "layout");
}

export async function createMailboxAction(raw: z.input<typeof mailboxSchema>) {
  const access = await requireAccess();
  const input = mailboxSchema.parse(raw);
  const address = input.address.toLowerCase();

  const domainName = domainOf(address);
  // A subdomain of a domain you own needs no identity of its own: SES lets it
  // send on the parent's verification.
  const owned = await db.query.domain.findMany({
    where: eq(domainTable.organizationId, access.orgId),
  });
  const domainRow = coveringDomain(address, owned);
  if (!domainRow) {
    throw new Error(`Add ${domainName} under Domains first, or a domain it sits beneath.`);
  }

  // Managing mailboxes is an administrator's job, unless a grant on this
  // domain says this person may add to it.
  if (!can(access, "mailbox:manage")) {
    const allowed = await creatableDomainIds(access);
    if (allowed !== "all" && !allowed.includes(domainRow.id)) {
      throw new Error(`You cannot add mailboxes on ${domainRow.name}`);
    }
  }

  const id = newId("mbx");
  await db.insert(mailbox).values({
    id,
    organizationId: access.orgId,
    address,
    domain: domainName,
    domainId: domainRow.id,
    displayName: input.displayName,
    signature: input.signature ?? null,
    isCatchAll: input.isCatchAll ?? false,
    isDefault: input.isDefault ?? false,
    color: input.color ?? "#6366f1",
  });

  if (input.isDefault) {
    await db
      .update(mailbox)
      .set({ isDefault: false })
      .where(and(eq(mailbox.organizationId, access.orgId), sql`${mailbox.id} <> ${id}`));
  }

  revalidatePath("/mail", "layout");

  // Whoever made it can run it, so adding a mailbox does not leave you
  // unable to configure the thing you just added.
  if (!can(access, "mailbox:manage")) {
    await grantCreatorAccess(access.orgId, access.memberId, id);
  }

  // A subdomain of a zone that already receives needs three MX records and
  // nothing else. Do it here so a mailbox on one simply works. A failure is
  // reported, never fatal: the mailbox exists either way.
  let receiving: SubdomainReceiving = { state: "skipped", reason: "Not a subdomain" };
  if (domainName !== domainRow.name) {
    try {
      receiving = await ensureSubdomainReceiving(access.orgId, domainName);
    } catch (error) {
      receiving = {
        state: "skipped",
        reason: error instanceof Error ? error.message : "Cloudflare could not be reached",
      };
    }
  }

  revalidatePath("/settings");
  return { id, receiving };
}

export async function updateMailboxAction(
  mailboxId: string,
  patch: Partial<z.input<typeof mailboxSchema>>,
) {
  const access = await requireAccess();
  const owns = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, mailboxId), eq(mailbox.organizationId, access.orgId)),
  });
  if (!owns) return;

  // An administrator manages every mailbox; anyone else needs a grant that
  // says manage on this one.
  if (!can(access, "mailbox:manage")) {
    await assertCanManage(access, mailboxId);
  }

  await db
    .update(mailbox)
    .set({
      displayName: patch.displayName ?? owns.displayName,
      signature: patch.signature ?? owns.signature,
      isCatchAll: patch.isCatchAll ?? owns.isCatchAll,
      isDefault: patch.isDefault ?? owns.isDefault,
      color: patch.color ?? owns.color,
    })
    .where(eq(mailbox.id, mailboxId));

  if (patch.isDefault) {
    await db
      .update(mailbox)
      .set({ isDefault: false })
      .where(and(eq(mailbox.organizationId, access.orgId), sql`${mailbox.id} <> ${mailboxId}`));
  }

  revalidatePath("/mail", "layout");
  revalidatePath("/settings");
}

/**
 * Deleting a mailbox takes its mail with it, so it stays with the people who
 * administer the instance. A grant that says manage lets someone change a
 * mailbox, not remove one.
 */
/**
 * Sets the address this person writes from by default. Their own choice, so
 * it needs nothing but the right to send as it.
 */
export async function setMyDefaultMailboxAction(mailboxId: string | null) {
  const access = await requireAccess();
  if (mailboxId) await assertCanSendAs(access, mailboxId);

  await db
    .update(member)
    .set({ defaultMailboxId: mailboxId })
    .where(eq(member.id, access.memberId));

  revalidatePath("/mail", "layout");
  revalidatePath("/settings/mailboxes");
  return { ok: true as const };
}

export async function deleteMailboxAction(mailboxId: string) {
  const access = await requireAccess();
  assertCan(access, "mailbox:manage");
  await db
    .delete(mailbox)
    .where(and(eq(mailbox.id, mailboxId), eq(mailbox.organizationId, access.orgId)));
  revalidatePath("/mail", "layout");
  revalidatePath("/settings");
}

export async function createLabelAction(name: string, color: string) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  const id = await upsertLabel(access.orgId, name, color);
  revalidatePath("/mail", "layout");
  revalidatePath("/settings");
  return { id };
}

export async function deleteLabelAction(labelId: string) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  await db.delete(label).where(and(eq(label.id, labelId), eq(label.organizationId, access.orgId)));
  revalidatePath("/mail", "layout");
}

const ruleSchema = z.object({
  name: z.string().min(1),
  matchFrom: z.string().optional(),
  matchTo: z.string().optional(),
  matchSubject: z.string().optional(),
  matchBody: z.string().optional(),
  actionFolder: z.enum(["inbox", "archive", "spam", "trash"]).optional(),
  actionLabelId: z.string().optional(),
  actionMarkRead: z.boolean().optional(),
  actionStar: z.boolean().optional(),
  priority: z.number().optional(),
});

export async function createRuleAction(raw: z.input<typeof ruleSchema>) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  const input = ruleSchema.parse(raw);
  const id = newId("rul");
  await db.insert(filterRule).values({
    id,
    organizationId: access.orgId,
    name: input.name,
    matchFrom: input.matchFrom || null,
    matchTo: input.matchTo || null,
    matchSubject: input.matchSubject || null,
    matchBody: input.matchBody || null,
    actionFolder: input.actionFolder ?? null,
    actionLabelId: input.actionLabelId || null,
    actionMarkRead: input.actionMarkRead ?? false,
    actionStar: input.actionStar ?? false,
    priority: input.priority ?? 0,
  });
  revalidatePath("/settings");
  return { id };
}

export async function deleteRuleAction(ruleId: string) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  await db
    .delete(filterRule)
    .where(and(eq(filterRule.id, ruleId), eq(filterRule.organizationId, access.orgId)));
  revalidatePath("/settings");
}

/* -------------------------------------------------------------------------- */
/* Domains (Amazon SES)                                                       */
/* -------------------------------------------------------------------------- */

export async function importDomainsAction() {
  const access = await requireAccess();
  assertCan(access, "domain:manage");
  try {
    const result = await importFromSes(access.orgId);
    revalidatePath("/settings");
    revalidatePath("/mail", "layout");
    return { ok: true as const, ...result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not reach SES",
    };
  }
}

/** Builds the SES -> SNS -> app pipeline that reports what happened to a send. */
export async function setUpEventsAction() {
  const access = await requireAccess();
  assertCan(access, "domain:manage");
  try {
    const status = await setUpEvents();
    revalidatePath("/settings", "layout");
    return { ok: true as const, status };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not set up delivery reporting",
    };
  }
}

/** Changes which events SES reports. The required ones are put back server-side. */
export async function setEventTypesAction(types: string[]) {
  const access = await requireAccess();
  assertCan(access, "domain:manage");
  try {
    const status = await setEventTypes(types as EventType[]);
    revalidatePath("/settings", "layout");
    return { ok: true as const, status };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not change delivery reporting",
    };
  }
}

export async function addDomainAction(name: string) {
  const access = await requireAccess();
  assertCan(access, "domain:manage");
  try {
    const result = await addDomain(access.orgId, name);
    revalidatePath("/settings");
    return { ok: true as const, ...result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not add the domain",
    };
  }
}

export async function refreshDomainAction(domainId: string) {
  const access = await requireAccess();
  assertCan(access, "domain:manage");
  try {
    const result = await refreshDomain(access.orgId, domainId);
    revalidatePath("/settings");
    return { ok: true as const, status: result.status };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not refresh the domain",
    };
  }
}

/** Replaces Easy DKIM with a key we generate, so one TXT record replaces three CNAMEs. */
export async function useOwnDkimKeyAction(domainId: string) {
  const access = await requireAccess();
  assertCan(access, "domain:manage");
  try {
    const result = await useOwnDkimKey(access.orgId, domainId);
    revalidatePath("/settings/domains");
    return { ok: true as const, selector: result.selector };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "SES refused the new key",
    };
  }
}

export async function removeDomainAction(domainId: string, alsoDeleteInSes: boolean) {
  const access = await requireAccess();
  assertCan(access, "domain:manage");
  await removeDomain(access.orgId, domainId, alsoDeleteInSes);
  revalidatePath("/settings");
  revalidatePath("/mail", "layout");
}

/* -------------------------------------------------------------------------- */
/* API keys                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Only scope names this build knows, and "*" on its own. A list that says
 * nothing would otherwise make a key that can do nothing, which reads as a
 * broken key rather than a deliberate one.
 */
function cleanScopes(given: string[] | undefined) {
  if (!given || given.length === 0) return [WILDCARD];
  if (given.includes(WILDCARD)) return [WILDCARD];
  const kept = [...new Set(given.filter(isScope))];
  if (kept.length === 0) throw new Error("Choose at least one thing this key may do");
  return kept;
}

export interface KeyReach {
  mailboxIds: string[];
  domainIds: string[];
}

/**
 * Keeps only addresses and domains this company actually owns. An id from a
 * form is not evidence of anything.
 */
async function cleanReach(orgId: string, reach: KeyReach | undefined): Promise<KeyReach> {
  if (!reach) return { mailboxIds: [], domainIds: [] };

  const [boxes, domains] = await Promise.all([
    reach.mailboxIds.length > 0
      ? db
          .select({ id: mailbox.id })
          .from(mailbox)
          .where(and(eq(mailbox.organizationId, orgId), inArray(mailbox.id, reach.mailboxIds)))
      : Promise.resolve([] as { id: string }[]),
    reach.domainIds.length > 0
      ? db
          .select({ id: domainTable.id })
          .from(domainTable)
          .where(
            and(eq(domainTable.organizationId, orgId), inArray(domainTable.id, reach.domainIds)),
          )
      : Promise.resolve([] as { id: string }[]),
  ]);

  const domainIds = domains.map((row) => row.id);

  // An address on a domain the key already holds is covered twice. Keeping
  // both would leave the list saying something the picker never showed.
  const covered = new Set(
    domainIds.length > 0
      ? (
          await db
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(and(eq(mailbox.organizationId, orgId), inArray(mailbox.domainId, domainIds)))
        ).map((row) => row.id)
      : [],
  );

  return {
    mailboxIds: boxes.map((row) => row.id).filter((id) => !covered.has(id)),
    domainIds,
  };
}

export async function createApiKeyAction(
  name: string,
  reach?: KeyReach,
  scopes?: string[],
  rateLimit?: number | null,
  mode: "live" | "test" = "live",
) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");

  const limited = await cleanReach(access.orgId, reach);

  const keyMode = isKeyMode(mode) ? mode : "live";
  const generated = generateApiKey(keyMode);
  const id = newId("key");

  await db.insert(apiKey).values({
    id,
    organizationId: access.orgId,
    name: name.trim() || "API key",
    prefix: generated.prefix,
    hash: generated.hash,
    // The old single-lock column, still written when the answer happens to be
    // one address, so a rollback to an earlier build still behaves.
    mailboxId:
      limited.domainIds.length === 0 && limited.mailboxIds.length === 1
        ? limited.mailboxIds[0]!
        : null,
    scopeMailboxIds: limited.mailboxIds,
    scopeDomainIds: limited.domainIds,
    scopes: cleanScopes(scopes),
    mode: keyMode,
    rateLimit: rateLimit && rateLimit > 0 ? Math.floor(rateLimit) : null,
  });

  revalidatePath("/settings");
  // The raw token is returned once here and never stored.
  return { id, token: generated.token };
}

/**
 * Changes what an existing key may do, without handing out a new one. The
 * alternative — revoke and reissue — means finding every place the old key
 * was pasted.
 */
export async function updateApiKeyAction(
  keyId: string,
  patch: { name?: string; scopes?: string[]; reach?: KeyReach; rateLimit?: number | null },
) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");

  const owns = await db.query.apiKey.findFirst({
    where: and(eq(apiKey.id, keyId), eq(apiKey.organizationId, access.orgId)),
  });
  if (!owns) return { ok: false as const, error: "Unknown key" };

  try {
    const limited = patch.reach
      ? await cleanReach(access.orgId, patch.reach)
      : { mailboxIds: owns.scopeMailboxIds, domainIds: owns.scopeDomainIds };

    await db
      .update(apiKey)
      .set({
        name: patch.name?.trim() || owns.name,
        scopes: patch.scopes ? cleanScopes(patch.scopes) : owns.scopes,
        ...(patch.reach
          ? {
              scopeMailboxIds: limited.mailboxIds,
              scopeDomainIds: limited.domainIds,
              mailboxId:
                limited.domainIds.length === 0 && limited.mailboxIds.length === 1
                  ? limited.mailboxIds[0]!
                  : null,
            }
          : {}),
        rateLimit:
          patch.rateLimit === undefined
            ? owns.rateLimit
            : patch.rateLimit && patch.rateLimit > 0
              ? Math.floor(patch.rateLimit)
              : null,
      })
      .where(eq(apiKey.id, keyId));
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not save" };
  }

  revalidatePath("/settings");
  return { ok: true as const };
}

export async function revokeApiKeyAction(keyId: string) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");
  await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKey.id, keyId), eq(apiKey.organizationId, access.orgId)));
  revalidatePath("/settings");
}

export async function deleteApiKeyAction(keyId: string) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");
  await db.delete(apiKey).where(and(eq(apiKey.id, keyId), eq(apiKey.organizationId, access.orgId)));
  revalidatePath("/settings");
}

/* -------------------------------------------------------------------------- */
/* Suppressions                                                               */
/* -------------------------------------------------------------------------- */

export async function removeSuppressionAction(suppressionId: string) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  await db
    .delete(suppression)
    .where(and(eq(suppression.id, suppressionId), eq(suppression.organizationId, access.orgId)));
  revalidatePath("/settings");
}

/* -------------------------------------------------------------------------- */
/* Cloudflare: connection, worker, routing                                    */
/* -------------------------------------------------------------------------- */

function failure(error: unknown, fallback: string) {
  return { ok: false as const, error: error instanceof Error ? error.message : fallback };
}

export async function connectCloudflareAction(token: string) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    const result = await connectCloudflare(access.orgId, token);
    revalidatePath("/settings/inbound");
    return { ok: true as const, zones: result.zones };
  } catch (error) {
    return failure(error, "Could not verify that token");
  }
}

export async function disconnectCloudflareAction() {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  await disconnectCloudflare(access.orgId);
  revalidatePath("/settings/inbound");
}

export async function deployWorkerAction() {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    const result = await deployWorker(access.orgId);
    revalidatePath("/settings/inbound");
    return { ok: true as const, scriptName: result.scriptName };
  } catch (error) {
    return failure(error, "Cloudflare refused the upload");
  }
}

export async function removeWorkerAction() {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    await removeWorker(access.orgId);
    revalidatePath("/settings/inbound");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "Could not delete the worker");
  }
}

export async function routeZoneAction(zoneId: string) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    await routeZoneToWorker(access.orgId, zoneId);
    revalidatePath("/settings/inbound");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "Could not set up routing for that zone");
  }
}

export async function unrouteZoneAction(zoneId: string, alsoDisableRouting: boolean) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    await unrouteZone(access.orgId, zoneId, alsoDisableRouting);
    revalidatePath("/settings/inbound");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "Could not change routing for that zone");
  }
}

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Webhooks are part of the API surface, so they are managed by whoever
 * manages its keys rather than by a capability of their own.
 */
export async function createWebhookAction(input: {
  url: string;
  description?: string;
  events: string[];
  mailboxId?: string | null;
  domainId?: string | null;
}) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");

  const target = checkWebhookUrl(input.url);
  if (!target.ok) return { ok: false as const, error: target.reason };

  const events = input.events.includes("*")
    ? ["*"]
    : [...new Set(input.events.filter(isWebhookEvent))];
  if (events.length === 0) {
    return { ok: false as const, error: "Choose at least one event to send" };
  }

  // One scope or the other, never both: two answers to "what does this hear
  // about" is a rule nobody can read off the screen.
  if (input.mailboxId && input.domainId) {
    return { ok: false as const, error: "Choose a mailbox or a domain, not both" };
  }

  if (input.mailboxId) {
    const owns = await db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, access.orgId)),
    });
    if (!owns) return { ok: false as const, error: "Unknown mailbox" };
  }

  if (input.domainId) {
    const owns = await db.query.domain.findFirst({
      where: and(eq(domainTable.id, input.domainId), eq(domainTable.organizationId, access.orgId)),
    });
    if (!owns) return { ok: false as const, error: "Unknown domain" };
  }

  const id = newId("whk");
  const secret = makeWebhookSecret();
  await db.insert(webhook).values({
    id,
    organizationId: access.orgId,
    url: target.url.toString(),
    description: input.description?.trim() || null,
    events,
    secret,
    mailboxId: input.mailboxId || null,
    domainId: input.domainId || null,
  });

  revalidatePath("/settings");
  // Shown once here, the same way a key is.
  return { ok: true as const, id, secret };
}

export async function updateWebhookAction(
  webhookId: string,
  patch: {
    url?: string;
    description?: string | null;
    events?: string[];
    enabled?: boolean;
    mailboxId?: string | null;
    domainId?: string | null;
  },
) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");

  const owns = await db.query.webhook.findFirst({
    where: and(eq(webhook.id, webhookId), eq(webhook.organizationId, access.orgId)),
  });
  if (!owns) return { ok: false as const, error: "Unknown webhook" };

  const target = patch.url ? checkWebhookUrl(patch.url) : null;
  if (target && !target.ok) return { ok: false as const, error: target.reason };

  const events = patch.events
    ? patch.events.includes("*")
      ? ["*"]
      : [...new Set(patch.events.filter(isWebhookEvent))]
    : owns.events;
  if (events.length === 0) return { ok: false as const, error: "Choose at least one event" };

  const mailboxId = patch.mailboxId === undefined ? owns.mailboxId : patch.mailboxId;
  const domainId = patch.domainId === undefined ? owns.domainId : patch.domainId;
  if (mailboxId && domainId) {
    return { ok: false as const, error: "Choose a mailbox or a domain, not both" };
  }
  if (patch.mailboxId) {
    const box = await db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, patch.mailboxId), eq(mailbox.organizationId, access.orgId)),
    });
    if (!box) return { ok: false as const, error: "Unknown mailbox" };
  }
  if (patch.domainId) {
    const found = await db.query.domain.findFirst({
      where: and(eq(domainTable.id, patch.domainId), eq(domainTable.organizationId, access.orgId)),
    });
    if (!found) return { ok: false as const, error: "Unknown domain" };
  }

  await db
    .update(webhook)
    .set({
      url: target?.ok ? target.url.toString() : owns.url,
      mailboxId,
      domainId,
      description: patch.description === undefined ? owns.description : patch.description,
      events,
      enabled: patch.enabled ?? owns.enabled,
      // Switching an endpoint back on is what somebody does after fixing it,
      // so the failures that turned it off no longer stand against it.
      ...(patch.enabled === true ? { consecutiveFailures: 0, lastError: null } : {}),
    })
    .where(eq(webhook.id, webhookId));

  revalidatePath("/settings");
  return { ok: true as const };
}

export async function rotateWebhookSecretAction(webhookId: string) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");

  const owns = await db.query.webhook.findFirst({
    where: and(eq(webhook.id, webhookId), eq(webhook.organizationId, access.orgId)),
  });
  if (!owns) return { ok: false as const, error: "Unknown webhook" };

  const secret = makeWebhookSecret();
  await db.update(webhook).set({ secret }).where(eq(webhook.id, webhookId));
  revalidatePath("/settings");
  return { ok: true as const, secret };
}

export async function deleteWebhookAction(webhookId: string) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");
  await db
    .delete(webhook)
    .where(and(eq(webhook.id, webhookId), eq(webhook.organizationId, access.orgId)));
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function pingWebhookAction(webhookId: string) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");

  const result = await pingWebhook(access.orgId, webhookId);
  if (!result) return { ok: false as const, error: "Unknown webhook" };

  revalidatePath("/settings");
  return result.succeeded
    ? { ok: true as const, status: result.statusCode }
    : {
        ok: false as const,
        error: result.error ?? `The endpoint replied ${result.statusCode}`,
      };
}

/** The most recent attempts at every endpoint, for the panel's history list. */
export async function recentDeliveriesAction(limit = 20) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");

  return db
    .select()
    .from(webhookDelivery)
    .where(eq(webhookDelivery.organizationId, access.orgId))
    .orderBy(sql`${webhookDelivery.createdAt} desc`)
    .limit(Math.min(limit, 100));
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

const templateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  subject: z.string().default(""),
  html: z.string().optional(),
  text: z.string().optional(),
  // Checked rather than trusted: the client is where the design comes from,
  // and readDesign drops anything that is not a block this release knows.
  design: z
    .unknown()
    .nullish()
    .transform((value) => (value === null || value === undefined ? value : readDesign(value))),
});

export async function createTemplateAction(raw: z.input<typeof templateSchema>) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  const input = templateSchema.parse(raw);

  const row = await createTemplate(access.orgId, input, access.userId);
  revalidatePath("/settings/templates");
  return { id: row.id, slug: row.slug };
}

export async function updateTemplateAction(
  id: string,
  raw: Partial<z.input<typeof templateSchema>>,
) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  const input = templateSchema.partial().parse(raw);

  const row = await updateTemplate(access.orgId, id, input);
  revalidatePath("/settings/templates");
  return { id: row.id, slug: row.slug };
}

export async function duplicateTemplateAction(id: string) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");

  const row = await duplicateTemplate(access.orgId, id, access.userId);
  revalidatePath("/settings/templates");
  return { id: row.id, slug: row.slug };
}

export async function deleteTemplateAction(id: string) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  await deleteTemplate(access.orgId, id);
  revalidatePath("/settings/templates");
}

/**
 * Sends the template to one address, to be looked at.
 *
 * Variables are filled with their own names in brackets rather than left as
 * they are: a test send is for seeing the layout, and `{{ name }}` sitting in
 * a sentence is the one thing that will not be in the real one. It also goes
 * through the ordinary send path, so if the address, the domain or SES is
 * going to refuse it, it is refused here rather than in front of a list.
 */
export async function sendTemplateTestAction(input: {
  mailboxId: string;
  to: string;
  subject: string;
  html: string;
  text?: string | null;
}) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");

  const boxes = await sendableMailboxesFor(access);
  const box = boxes.find((entry) => entry.id === input.mailboxId);
  if (!box) return { ok: false as const, error: "You cannot send from that mailbox" };

  const address = input.to.trim();
  if (!address.includes("@")) return { ok: false as const, error: "That is not an address" };

  const names = templateVariables(input.subject, input.html, input.text);
  const stand = Object.fromEntries(names.map((name) => [name, `[${name}]`]));

  let subject = input.subject;
  let html = input.html;
  let text = input.text ?? null;
  try {
    const filled = renderTemplateParts({ subject: input.subject, html: input.html, text }, stand);
    subject = filled.subject;
    html = filled.html ?? input.html;
    text = filled.text;
  } catch {
    // A variable this cannot fill is not a reason to refuse to show somebody
    // their own template; it goes out with the placeholder still in it.
  }

  try {
    await deliverMessage({
      orgId: access.orgId,
      mailboxId: box.id,
      to: [{ address, name: "" }],
      subject: subject || "(no subject)",
      html,
      text,
      senderUserId: access.userId,
    });
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "It could not be sent",
    };
  }
}

/**
 * A typed From address, turned into something that can send.
 *
 * Somebody running only the campaigns view does not think in mailboxes. They
 * think "this goes out from hello@ourcompany.com", and being told to create a
 * mailbox first is being told to learn an inbox idea to send a newsletter. So
 * the address is typed, and the mailbox behind it is made here if it does not
 * exist.
 *
 * The domain still has to be one of theirs and verified. That is not
 * bureaucracy — SES will refuse the send otherwise, and finding out at that
 * point means finding out after pressing Send.
 */
export async function resolveSendingAddressAction(rawAddress: string) {
  const access = await requireAccess();
  assertCan(access, "mail:send");

  const address = rawAddress.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false as const, error: "That is not an email address" };
  }

  const box = await mailboxForSending(access.orgId, address);
  if (box) return { ok: true as const, id: box.id, address: box.address };

  /*
   * Said with the answer in it. "No such domain" leaves somebody guessing at
   * which ones would have worked, and the list is short enough to print.
   */
  const domains = await listDomainsForUser(access.orgId);
  const usable = domains.filter((row) => row.status === "verified" && row.sendingEnabled);
  const tail = address.split("@")[1] ?? address;

  return {
    ok: false as const,
    error: usable.length
      ? `You cannot send from ${tail} yet. Try ${usable.map((row) => `@${row.name}`).join(", ")}.`
      : `You cannot send from ${tail} yet. Add that domain under Domains and publish its DNS records first.`,
  };
}

/** The mailboxes this person may send a test from. */
export async function sendableMailboxesAction() {
  const access = await requireAccess();
  const boxes = await sendableMailboxesFor(access);
  return boxes.map((box) => ({ id: box.id, address: box.address, name: box.displayName }));
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Takes a file out of the library and leaves the object where it is.
 *
 * Mail that already went out points at that address, and will for as long as
 * anybody keeps the message. Removing the bytes would put a broken image into
 * something that was correct when it was sent.
 */
export async function deleteMediaAction(id: string) {
  const access = await requireAccess();
  assertCan(access, "rules:manage");
  await forgetMedia(access.orgId, id);
  revalidatePath("/settings/media");
  revalidatePath("/campaigns/media");
}

/* -------------------------------------------------------------------------- */
/* Forwarding                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where inbound mail is also sent.
 *
 * Every one of these is owner-only: a forwarding rule takes a copy of other
 * people's mail out of the building, which is the same weight of decision as
 * changing how mail is received at all.
 */

export async function addForwardingAddressAction(address: string) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    const result = await addForwardingAddress(access.orgId, address);
    revalidatePath("/settings/forwarding");
    return { ok: true as const, verified: result.verified };
  } catch (error) {
    return failure(error, "Cloudflare would not take that address");
  }
}

export async function refreshForwardingAction() {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    const result = await refreshForwardingAddresses(access.orgId);
    revalidatePath("/settings/forwarding");
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, "Cloudflare could not be reached");
  }
}

export async function resendForwardingVerificationAction(addressId: string) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    await resendForwardingVerification(access.orgId, addressId);
    revalidatePath("/settings/forwarding");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "Cloudflare would not send it again");
  }
}

export async function removeForwardingAddressAction(addressId: string) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    await removeForwardingAddress(access.orgId, addressId);
    revalidatePath("/settings/forwarding");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That address could not be removed");
  }
}

export async function addForwardingRuleAction(addressId: string, width: Width) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  try {
    await addForwardingRule(access.orgId, addressId, width);
    revalidatePath("/settings/forwarding");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That rule could not be added");
  }
}

export async function removeForwardingRuleAction(ruleId: string) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  await removeForwardingRule(access.orgId, ruleId);
  revalidatePath("/settings/forwarding");
  return { ok: true as const };
}

export async function setForwardOffAction(width: Width, off: boolean) {
  const access = await requireAccess();
  assertCan(access, "inbound:manage");
  await setForwardOff(access.orgId, width, off);
  revalidatePath("/settings/forwarding");
  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/* What this instance is for                                                  */
/* -------------------------------------------------------------------------- */

export async function setWorkspaceFeaturesAction(patch: {
  inboxEnabled?: boolean;
  campaignsEnabled?: boolean;
}) {
  const access = await requireAccess();
  assertCan(access, "instance:manage");
  try {
    await saveWorkspaceSettings(access.orgId, patch);
    // Every settings page builds its navigation from this.
    revalidatePath("/settings", "layout");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That could not be saved");
  }
}

export async function setWorkspaceBrandAction(patch: {
  brandName?: string | null;
  brandLogo?: string | null;
  brandAccent?: string | null;
  postalAddress?: string | null;
  sendRatePerHour?: number | null;
}) {
  const access = await requireAccess();
  assertCan(access, "instance:manage");
  try {
    await saveWorkspaceSettings(access.orgId, patch);
    revalidatePath("/settings", "layout");
    // The footer of every campaign is built from this.
    revalidatePath("/campaigns", "layout");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That could not be saved");
  }
}

export async function finishSetupAction() {
  const access = await requireAccess();
  assertCan(access, "instance:manage");
  try {
    await saveWorkspaceSettings(access.orgId, { setupCompleted: true });
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That could not be saved");
  }
}

/* -------------------------------------------------------------------------- */
/* Lists and broadcasts                                                       */
/* -------------------------------------------------------------------------- */

/*
 * A list is a rules question, not a sending one: who may be written to is the
 * same kind of decision as a filter or a label. Sending one is gated on
 * mail:send, because that is what it is.
 */

export async function createListAction(name: string, description?: string) {
  const access = await requireAccess();
  await assertCanCreateList(access);
  try {
    await createList(access.orgId, name, description);
    revalidatePath("/campaigns/lists");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That list could not be made");
  }
}

export async function removeListAction(listId: string) {
  const access = await requireAccess();
  await assertCanManageList(access, listId);
  try {
    await removeList(access.orgId, listId);
    revalidatePath("/campaigns/lists");
    return { ok: true as const };
  } catch (error) {
    // The caller navigates away on success, so a silent failure would leave
    // somebody looking at a list index that still has the list in it.
    return failure(error, "That list could not be deleted");
  }
}

export async function addListMembersAction(listId: string, text: string, consentSource: string) {
  const access = await requireAccess();
  await assertCanManageList(access, listId);
  try {
    const result = await addMembers(
      access.orgId,
      listId,
      parseMemberList(text),
      consentSource.trim() || "added by hand",
    );
    revalidatePath("/campaigns/lists");
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, "Those could not be added");
  }
}

export async function setListMemberStatusAction(
  memberId: string,
  status: "subscribed" | "unsubscribed",
) {
  const access = await requireAccess();
  const onList = await listOfMember(access.orgId, memberId);
  if (!onList) throw new Error("No such person");
  await assertCanManageList(access, onList);
  await setMemberStatus(access.orgId, memberId, status);
  revalidatePath("/campaigns/lists");
  return { ok: true as const };
}

export async function removeListMemberAction(memberId: string) {
  const access = await requireAccess();
  const onList = await listOfMember(access.orgId, memberId);
  if (!onList) throw new Error("No such person");
  await assertCanManageList(access, onList);
  await removeMember(access.orgId, memberId);
  revalidatePath("/campaigns/lists");
  return { ok: true as const };
}

export async function createBroadcastAction(input: {
  /** Both null while it is only being written. Required to send, not to draft. */
  listId?: string | null;
  mailboxId?: string | null;
  subject: string;
  html?: string;
  text?: string;
  templateId?: string | null;
  segmentId?: string | null;
}) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanSendToList(access, input.listId);
  try {
    const id = await createBroadcast(access.orgId, input);
    revalidatePath("/campaigns/broadcasts");
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "That broadcast could not be made");
  }
}

/** Saves a draft broadcast's subject and body. */
export async function updateBroadcastAction(
  id: string,
  input: {
    subject?: string;
    subjectB?: string | null;
    listId?: string;
    mailboxId?: string;
    segmentId?: string | null;
    design?: unknown;
    html?: string | null;
    text?: string | null;
  },
) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanSendBroadcast(access, id);
  // Aiming a draft somewhere new needs the right to send there as well.
  await assertCanSendToList(access, input.listId);
  try {
    await updateBroadcast(access.orgId, id, {
      subject: input.subject,
      subjectB: input.subjectB,
      listId: input.listId,
      mailboxId: input.mailboxId,
      segmentId: input.segmentId,
      // Checked rather than trusted: the client is where a design comes from.
      design:
        input.design === undefined
          ? undefined
          : input.design === null
            ? null
            : readDesign(input.design),
      html: input.html,
      text: input.text,
    });
    revalidatePath("/campaigns/broadcasts");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That broadcast could not be saved");
  }
}

export async function startBroadcastAction(broadcastId: string, when?: string) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanSendBroadcast(access, broadcastId);
  try {
    const at = when ? new Date(when) : null;
    const result = await startBroadcast(access.orgId, broadcastId, at);
    revalidatePath("/campaigns/broadcasts");
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, "That broadcast could not be started");
  }
}

export async function cancelBroadcastAction(broadcastId: string) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanSendBroadcast(access, broadcastId);
  await cancelBroadcast(access.orgId, broadcastId);
  revalidatePath("/campaigns/broadcasts");
  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/* Lists, segments and the rest of the marketing side                         */
/* -------------------------------------------------------------------------- */

export async function updateListAction(
  listId: string,
  input: {
    name?: string;
    description?: string | null;
    doubleOptIn?: boolean;
    publicSignup?: boolean;
  },
) {
  const access = await requireAccess();
  await assertCanManageList(access, listId);
  try {
    await updateList(access.orgId, listId, input);
    revalidatePath("/campaigns/lists");
    revalidatePath(`/campaigns/lists/${listId}`);
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That list could not be changed");
  }
}

export async function createSegmentAction(input: {
  listId: string;
  name: string;
  matchAll?: boolean;
  rules?: unknown;
}) {
  const access = await requireAccess();
  await assertCanManageList(access, input.listId);
  try {
    const id = await createSegment(access.orgId, input);
    revalidatePath("/campaigns/lists");
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "That segment could not be made");
  }
}

export async function updateSegmentAction(
  id: string,
  input: { name?: string; matchAll?: boolean; rules?: unknown },
) {
  const access = await requireAccess();
  const describes = await listOfSegment(access.orgId, id);
  if (!describes) throw new Error("No such segment");
  await assertCanManageList(access, describes);
  try {
    await updateSegment(access.orgId, id, input);
    revalidatePath("/campaigns/lists");
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That segment could not be changed");
  }
}

/**
 * How many people a segment would match, before it exists.
 *
 * Asked as the rules are typed. A segment is a question, and finding out the
 * answer by saving it and going back to the list is how somebody ends up
 * aiming a campaign at nobody without noticing.
 */
export async function segmentPreviewAction(input: {
  listId: string;
  matchAll: boolean;
  rules: unknown;
}) {
  const access = await requireAccess();
  await assertCanManageList(access, input.listId);
  try {
    const size = await segmentSize(access.orgId, {
      listId: input.listId,
      matchAll: input.matchAll,
      rules: readRules(input.rules),
    });
    return { ok: true as const, size };
  } catch {
    // A half-typed rule is not an error worth showing; the count just waits.
    return { ok: false as const, size: 0 };
  }
}

export async function removeSegmentAction(id: string) {
  const access = await requireAccess();
  const describes = await listOfSegment(access.orgId, id);
  if (!describes) throw new Error("No such segment");
  await assertCanManageList(access, describes);
  await removeSegment(access.orgId, id);
  revalidatePath("/campaigns/lists");
  return { ok: true as const };
}

/** How many people a draft would go to, asked from the builder before sending. */
export async function audienceSizeAction(
  broadcastId: string,
  aim?: { listId?: string; segmentId?: string | null },
) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanSendBroadcast(access, broadcastId);
  return { ok: true as const, size: await audienceSize(access.orgId, broadcastId, aim) };
}

export async function duplicateBroadcastAction(id: string) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanSendBroadcast(access, id);
  try {
    const made = await duplicateBroadcast(access.orgId, id);
    revalidatePath("/campaigns/broadcasts");
    return { ok: true as const, id: made };
  } catch (error) {
    return failure(error, "That campaign could not be copied");
  }
}

export async function resendToNonOpenersAction(id: string) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanSendBroadcast(access, id);
  try {
    const made = await resendToNonOpeners(access.orgId, id);
    revalidatePath("/campaigns/broadcasts");
    return { ok: true as const, ...made };
  } catch (error) {
    return failure(error, "That follow-up could not be made");
  }
}

/* -------------------------------------------------------------------------- */
/* Automations                                                                */
/* -------------------------------------------------------------------------- */

export async function createAutomationAction(input: {
  /** Null while the flow is only being drawn. Required to switch it on. */
  mailboxId?: string | null;
  name: string;
}) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  if (!(await hasCampaignAccess(access))) throw new Error("You cannot create an automation");
  try {
    const id = await createAutomation(access.orgId, input);
    revalidatePath("/campaigns/automations");
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "That automation could not be made");
  }
}

export async function updateAutomationAction(
  id: string,
  input: {
    name?: string;
    mailboxId?: string;
    status?: "draft" | "active" | "paused";
    trigger?: "subscribed" | "event";
    listId?: string | null;
    eventName?: string | null;
    segmentId?: string | null;
    exitSegmentId?: string | null;
    exitEventName?: string | null;
  },
) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanRunAutomation(access, id);
  // Pointing it at another list needs the right to send to that one too.
  await assertCanSendToList(access, input.listId);
  try {
    await updateAutomation(access.orgId, id, input);
    revalidatePath("/campaigns/automations");
    revalidatePath(`/campaigns/automations/${id}`);
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That automation could not be changed");
  }
}

export async function removeAutomationAction(id: string) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanRunAutomation(access, id);
  await removeAutomation(access.orgId, id);
  revalidatePath("/campaigns/automations");
  return { ok: true as const };
}

export async function addNodeAction(
  automationId: string,
  input: { kind: AutomationNodeKind; after?: string | null; branch?: "next" | "nextElse" },
) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanRunAutomation(access, automationId);
  try {
    const id = await addNode(access.orgId, automationId, input);
    revalidatePath(`/campaigns/automations/${automationId}`);
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "That could not be added");
  }
}

export async function updateNodeAction(
  nodeId: string,
  input: {
    subject?: string;
    delayMinutes?: number;
    /** An ISO string from the browser, or null to go back to a delay. */
    waitUntil?: string | null;
    config?: NodeConfig;
    design?: unknown;
    html?: string | null;
    text?: string | null;
    templateId?: string | null;
  },
) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  const owning = await automationOfNode(access.orgId, nodeId);
  if (!owning) throw new Error("No such step");
  await assertCanRunAutomation(access, owning);
  try {
    await updateNode(access.orgId, nodeId, {
      subject: input.subject,
      delayMinutes: input.delayMinutes,
      waitUntil:
        input.waitUntil === undefined
          ? undefined
          : input.waitUntil
            ? new Date(input.waitUntil)
            : null,
      config: input.config,
      templateId: input.templateId,
      // Checked rather than trusted: the client is where a design comes from.
      design:
        input.design === undefined
          ? undefined
          : input.design === null
            ? null
            : readDesign(input.design),
      html: input.html,
      text: input.text,
    });
    return { ok: true as const };
  } catch (error) {
    return failure(error, "That could not be saved");
  }
}

export async function removeNodeAction(automationId: string, nodeId: string) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await assertCanRunAutomation(access, automationId);
  await removeNode(access.orgId, nodeId);
  revalidatePath(`/campaigns/automations/${automationId}`);
  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export async function createEventAction(input: { name: string; description?: string }) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  try {
    const id = await createEvent(access.orgId, input);
    revalidatePath("/campaigns/events");
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "That event could not be made");
  }
}

export async function updateEventAction(id: string, input: { description?: string | null }) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await updateEvent(access.orgId, id, input);
  revalidatePath("/campaigns/events");
  return { ok: true as const };
}

export async function removeEventAction(id: string) {
  const access = await requireAccess();
  assertCan(access, "mail:send");
  await removeEvent(access.orgId, id);
  revalidatePath("/campaigns/events");
  return { ok: true as const };
}
