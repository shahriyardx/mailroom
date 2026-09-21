import type { HttpClient, RequestOptions } from "../http.js";
import type { AttachmentWithLink } from "../types.js";

/** Files that came in on a message. */
export class Attachments {
  constructor(private readonly http: HttpClient) {}

  /**
   * The file's details and a `download_url` good for five minutes.
   *
   * Use this when the file is large or is being handed to a browser; the link
   * goes straight to storage and does not spend your rate limit.
   */
  get(id: string, options?: RequestOptions): Promise<AttachmentWithLink> {
    return this.http.request<AttachmentWithLink>({
      method: "GET",
      path: `/attachments/${encodeURIComponent(id)}`,
      options,
    });
  }

  /** The bytes themselves, in one call. */
  download(id: string, options?: RequestOptions): Promise<Uint8Array> {
    return this.http.requestBinary({
      method: "GET",
      path: `/attachments/${encodeURIComponent(id)}`,
      query: { download: true },
      options,
    });
  }
}
