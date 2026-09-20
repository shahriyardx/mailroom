import { ApiKeyPanel } from "@/components/mail/api-key-panel";
import { DomainPanel, type DomainRow } from "@/components/mail/domain-panel";
import { LabelPanel, MailboxPanel, RulePanel } from "@/components/mail/settings-panels";
import { SuppressionPanel } from "@/components/mail/suppression-panel";
import { db } from "@/db";
import { apiKey, filterRule, label, suppression } from "@/db/schema";
import { env } from "@/lib/env";
import { getAccountStatus } from "@/lib/ses";
import { requireUser } from "@/lib/session";
import { ensureDomainsSynced, recordsForDomain } from "@/server/domains";
import { listMailboxes } from "@/server/mailboxes";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();

  // Domains auto-import on first visit, and refresh when the cached status is stale.
  const sync = await ensureDomainsSynced(user.id);

  const [mailboxes, labels, rules, keys, blocked, account] = await Promise.all([
    listMailboxes(user.id),
    db.query.label.findMany({ where: eq(label.userId, user.id) }),
    db.query.filterRule.findMany({ where: eq(filterRule.userId, user.id) }),
    db.query.apiKey.findMany({
      where: eq(apiKey.userId, user.id),
      orderBy: (k, { desc: sortDesc }) => [sortDesc(k.createdAt)],
    }),
    db
      .select()
      .from(suppression)
      .where(eq(suppression.userId, user.id))
      .orderBy(desc(suppression.createdAt))
      .limit(100),
    getAccountStatus(),
  ]);

  const domains: DomainRow[] = sync.rows.map((row) => ({
    ...row,
    records: recordsForDomain(row),
  }));

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl space-y-3 p-5">
        <div className="flex items-center gap-2.5 pb-1">
          <Link
            href="/mail/all/inbox"
            aria-label="Back to mail"
            className="rounded-[3px] border p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-medium text-[14px]">Settings</h1>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <DomainPanel
          domains={domains}
          account={account}
          syncError={sync.ok ? undefined : sync.error}
        />
        <MailboxPanel mailboxes={mailboxes} domains={sync.rows} />
        <ApiKeyPanel keys={keys} mailboxes={mailboxes} appUrl={env.appUrl} />
        <SuppressionPanel rows={blocked} />
        <LabelPanel labels={labels} />
        <RulePanel rules={rules} />
      </div>
    </div>
  );
}
