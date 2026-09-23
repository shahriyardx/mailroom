import { AutomationDetail } from "@/components/mail/automation-detail";
import { db } from "@/db";
import { mailingList } from "@/db/schema";
import { automationsView, findAutomation } from "@/server/automations";
import { sendableMailboxes } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { listTemplates } from "@/server/templates";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("mail:send");
  const { id } = await params;

  const row = await findAutomation(access.orgId, id);
  if (!row) notFound();

  const [list, mailboxes, all, templates] = await Promise.all([
    db.query.mailingList.findFirst({
      where: eq(mailingList.id, row.listId),
      columns: { name: true },
    }),
    sendableMailboxes(access.orgId),
    automationsView(access.orgId),
    listTemplates(access.orgId),
  ]);

  return (
    <AutomationDetail
      automation={row}
      nodes={row.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        subject: node.subject,
        delayMinutes: node.delayMinutes,
        config: node.config,
        next: node.next,
        nextElse: node.nextElse,
        // An email with nothing in it would go out blank, which is worse than
        // not going out — so the canvas flags it before it can.
        empty: node.kind === "email" && !node.html && !node.design,
      }))}
      listName={list?.name ?? "a list"}
      mailboxes={mailboxes}
      templates={templates.map((entry) => ({ id: entry.id, name: entry.name }))}
      running={all.find((entry) => entry.id === id)?.running ?? 0}
    />
  );
}
