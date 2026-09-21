import type { HttpClient, RequestOptions } from "../http.js";
import type { Stats } from "../types.js";

export interface StatsParams {
  /** A window ending now. 1 to 365, default 30. Ignored if `since` is given. */
  days?: number;
  since?: Date | string;
  until?: Date | string;
  mailbox_id?: string;
  mailbox?: string;
  domain?: string;
}

/** How much was sent and received, and how it landed. */
export class StatsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Totals and a row per day, so a chart needs one call rather than one per
   * point. `bounce_rate` and `complaint_rate` are shares of sent mail out of
   * 100 — SES starts warning above 5 and 0.1.
   */
  get(params: StatsParams = {}, options?: RequestOptions): Promise<Stats> {
    return this.http.request<Stats>({
      method: "GET",
      path: "/stats",
      query: { ...params },
      options,
    });
  }
}
