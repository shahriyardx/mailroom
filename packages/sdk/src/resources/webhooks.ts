import type { HttpClient, RequestOptions } from "../http.js";
import { paginate } from "../http.js";
import type {
  Deleted,
  Page,
  Webhook,
  WebhookAttempt,
  WebhookDelivery,
  WebhookEventName,
} from "../types.js";

export interface CreateWebhookInput {
  /** Must be https, and must not point inside a private network. */
  url: string;
  description?: string;
  /** Event names, or `["*"]` for everything, including events added later. */
  events?: (WebhookEventName | "*")[];
  /** Only fire for mail in this one mailbox. */
  mailbox_id?: string;
  enabled?: boolean;
}

export interface UpdateWebhookInput {
  url?: string;
  description?: string | null;
  events?: (WebhookEventName | "*")[];
  enabled?: boolean;
  mailbox_id?: string | null;
  /** Replaces the signing secret and returns the new one, once. */
  rotate_secret?: boolean;
}

export interface ListDeliveriesParams {
  limit?: number;
  cursor?: string;
  webhook_id?: string;
  event?: string;
  succeeded?: boolean;
}

/** Where events are sent, and what happened when they were. */
export class Webhooks {
  constructor(private readonly http: HttpClient) {}

  list(options?: RequestOptions): Promise<Page<Webhook>> {
    return this.http.request<Page<Webhook>>({ method: "GET", path: "/webhooks", options });
  }

  get(id: string, options?: RequestOptions): Promise<Webhook> {
    return this.http.request<Webhook>({
      method: "GET",
      path: `/webhooks/${encodeURIComponent(id)}`,
      options,
    });
  }

  /**
   * Creates an endpoint. **The reply carries the signing secret, and it is
   * shown here and never again** — store it before you do anything else.
   *
   * An endpoint that does not check the signature will accept anything
   * anybody posts at it. See `verifyWebhook`.
   */
  create(input: CreateWebhookInput, options?: RequestOptions): Promise<Webhook> {
    return this.http.request<Webhook>({
      method: "POST",
      path: "/webhooks",
      body: input,
      options,
    });
  }

  /**
   * Turning an endpoint back on also clears its failure count, which is what
   * somebody means by having fixed it.
   */
  update(id: string, input: UpdateWebhookInput, options?: RequestOptions): Promise<Webhook> {
    return this.http.request<Webhook>({
      method: "PATCH",
      path: `/webhooks/${encodeURIComponent(id)}`,
      body: input,
      options,
    });
  }

  /** The endpoint and its delivery history go together. */
  delete(id: string, options?: RequestOptions): Promise<Deleted> {
    return this.http.request<Deleted>({
      method: "DELETE",
      path: `/webhooks/${encodeURIComponent(id)}`,
      options,
    });
  }

  /** Stops delivery but keeps the endpoint and its history. */
  disable(id: string, options?: RequestOptions): Promise<Webhook> {
    return this.http.request<Webhook>({
      method: "DELETE",
      path: `/webhooks/${encodeURIComponent(id)}`,
      query: { disable_only: true },
      options,
    });
  }

  /**
   * Sends a `webhook.test` event and waits for the answer.
   *
   * Unlike a real event this is not retried and not sent in the background:
   * the point is to see, now, whether the endpoint is reachable and whether
   * it is checking the signature. A failure comes back as a result with
   * `succeeded: false`, not as a thrown error.
   */
  ping(id: string, options?: RequestOptions): Promise<WebhookAttempt> {
    return this.http.request<WebhookAttempt>({
      method: "POST",
      path: `/webhooks/${encodeURIComponent(id)}/ping`,
      allow: [502],
      options,
    });
  }

  /** Every attempt at every endpoint, newest first. */
  listDeliveries(
    params: ListDeliveriesParams = {},
    options?: RequestOptions,
  ): Promise<Page<WebhookDelivery>> {
    return this.http.request<Page<WebhookDelivery>>({
      method: "GET",
      path: "/webhook-deliveries",
      query: { ...params },
      options,
    });
  }

  listAllDeliveries(
    params: ListDeliveriesParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<WebhookDelivery, void, undefined> {
    return paginate((cursor) => this.listDeliveries({ ...params, cursor }, options));
  }

  /**
   * Sends a stored payload again — what an endpoint that was down gets caught
   * up with, once it is back.
   */
  replay(deliveryId: string, options?: RequestOptions): Promise<WebhookAttempt> {
    return this.http.request<WebhookAttempt>({
      method: "POST",
      path: `/webhook-deliveries/${encodeURIComponent(deliveryId)}/replay`,
      allow: [502],
      options,
    });
  }
}
