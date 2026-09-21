import type { HttpClient, RequestOptions } from "../http.js";
import type { Deleted, Mailbox, Page } from "../types.js";

export interface CreateMailboxInput {
  /** Must sit on a domain this account has verified, or under one. */
  address: string;
  display_name?: string;
  signature?: string;
  is_catch_all?: boolean;
  /** The address the web composer opens with. Only one at a time. */
  is_default?: boolean;
  color?: string;
}

export interface UpdateMailboxInput {
  display_name?: string;
  signature?: string | null;
  is_catch_all?: boolean;
  is_default?: boolean;
  color?: string;
}

/** The addresses on your domains. */
export class Mailboxes {
  constructor(private readonly http: HttpClient) {}

  /**
   * Every address this key can reach.
   *
   * A key limited to part of the account sees only its part, which is the
   * quickest way for a client to discover what it may do.
   */
  list(
    params: { domain?: string; limit?: number } = {},
    options?: RequestOptions,
  ): Promise<Page<Mailbox>> {
    return this.http.request<Page<Mailbox>>({
      method: "GET",
      path: "/mailboxes",
      query: { ...params },
      options,
    });
  }

  get(id: string, options?: RequestOptions): Promise<Mailbox> {
    return this.http.request<Mailbox>({
      method: "GET",
      path: `/mailboxes/${encodeURIComponent(id)}`,
      options,
    });
  }

  create(input: CreateMailboxInput, options?: RequestOptions): Promise<Mailbox> {
    return this.http.request<Mailbox>({
      method: "POST",
      path: "/mailboxes",
      body: input,
      options,
    });
  }

  /** The address itself cannot change. Make a new mailbox for that. */
  update(id: string, input: UpdateMailboxInput, options?: RequestOptions): Promise<Mailbox> {
    return this.http.request<Mailbox>({
      method: "PATCH",
      path: `/mailboxes/${encodeURIComponent(id)}`,
      body: input,
      options,
    });
  }

  /**
   * Deletes the mailbox **and every message in it**.
   *
   * `confirm: true` is required, so a mistyped id cannot empty an inbox.
   */
  delete(id: string, params: { confirm: true }, options?: RequestOptions): Promise<Deleted> {
    return this.http.request<Deleted>({
      method: "DELETE",
      path: `/mailboxes/${encodeURIComponent(id)}`,
      query: { confirm: params.confirm },
      options,
    });
  }
}
