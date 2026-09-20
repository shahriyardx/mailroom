import { MailShell } from "@/components/mail/mail-shell";
import { ThreadList } from "@/components/mail/thread-list";
import { ThreadView } from "@/components/mail/thread-view";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { label } from "@/db/schema";
import { FOLDER_LABELS, parseRoute, scopeHref } from "@/lib/scope";
import { requireUser } from "@/lib/session";
import { listMailboxes } from "@/server/mailboxes";
import { getThreadDetail, listThreads } from "@/server/threads";
import { eq } from "drizzle-orm";
import { Inbox } from "lucide-react";
import Link from "next/link";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{
    t?: string;
    q?: string;
    cursor?: string;
    label?: string;
    unread?: string;
  }>;
}

export default async function MailPage({ params, searchParams }: PageProps) {
  const user = await requireUser();
  const { slug } = await params;
  const query = await searchParams;
  const { scope, folder } = parseRoute(slug);

  const [mailboxes, labels] = await Promise.all([
    listMailboxes(user.id),
    db.query.label.findMany({ where: eq(label.userId, user.id) }),
  ]);

  if (mailboxes.length === 0) return <NoMailboxes />;

  const scopeLabel =
    scope.kind === "all"
      ? "All mail"
      : scope.kind === "domain"
        ? scope.domain
        : (mailboxes.find((box) => box.id === scope.mailboxId)?.address ?? "Mailbox");

  const [{ items, nextCursor }, detail] = await Promise.all([
    listThreads({
      userId: user.id,
      scope,
      folder,
      query: query.q,
      labelId: query.label,
      cursor: query.cursor,
      unreadOnly: query.unread === "1",
    }),
    query.t ? getThreadDetail(user.id, query.t) : Promise.resolve(null),
  ]);

  const base = scopeHref(scope, folder);
  const listParams = new URLSearchParams();
  if (query.q) listParams.set("q", query.q);
  if (query.label) listParams.set("label", query.label);
  if (query.unread === "1") listParams.set("unread", "1");
  const suffix = listParams.toString();
  const backHref = suffix ? `${base}?${suffix}` : base;

  return (
    <MailShell
      mailboxes={mailboxes}
      labels={labels}
      scope={scope}
      folder={folder}
      scopeLabel={scopeLabel}
      threadCount={items.length}
      user={{ name: user.name, email: user.email }}
      openSubject={detail?.subject || undefined}
      threadOpen={Boolean(detail)}
      list={
        <ThreadList
          items={items}
          folder={folder}
          activeThreadId={detail?.id}
          baseHref={base}
          listQuery={suffix}
          nextCursor={nextCursor}
          showMailbox={scope.kind !== "mailbox"}
        />
      }
    >
      {detail ? (
        <ThreadView thread={detail} backHref={backHref} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-background">
          <Inbox className="size-7 text-muted-foreground/50" />
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            {FOLDER_LABELS[folder]}
          </p>
          <p className="text-[12px] text-muted-foreground/70">
            Select a conversation, or press <span className="kbd">c</span> to write one.
          </p>
        </div>
      )}
    </MailShell>
  );
}

function NoMailboxes() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-10 text-center">
      <Inbox className="size-8 text-muted-foreground/50" />
      <div>
        <h1 className="text-[15px] font-semibold">No mailboxes yet</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] text-muted-foreground">
          Add an address for each verified SES domain. There is no limit, and they all route through
          one Cloudflare worker.
        </p>
      </div>
      <Button size="sm" nativeButton={false} render={<Link href="/settings" />}>
        Add a mailbox
      </Button>
    </div>
  );
}
