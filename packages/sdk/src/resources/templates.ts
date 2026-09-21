import type { HttpClient, RequestOptions } from "../http.js";
import { paginate } from "../http.js";
import type { Page, Template, TemplateInput } from "../types.js";

/**
 * Saved subjects and bodies, sent by name.
 *
 * The point is that the wording stops living inside the service doing the
 * sending: change a receipt here and every service that sends it changes with
 * it, without a deploy.
 */
export class Templates {
  constructor(private readonly http: HttpClient) {}

  /** One page of templates, by name. */
  list(
    params: { limit?: number; cursor?: string } = {},
    options?: RequestOptions,
  ): Promise<Page<Template>> {
    return this.http.request<Page<Template>>({
      method: "GET",
      path: "/templates",
      query: { ...params },
      options,
    });
  }

  /** Every template, paging as it goes. */
  listAll(
    params: { limit?: number } = {},
    options?: RequestOptions,
  ): AsyncGenerator<Template, void, undefined> {
    return paginate((cursor) => this.list({ ...params, cursor }, options));
  }

  /** One template, by id or by slug — both are names for it. */
  get(idOrSlug: string, options?: RequestOptions): Promise<Template> {
    return this.http.request<Template>({
      method: "GET",
      path: `/templates/${encodeURIComponent(idOrSlug)}`,
      options,
    });
  }

  /**
   * Saves a new one.
   *
   * ```ts
   * await mail.templates.create({
   *   name: "Welcome",
   *   subject: "Welcome aboard, {{ name }}",
   *   html: "<p>Hello {{ name }}.</p>",
   * });
   * ```
   */
  create(input: TemplateInput, options?: RequestOptions): Promise<Template> {
    return this.http.request<Template>({
      method: "POST",
      path: "/templates",
      body: input,
      options,
    });
  }

  /** Changes what is given and leaves the rest alone. */
  update(
    idOrSlug: string,
    input: Partial<TemplateInput>,
    options?: RequestOptions,
  ): Promise<Template> {
    return this.http.request<Template>({
      method: "PATCH",
      path: `/templates/${encodeURIComponent(idOrSlug)}`,
      body: input,
      options,
    });
  }

  delete(idOrSlug: string, options?: RequestOptions): Promise<{ id: string; deleted: boolean }> {
    return this.http.request<{ id: string; deleted: boolean }>({
      method: "DELETE",
      path: `/templates/${encodeURIComponent(idOrSlug)}`,
      options,
    });
  }
}
