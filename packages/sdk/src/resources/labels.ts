import type { HttpClient, RequestOptions } from "../http.js";
import type { Deleted, Label, Page } from "../types.js";

export interface CreateLabelInput {
  name: string;
  /** A hex value like `#64748b`. */
  color?: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}

/** The labels threads are filed under. */
export class Labels {
  constructor(private readonly http: HttpClient) {}

  list(options?: RequestOptions): Promise<Page<Label>> {
    return this.http.request<Page<Label>>({ method: "GET", path: "/labels", options });
  }

  /** By id, or by name. */
  get(idOrName: string, options?: RequestOptions): Promise<Label> {
    return this.http.request<Label>({
      method: "GET",
      path: `/labels/${encodeURIComponent(idOrName)}`,
      options,
    });
  }

  create(input: CreateLabelInput, options?: RequestOptions): Promise<Label> {
    return this.http.request<Label>({ method: "POST", path: "/labels", body: input, options });
  }

  update(idOrName: string, input: UpdateLabelInput, options?: RequestOptions): Promise<Label> {
    return this.http.request<Label>({
      method: "PATCH",
      path: `/labels/${encodeURIComponent(idOrName)}`,
      body: input,
      options,
    });
  }

  /** The label goes; the threads it was on stay. */
  delete(idOrName: string, options?: RequestOptions): Promise<Deleted> {
    return this.http.request<Deleted>({
      method: "DELETE",
      path: `/labels/${encodeURIComponent(idOrName)}`,
      options,
    });
  }
}
