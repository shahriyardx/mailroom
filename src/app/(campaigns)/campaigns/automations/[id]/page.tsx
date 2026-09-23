import { AutomationDetail } from "@/components/mail/automation-detail";
import { db } from "@/db";
import { mailingList } from "@/db/schema";
import { automationsView, findAutomation } from "@/server/automations";
import { sendableMailboxes } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("mail:send");
  const { id } = await params;

  const row = await findAutomation(access.orgId, id);
  if (!row) notFound();

  const [list, mailboxes, all] = await Promise.all([
    db.query.mailingList.findFirst({
      where: eq(mailingList.id, row.listId),
      columns: { name: true },
    }),
    sendableMailboxes(access.orgId),
    automationsView(access.orgId),
  ]);

  return (
    <AutomationDetail
      automation={row}
      steps={row.steps}
      listName={list?.name ?? "a list"}
      mailboxes={mailboxes}
      running={all.find((entry) => entry.id === id)?.running ?? 0}
    />
  );
}
