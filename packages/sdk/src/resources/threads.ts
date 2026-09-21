import type { HttpClient, RequestOptions } from "../http.js";
import { paginate } from "../http.js";
import type { AttachmentInput, Deleted, Folder, Page, SentEmail, Thread } from "../types.js";

export interface ListThreadsParams {
  limit?: number;
  cursor?: string;
  /** A folder name, or `"all"`. */
  folder?: Folder | "all";
  label_id?: string;
  /** A label by name, when you do not have its id. */
  label?: string;
  q?: string;
  unread?: boolean;
  starred?: boolean;
  has_attachments?: boolean;
  /** Anybody on the conversation, by address. */
  participant?: string;
  subject?: string;
  since?: Date | string;
  until?: Date | string;
  mailbox_id?: string;
  mailbox?: string;
  domain?: string;
}

export interface UpdateThreadInput {
  /** Moves every message in the thread. Drafts stay where they are. */
  folder?: Folder;
  is_read?: boolean;
  is_starred?: boolean;
  /** Label ids or names. An unknown one changes nothing and returns 422. */
  add_labels?: string[];
  remove_labels?: string[];
}

export interface ReplyInput {
  text?: string;
  html?: string;
  /** Answer everyone on the last message, not only its sender. */
  reply_all?: boolean;
  /** Override the recipients worked out from the thread. */
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  /** Append the message being answered. On by default. */
  quote?: boolean;
  headers?: Record<string, string>;
  attachments?: AttachmentInput[];
}

/** Conversations: reading them, filing them, answering them. */
export class Threads {
  constructor(private readonly http: HttpClient) {}

  /** One page of conversations, most recent activity first. */
  list(params: ListThreadsParams = {}, options?: RequestOptions): Promise<Page<Thread>> {
    return this.http.request<Page<Thread>>({
      method: "GET",
      path: "/threads",
      query: { ...params },
      options,
    });
  }

  /** Every matching conversation, paging as it goes. */
  listAll(
    params: ListThreadsParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<Thread, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  /**
   * One conversation and every message in it, bodies and files included.
   *
   * Pass `{ includeBody: false }` for a lighter reply when only the shape of
   * the thread matters.
   */
  get(
    id: string,
    params: { includeBody?: boolean } = {},
    options?: RequestOptions,
  ): Promise<Thread> {
    return this.http.request<Thread>({
      method: "GET",
      path: `/threads/${encodeURIComponent(id)}`,
      query: { include_body: params.includeBody },
      options,
    });
  }

  /** Move, read, star and label in one call. Only what you send is changed. */
  update(id: string, input: UpdateThreadInput, options?: RequestOptions): Promise<Thread> {
    return this.http.request<Thread>({
      method: "PATCH",
      path: `/threads/${encodeURIComponent(id)}`,
      body: input,
      options,
    });
  }

  /**
   * To the trash, and out of it for good on a second call.
   *
   * `{ permanent: true }` skips the trash. There is no undo for that.
   */
  delete(
    id: string,
    params: { permanent?: boolean } = {},
    options?: RequestOptions,
  ): Promise<Deleted & { permanent: boolean }> {
    return this.http.request<Deleted & { permanent: boolean }>({
      method: "DELETE",
      path: `/threads/${encodeURIComponent(id)}`,
      query: { permanent: params.permanent },
      options,
    });
  }

  /**
   * Answers a conversation.
   *
   * Who it goes to, what it is called and the headers that keep it threaded
   * are all read off the last message, and each can be overridden.
   */
  reply(id: string, input: ReplyInput, options?: RequestOptions): Promise<SentEmail> {
    return this.http.request<SentEmail>({
      method: "POST",
      path: `/threads/${encodeURIComponent(id)}/reply`,
      body: input,
      options,
    });
  }
}
