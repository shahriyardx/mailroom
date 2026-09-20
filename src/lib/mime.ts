import MailComposer from "nodemailer/lib/mail-composer";
import type { EmailAddress } from "./mail";
import { formatAddress } from "./mail";

export interface MimeAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  /** Set to embed the file as an inline cid: image. */
  cid?: string;
}

export interface BuildMimeInput {
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  headers?: Record<string, string>;
  attachments?: MimeAttachment[];
}

/**
 * SES only preserves custom headers such as Message-ID, In-Reply-To and
 * References when the message is submitted as raw MIME, so every outbound mail
 * is composed here first.
 */
export async function buildMime(input: BuildMimeInput): Promise<Uint8Array> {
  const composer = new MailComposer({
    from: formatAddress(input.from),
    to: input.to.map(formatAddress),
    cc: input.cc?.length ? input.cc.map(formatAddress) : undefined,
    bcc: input.bcc?.length ? input.bcc.map(formatAddress) : undefined,
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.text ?? undefined,
    html: input.html ?? undefined,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo ?? undefined,
    references: input.references?.length ? input.references : undefined,
    headers: input.headers,
    attachments: input.attachments?.map((file) => ({
      filename: file.filename,
      content: file.content,
      contentType: file.contentType,
      cid: file.cid,
      contentDisposition: file.cid ? ("inline" as const) : ("attachment" as const),
    })),
    textEncoding: "base64",
  });

  const buffer = await composer.compile().build();
  return new Uint8Array(buffer);
}
