import { Button } from "@/components/kit";
import { MailShell } from "@/components/mail/mail-shell";
import { ThreadList } from "@/components/mail/thread-list";
import { ThreadView } from "@/components/mail/thread-view";
import { db } from "@/db";
import { label } from "@/db/schema";
import { FOLDER_LABELS, parseRoute, scopeHref, supportsUnreadFilter } from "@/lib/scope";
import { requireAccess } from "@/server/access";
import { creatableDomainIds, readableMailboxIds } from "@/server/grants";
import { imageChoices as imageChoicesFor } from "@/server/image-trust";
import { listMailboxesFor } from "@/server/mailboxes";
import { can } from "@/server/permissions";
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
    dir?: string;
    label?: string;
    unread?: string;
  }>;
}

export default async function MailPage({ params, searchParams }: PageProps) {
  const access = await requireAccess();
  const { slug } = await params;
  const query = await searchParams;
  const { scope, folder } = parseRoute(slug);

  const allowed = await readableMailboxIds(access);
  const [mailboxes, labels] = await Promise.all([
    listMailboxesFor(access),
    db.query.label.findMany({ where: eq(label.organizationId, access.orgId) }),
  ]);

  // Whether this person may add an address is a different question from
  // whether they can read one: a grant over a domain lets somebody create
  // mailboxes before any exists. Only asked when it matters, which is when
  // there is nothing to show.
  const creatable = mailboxes.length === 0 ? await creatableDomainIds(access) : [];
  const mayAddMailbox =
    mailboxes.length === 0 &&
    (can(access, "mailbox:manage") || creatable === "all" || creatable.length > 0);

  const [{ items, total, offset, nextCursor, prevCursor }, detail] = await Promise.all([
    listThreads({
      orgId: access.orgId,
      scope,
      folder,
      query: query.q,
      labelId: query.label,
      cursor: query.cursor,
      direction: query.dir === "newer" ? "newer" : "older",
      unreadOnly: query.unread === "1" && supportsUnreadFilter(folder),
      allowed,
    }),
    query.t ? getThreadDetail(access.orgId, query.t, allowed) : Promise.resolve(null),
  ]);

  /**
   * What this reader has already said about the senders in this conversation.
   * Asked for once here rather than per message, so opening a long thread is
   * still one query.
   */
  const imageChoices = detail
    ? Object.fromEntries(
        await imageChoicesFor(
          access,
          detail.messages.map((item) => item.fromAddress),
        ),
      )
    : {};

  const base = scopeHref(scope, folder);
  const listParams = new URLSearchParams();
  if (query.q) listParams.set("q", query.q);
  if (query.label) listParams.set("label", query.label);
  if (query.unread === "1" && supportsUnreadFilter(folder)) listParams.set("unread", "1");
  const suffix = listParams.toString();
  const backHref = suffix ? `${base}?${suffix}` : base;

  return (
    <MailShell
      mailboxes={mailboxes}
      labels={labels}
      scope={scope}
      folder={folder}
      user={{ name: access.name, email: access.email }}
      canAddMailbox={mayAddMailbox}
      openSubject={detail?.subject || undefined}
      threadOpen={Boolean(detail)}
      list={
        <ThreadList
          items={items}
          folder={folder}
          activeThreadId={detail?.id}
          baseHref={base}
          listQuery={suffix}
          total={total}
          offset={offset}
          nextCursor={nextCursor}
          prevCursor={prevCursor}
          showMailbox={scope.kind !== "mailbox"}
          labels={labels}
        />
      }
    >
      {detail ? (
        <ThreadView
          thread={detail}
          backHref={backHref}
          labels={labels}
          imageChoices={imageChoices}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-card px-6 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <Inbox className="size-5" />
          </span>
          {mailboxes.length === 0 ? (
            <>
              <div className="space-y-1">
                <p className="font-display text-[15px] font-semibold">
                  {mayAddMailbox ? "No addresses yet" : "Nothing shared with you yet"}
                </p>
                <p className="mx-auto max-w-xs text-[13px] text-muted-foreground">
                  {mayAddMailbox
                    ? "Add the first address on your domain, and the mail sent to it arrives here."
                    : "Ask an administrator for a mailbox, and it will appear here."}
                </p>
              </div>
              {mayAddMailbox && (
                <Button variant="solid" size="sm" pill asChild>
                  <Link href="/settings/mailboxes">Add a mailbox</Link>
                </Button>
              )}
            </>
          ) : (
            <div className="space-y-1">
              <p className="font-display text-[15px] font-semibold">{FOLDER_LABELS[folder]}</p>
              <p className="text-[13px] text-muted-foreground">
                Select a conversation, or press <span className="kbd">c</span> to write one.
              </p>
            </div>
          )}
        </div>
      )}
    </MailShell>
  );
}
