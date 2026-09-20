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
import { domainOf, makeSnippet, parseAddressList } from "@/lib/mail";
import { requireUser } from "@/lib/session";
import { newId } from "@/lib/utils";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recomputeThread } from "./aggregate";
import {
  addDomain,
  importFromSes,
  publishToCloudflare,
  refreshDomain,
  removeDomain,
} from "./domains";
import { resolveScope } from "./mailboxes";
import { deliverMessage } from "./send";

async function assertOwnsThreads(userId: string, threadIds: string[]) {
  if (threadIds.length === 0) return [];
  const mailboxIds = await resolveScope(userId, { kind: "all" });
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
  const user = await requireUser();
  const input = composeSchema.parse(raw);

  const result = await deliverMessage({
    userId: user.id,
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
  const user = await requireUser();
  const input = draftSchema.parse(raw);

  const box = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.userId, user.id)),
  });
  if (!box) throw new Error("Unknown mailbox");

  let threadId = input.threadId;
  if (threadId) {
    const owned = await assertOwnsThreads(user.id, [threadId]);
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
  const user = await requireUser();
  const mailboxIds = await resolveScope(user.id, { kind: "all" });
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
  const user = await requireUser();
  const owned = await assertOwnsThreads(user.id, threadIds);
  if (owned.length === 0) return;

  await db
    .update(message)
    .set({ folder })
    .where(and(inArray(message.threadId, owned), eq(message.isDraft, false)));

  for (const id of owned) await recomputeThread(id);
  revalidatePath("/mail", "layout");
}

export async function setReadAction(threadIds: string[], isRead: boolean) {
  const user = await requireUser();
  const owned = await assertOwnsThreads(user.id, threadIds);
  if (owned.length === 0) return;
  await db.update(message).set({ isRead }).where(inArray(message.threadId, owned));
  for (const id of owned) await recomputeThread(id);
  revalidatePath("/mail", "layout");
}

export async function setStarAction(threadIds: string[], isStarred: boolean) {
  const user = await requireUser();
  const owned = await assertOwnsThreads(user.id, threadIds);
  if (owned.length === 0) return;
  await db.update(message).set({ isStarred }).where(inArray(message.threadId, owned));
  await db.update(thread).set({ isStarred }).where(inArray(thread.id, owned));
  revalidatePath("/mail", "layout");
}

/** Trash first, permanent delete only from trash. */
export async function deleteThreadsAction(threadIds: string[]) {
  const user = await requireUser();
  const owned = await assertOwnsThreads(user.id, threadIds);
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

export async function toggleThreadLabelAction(threadId: string, labelId: string, on: boolean) {
  const user = await requireUser();
  const owned = await assertOwnsThreads(user.id, [threadId]);
  if (owned.length === 0) return;

  const owns = await db.query.label.findFirst({
    where: and(eq(label.id, labelId), eq(label.userId, user.id)),
  });
  if (!owns) return;

  if (on) {
    await db.insert(threadLabel).values({ threadId, labelId }).onConflictDoNothing();
  } else {
    await db
      .delete(threadLabel)
      .where(and(eq(threadLabel.threadId, threadId), eq(threadLabel.labelId, labelId)));
  }
  revalidatePath("/mail", "layout");
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

export async function createMailboxAction(raw: z.input<typeof mailboxSchema>) {
  const user = await requireUser();
  const input = mailboxSchema.parse(raw);
  const address = input.address.toLowerCase();

  const domainName = domainOf(address);
  const domainRow = await db.query.domain.findFirst({
    where: and(eq(domainTable.userId, user.id), eq(domainTable.name, domainName)),
  });

  const id = newId("mbx");
  await db.insert(mailbox).values({
    id,
    userId: user.id,
    address,
    domain: domainName,
    domainId: domainRow?.id ?? null,
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
      .where(and(eq(mailbox.userId, user.id), sql`${mailbox.id} <> ${id}`));
  }

  revalidatePath("/mail", "layout");
  revalidatePath("/settings");
  return { id };
}

export async function updateMailboxAction(
  mailboxId: string,
  patch: Partial<z.input<typeof mailboxSchema>>,
) {
  const user = await requireUser();
  const owns = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, mailboxId), eq(mailbox.userId, user.id)),
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
      .where(and(eq(mailbox.userId, user.id), sql`${mailbox.id} <> ${mailboxId}`));
  }

  revalidatePath("/mail", "layout");
  revalidatePath("/settings");
}

