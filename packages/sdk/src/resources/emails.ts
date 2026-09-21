import type { HttpClient, RequestOptions } from "../http.js";
import { paginate } from "../http.js";
import type {
  BatchSendResult,
  DeliveryStatus,
  Message,
  Page,
  SendEmailInput,
  SentEmail,
} from "../types.js";

export interface ListEmailsParams {
  /** Up to 100. Default 25. */
  limit?: number;
  cursor?: string;
  /** One status, or several. */
  status?: DeliveryStatus | DeliveryStatus[];
  /** Exact sender address. */
  from?: string;
  /** Exact recipient address, matched against To. */
  to?: string;
  /** Substring of the subject. */
  subject?: string;
  /** Full-text search over subject and body. */
  q?: string;
  since?: Date | string;
  until?: Date | string;
  /** Only mail whose tracking image was loaded, or only mail whose was not. */
  opened?: boolean;
  /** Only mail sent by one key. */
  api_key_id?: string;
  /** Narrow to one mailbox, by id or by address, or to a whole domain. */
  mailbox_id?: string;
  mailbox?: string;
  domain?: string;
}

/** Sending, and looking at what was sent. */
export class Emails {
  constructor(private readonly http: HttpClient) {}

  /**
   * Sends one message.
   *
   * ```ts
   * await mail.emails.send({
   *   from: "receipts@example.com",
   *   to: "customer@example.net",
   *   subject: "Your receipt",
   *   html: "<p>Thanks.</p>",
   * });
   * ```
   *
   * Pass `idempotencyKey` and a retry after a timeout cannot send twice.
   */
  send(email: SendEmailInput, options?: RequestOptions): Promise<SentEmail> {
    return this.http.request<SentEmail>({
      method: "POST",
      path: "/emails",
      body: email,
      options,
    });
  }

  /**
   * Sends up to 100 messages in one call.
   *
   * Every one is attempted, and `data` says what happened to each in the order
   * given, so one bad address does not throw the rest away.
   */
  sendBatch(emails: SendEmailInput[], options?: RequestOptions): Promise<BatchSendResult> {
    return this.http.request<BatchSendResult>({
      method: "POST",
      path: "/emails/batch",
      body: emails,
      options,
    });
  }

  /** One page of sent mail, newest first. */
  list(params: ListEmailsParams = {}, options?: RequestOptions): Promise<Page<Message>> {
    return this.http.request<Page<Message>>({
      method: "GET",
      path: "/emails",
      query: { ...params },
      options,
    });
  }

  /** Every sent message matching the filters, paging as it goes. */
  listAll(
    params: ListEmailsParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<Message, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  /**
   * One send, with its body, its files and every SES event so far.
   *
   * The id from {@link send} works, and so does the SES message id a bounce
   * report or a webhook hands you.
   */
  get(id: string, options?: RequestOptions): Promise<Message> {
    return this.http.request<Message>({
      method: "GET",
      path: `/emails/${encodeURIComponent(id)}`,
      options,
    });
  }
}
