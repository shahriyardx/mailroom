import type { HttpClient, RequestOptions } from "../http.js";
import { paginate } from "../http.js";
import type { Deleted, Page, Suppression } from "../types.js";

export interface ListSuppressionsParams {
  limit?: number;
  cursor?: string;
  /** Substring of the address. */
  q?: string;
}

/**
 * Addresses this account will not send to again.
 *
 * Bounces and complaints fill this in on their own. Everything here got there
 * for a reason worth reading before taking it back out.
 */
export class Suppressions {
  constructor(private readonly http: HttpClient) {}

  list(params: ListSuppressionsParams = {}, options?: RequestOptions): Promise<Page<Suppression>> {
    return this.http.request<Page<Suppression>>({
      method: "GET",
      path: "/suppressions",
      query: { ...params },
      options,
    });
  }

  listAll(
    params: ListSuppressionsParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<Suppression, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  /** Blocks an address by hand. Blocking one already blocked is not an error. */
  create(
    input: { address: string; reason?: string },
    options?: RequestOptions,
  ): Promise<Suppression> {
    return this.http.request<Suppression>({
      method: "POST",
      path: "/suppressions",
      body: input,
      options,
    });
  }

  /**
   * Unblocks, by id or by address.
   *
   * Worth knowing: mail to this address bounced or was reported as spam.
   * Sending again risks the account's own sending reputation.
   */
  delete(idOrAddress: string, options?: RequestOptions): Promise<Deleted & { address: string }> {
    return this.http.request<Deleted & { address: string }>({
      method: "DELETE",
      path: `/suppressions/${encodeURIComponent(idOrAddress)}`,
      options,
    });
  }
}