export async function deleteMailboxAction(mailboxId: string) {
  const user = await requireUser();
  await db.delete(mailbox).where(and(eq(mailbox.id, mailboxId), eq(mailbox.userId, user.id)));
  revalidatePath("/mail", "layout");
  revalidatePath("/settings");
}

export async function createLabelAction(name: string, color: string) {
  const user = await requireUser();
  const id = newId("lbl");
  await db.insert(label).values({ id, userId: user.id, name, color }).onConflictDoNothing();
  revalidatePath("/mail", "layout");
  return { id };
}

export async function deleteLabelAction(labelId: string) {
  const user = await requireUser();
  await db.delete(label).where(and(eq(label.id, labelId), eq(label.userId, user.id)));
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
  const user = await requireUser();
  const input = ruleSchema.parse(raw);
  const id = newId("rul");
  await db.insert(filterRule).values({
    id,
    userId: user.id,
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
  const user = await requireUser();
  await db.delete(filterRule).where(and(eq(filterRule.id, ruleId), eq(filterRule.userId, user.id)));
  revalidatePath("/settings");
}

/* -------------------------------------------------------------------------- */
/* Domains (Amazon SES)                                                       */
/* -------------------------------------------------------------------------- */

export async function importDomainsAction() {
  const user = await requireUser();
  try {
    const result = await importFromSes(user.id);
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

export async function addDomainAction(name: string) {
  const user = await requireUser();
  try {
    const result = await addDomain(user.id, name);
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
  const user = await requireUser();
  try {
    const result = await refreshDomain(user.id, domainId);
    revalidatePath("/settings");
    return { ok: true as const, status: result.status };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not refresh the domain",
    };
  }
}

/** Writes every DNS record this domain needs straight into Cloudflare. */
export async function publishDnsAction(domainId: string) {
  const user = await requireUser();
  try {
    const result = await publishToCloudflare(user.id, domainId);
    // Records are live immediately inside Cloudflare, so re-check right away.
    await refreshDomain(user.id, domainId).catch(() => {});
    revalidatePath("/settings");
    return { ok: true as const, zone: result.zone, results: result.results };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not reach Cloudflare",
    };
  }
}

export async function removeDomainAction(domainId: string, alsoDeleteInSes: boolean) {
  const user = await requireUser();
  await removeDomain(user.id, domainId, alsoDeleteInSes);
  revalidatePath("/settings");
  revalidatePath("/mail", "layout");
}

/* -------------------------------------------------------------------------- */
/* API keys                                                                   */
/* -------------------------------------------------------------------------- */

export async function createApiKeyAction(name: string, mailboxId?: string) {
  const user = await requireUser();

  if (mailboxId) {
    const owns = await db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, mailboxId), eq(mailbox.userId, user.id)),
    });
    if (!owns) throw new Error("Unknown mailbox");
  }

  const generated = generateApiKey();
  const id = newId("key");

  await db.insert(apiKey).values({
    id,
    userId: user.id,
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
  const user = await requireUser();
  await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKey.id, keyId), eq(apiKey.userId, user.id)));
  revalidatePath("/settings");
}

export async function deleteApiKeyAction(keyId: string) {
  const user = await requireUser();
  await db.delete(apiKey).where(and(eq(apiKey.id, keyId), eq(apiKey.userId, user.id)));
  revalidatePath("/settings");
}

/* -------------------------------------------------------------------------- */
/* Suppressions                                                               */
/* -------------------------------------------------------------------------- */

export async function removeSuppressionAction(suppressionId: string) {
  const user = await requireUser();
  await db
    .delete(suppression)
    .where(and(eq(suppression.id, suppressionId), eq(suppression.userId, user.id)));
  revalidatePath("/settings");
}
