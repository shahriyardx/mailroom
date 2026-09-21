import type { HttpClient, RequestOptions } from "../http.js";
import type { Deleted, Domain, Page } from "../types.js";

/** Sending domains, and the DNS they need. */
export class Domains {
  constructor(private readonly http: HttpClient) {}

  /** What this account can send from, each with its `records` to publish. */
  list(options?: RequestOptions): Promise<Page<Domain>> {
    return this.http.request<Page<Domain>>({ method: "GET", path: "/domains", options });
  }

  /** By id, or by name — `mail.domains.get("example.com")` works. */
  get(idOrName: string, options?: RequestOptions): Promise<Domain> {
    return this.http.request<Domain>({
      method: "GET",
      path: `/domains/${encodeURIComponent(idOrName)}`,
      options,
    });
  }

  /**
   * Creates the identity in SES and returns the records to publish.
   *
   * Only a key that reaches the whole account may do this. A subdomain of a
   * domain already verified here is recorded as covered by its parent and
   * needs no DNS of its own.
   */
  create(name: string, options?: RequestOptions): Promise<Domain> {
    return this.http.request<Domain>({
      method: "POST",
      path: "/domains",
      body: { name },
      options,
    });
  }

  /**
   * Asks SES where the identity stands and probes SPF and DMARC, then returns
   * the domain as it now is. This is what a setup script polls after
   * publishing records.
   */
  verify(idOrName: string, options?: RequestOptions): Promise<Domain> {
    return this.http.request<Domain>({
      method: "POST",
      path: `/domains/${encodeURIComponent(idOrName)}/verify`,
      options,
    });
  }

  /**
   * Removes the domain here.
   *
   * `deleteInSes: true` deletes the SES identity as well, which cannot be
   * undone and which other instances may be relying on.
   */
  delete(
    idOrName: string,
    params: { deleteInSes?: boolean } = {},
    options?: RequestOptions,
  ): Promise<Deleted & { name: string; deleted_in_ses: boolean }> {
    return this.http.request<Deleted & { name: string; deleted_in_ses: boolean }>({
      method: "DELETE",
      path: `/domains/${encodeURIComponent(idOrName)}`,
      query: { delete_in_ses: params.deleteInSes },
      options,
    });
  }
}
