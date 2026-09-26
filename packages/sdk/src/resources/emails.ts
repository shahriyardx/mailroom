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
  /**
   * Which side of the line to list. The default follows the key — a live key
   * sees real mail, a test key sees its own test sends — and either can ask
   * for the other side, or for `"all"`.
   */
  test?: boolean | "all";
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
   * A saved template sends by id instead of a body written here:
   *
   * ```ts
   * await mail.emails.send({
   *   from: "receipts@example.com",
   *   to: "customer@example.net",
   *   template: "tpl_…",
   *   data: { name: "Ada", amount: "£10" },
   * });
   * ```
   *
   * `scheduled_at` holds it until a time you choose, and {@link cancel} calls
   * it off while it waits.
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

  /**
   * Calls off a message that has not gone out — one waiting for its
   * scheduled time, or one waiting for SES to be able to take it.
   *
   * Throws {@link ConflictError} once a worker has picked the message up,
   * because at that point it is on its way and there is nothing left to stop.
   */
  cancel(id: string, options?: RequestOptions): Promise<Message> {
    return this.http.request<Message>({
      method: "POST",
      path: `/emails/${encodeURIComponent(id)}/cancel`,
      options,
    });
  }

  /**
   * Moves a waiting message to a different time.
   *
   * Takes the same forms as `scheduled_at` on {@link send}: a Date, an ISO
   * timestamp, a Unix time, or `"in 30 minutes"`.
   */
  reschedule(
    id: string,
    scheduledAt: string | number | Date,
    options?: RequestOptions,
  ): Promise<Message> {
    return this.http.request<Message>({
      method: "PATCH",
      path: `/emails/${encodeURIComponent(id)}`,
      body: { scheduled_at: scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt },
      options,
    });
  }
}
