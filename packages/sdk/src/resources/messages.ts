import type { HttpClient, RequestOptions } from "../http.js";
import { paginate } from "../http.js";
import type { Folder, Message, Page } from "../types.js";

export interface ListMessagesParams {
  limit?: number;
  cursor?: string;
  direction?: "inbound" | "outbound";
  folder?: Folder | "all";
  thread_id?: string;
  /** Include drafts, or ask for only drafts. Both are returned by default. */
  drafts?: boolean;
  unread?: boolean;
  starred?: boolean;
  from?: string;
  to?: string;
  subject?: string;
  q?: string;
  since?: Date | string;
  until?: Date | string;
  mailbox_id?: string;
  mailbox?: string;
  domain?: string;
  /** Bodies are large, so they are left out of a list unless asked for. */
  include_body?: boolean;
}

export interface UpdateMessageInput {
  is_read?: boolean;
  is_starred?: boolean;
}

/**
 * Messages on their own, inbound and outbound, flat.
 *
 * Threads are the better way to read a conversation. This is for when a
 * program wants messages themselves: everything since a stamp, everything
 * from one sender, everything unread.
 */
export class Messages {
  constructor(private readonly http: HttpClient) {}

  list(params: ListMessagesParams = {}, options?: RequestOptions): Promise<Page<Message>> {
    return this.http.request<Page<Message>>({
      method: "GET",
      path: "/messages",
      query: { ...params },
      options,
    });
  }

  listAll(
    params: ListMessagesParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<Message, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  /** One message with its body, files and events. */
  get(id: string, options?: RequestOptions): Promise<Message> {
    return this.http.request<Message>({
      method: "GET",
      path: `/messages/${encodeURIComponent(id)}`,
      options,
    });
  }

  /** Read and star one message, rather than the whole thread. */
  update(id: string, input: UpdateMessageInput, options?: RequestOptions): Promise<Message> {
    return this.http.request<Message>({
      method: "PATCH",
      path: `/messages/${encodeURIComponent(id)}`,
      body: input,
      options,
    });
  }

  /**
   * The message exactly as it arrived, as `message/rfc822` bytes.
   *
   * Feed it to a MIME parser, re-send it, or keep it for an audit. Only
   * inbound mail has one: outbound mail is assembled at send time and its
   * wire form is not stored.
   */
  raw(id: string, options?: RequestOptions): Promise<Uint8Array> {
    return this.http.requestBinary({
      method: "GET",
      path: `/messages/${encodeURIComponent(id)}/raw`,
      options,
    });
  }
}
