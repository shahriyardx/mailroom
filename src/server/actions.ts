"use server";

import { db } from "@/db";
import {
  type Folder,
  apiKey,
  domain as domainTable,
  filterRule,
  label,
  mailbox,
  message,
  suppression,
  thread,
  threadLabel,
} from "@/db/schema";
import { generateApiKey } from "@/lib/api-key";
import { coveringDomain, domainOf, makeSnippet, parseAddressList } from "@/lib/mail";
import { newId } from "@/lib/utils";
import { requireAccess } from "@/server/access";
import { type Capability, assertCan } from "@/server/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recomputeThread } from "./aggregate";
import { addDomain, importFromSes, refreshDomain, removeDomain, useOwnDkimKey } from "./domains";
import { setUpEvents } from "./events";
import { type SubdomainReceiving, ensureSubdomainReceiving } from "./inbound";
import { deployWorker, removeWorker, routeZoneToWorker, unrouteZone } from "./inbound";
import { connectCloudflare, disconnectCloudflare } from "./integrations";
import { resolveScope } from "./mailboxes";
import { deliverMessage } from "./send";

async function assertOwnsThreads(orgId: string, threadIds: string[]) {
  if (threadIds.length === 0) return [];
  const mailboxIds = await resolveScope(orgId, { kind: "all" });
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
});

export type ComposeInput = z.input<typeof composeSchema>;

export async function sendMessageAction(raw: ComposeInput) {
  const access = await requireAccess();
  const input = composeSchema.parse(raw);

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
    threadId: input.threadId,
    inReplyTo: input.inReplyTo,
    references: input.references,
    draftId: input.draftId,
  });

  revalidatePath("/mail", "layout");
  return { threadId: result.threadId, messageId: result.messageId };
}

const draftSchema = composeSchema.partial({ to: true }).extend({ draftId: z.string().optional() });

export async function saveDraftAction(raw: z.input<typeof draftSchema>) {
  const access = await requireAccess();
  const input = draftSchema.parse(raw);

  const box = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, access.orgId)),
  });
  if (!box) throw new Error("Unknown mailbox");

  let threadId = input.threadId;
  if (threadId) {
    const owned = await assertOwnsThreads(access.orgId, [threadId]);
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
  const mailboxIds = await resolveScope(access.orgId, { kind: "all" });
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
  const owned = await assertOwnsThreads(access.orgId, threadIds);
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
  const owned = await assertOwnsThreads(access.orgId, threadIds);
  if (owned.length === 0) return;
  await db.update(message).set({ isRead }).where(inArray(message.threadId, owned));
  for (const id of owned) await recomputeThread(id);
  revalidatePath("/mail", "layout");
}

export async function setStarAction(threadIds: string[], isStarred: boolean) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds);
  if (owned.length === 0) return;
  await db.update(message).set({ isStarred }).where(inArray(message.threadId, owned));
  await db.update(thread).set({ isStarred }).where(inArray(thread.id, owned));
  revalidatePath("/mail", "layout");
}

/** Trash first, permanent delete only from trash. */
export async function deleteThreadsAction(threadIds: string[]) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds);
  if (owned.length === 0) return;

  const rows = await db.select().from(thread).where(inArray(thread.id, owned));
  const purge = rows.filter((row) => row.folders.length === 1 && row.folders[0] === "trash");
  const trash = rows.filter((row) => !purge.includes(row));

  if (purge.length > 0) {
    await db.delete(thread).where(
      inArray(
        thread.id,
        purge.map((row) => row.id),
      ),
    );
  }
  if (trash.length > 0) {
    const ids = trash.map((row) => row.id);
    await db.update(message).set({ folder: "trash" }).where(inArray(message.threadId, ids));
    for (const id of ids) await recomputeThread(id);
  }
  revalidatePath("/mail", "layout");
}

export async function setThreadsLabelAction(threadIds: string[], labelId: string, on: boolean) {
  const access = await requireAccess();
  const owned = await assertOwnsThreads(access.orgId, threadIds);
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
  assertCan(access, "mailbox:manage");
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
  assertCan(access, "mailbox:manage");
  const owns = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, mailboxId), eq(mailbox.organizationId, access.orgId)),
  });
  if (!owns) return;

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
  const id = newId("lbl");
  await db
    .insert(label)
    .values({ id, organizationId: access.orgId, name, color })
    .onConflictDoNothing();
  revalidatePath("/mail", "layout");
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

export async function createApiKeyAction(name: string, mailboxId?: string) {
  const access = await requireAccess();
  assertCan(access, "apikey:manage");

  if (mailboxId) {
    const owns = await db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, mailboxId), eq(mailbox.organizationId, access.orgId)),
    });
    if (!owns) throw new Error("Unknown mailbox");
  }

  const generated = generateApiKey();
  const id = newId("key");

  await db.insert(apiKey).values({
    id,
    organizationId: access.orgId,
    name: name.trim() || "API key",
    prefix: generated.prefix,
    hash: generated.hash,
    mailboxId: mailboxId || null,
  });

  revalidatePath("/settings");
  // The raw token is returned once here and never stored.
  return { id, token: generated.token };
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
