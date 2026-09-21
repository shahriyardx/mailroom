import type { HttpClient, RequestOptions } from "../http.js";
import { paginate } from "../http.js";
import type { Contact, Page } from "../types.js";

export interface ListContactsParams {
  limit?: number;
  cursor?: string;
  /** Matches the address or the name. */
  q?: string;
  /** `recent` (the default) or `frequent`. */
  order?: "recent" | "frequent";
}

/**
 * Everyone this account has written to or heard from.
 *
 * Contacts are kept for the whole account, so only a key that reaches all of
 * it can read them; a narrower key gets a 403.
 */
export class Contacts {
  constructor(private readonly http: HttpClient) {}

  list(params: ListContactsParams = {}, options?: RequestOptions): Promise<Page<Contact>> {
    return this.http.request<Page<Contact>>({
      method: "GET",
      path: "/contacts",
      query: { ...params },
      options,
    });
  }

  listAll(
    params: ListContactsParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<Contact, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }
}
