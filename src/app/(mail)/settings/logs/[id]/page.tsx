import { LogDetail } from "@/components/mail/log-detail";
import { logEntry } from "@/server/logs";
import { requireCapability } from "@/server/permissions";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LogEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("mail:read");
  const { id } = await params;
  const entry = await logEntry(access, id);
  if (!entry) notFound();

  const row = entry.message;

  return (
    <LogDetail
      id={row.id}
      subject={row.subject}
      fromName={row.fromName}
      fromAddress={row.fromAddress}
      to={row.to}
      cc={row.cc}
      replyTo={row.replyTo}
      html={row.htmlBody}
      text={row.textBody}
      deliveryStatus={row.deliveryStatus}
      deliveryError={row.deliveryError}
      sesMessageId={row.sesMessageId}
      rfcMessageId={row.rfcMessageId}
      isOutbound={row.isOutbound}
      isTest={row.isTest}
      scheduledAt={row.scheduledAt}
      openedAt={row.openedAt}
      openCount={row.openCount}
      sizeBytes={row.sizeBytes}
      at={row.sentAt ?? row.receivedAt}
      mailbox={entry.mailboxAddress}
      apiKey={entry.apiKey}
      attachments={entry.attachments.map((file) => ({
        id: file.id,
        filename: file.filename,
        sizeBytes: file.sizeBytes,
      }))}
      events={entry.events.map((event) => ({
        id: event.id,
        type: event.type,
        detail: event.detail,
        recipient: event.recipient,
        occurredAt: event.occurredAt,
      }))}
      hasRaw={Boolean(row.rawKey)}
    />
  );
}
