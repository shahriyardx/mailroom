/**
 * The Node and TypeScript SDK for Mailroom.
 *
 * @see https://github.com/shahriyardx/mailroom/tree/main/packages/sdk#readme
 */
export { Mailroom } from "./client.js";
export { Mailroom as default } from "./client.js";

export {
  HttpClient,
  paginate,
  type MailroomOptions,
  type RateLimitState,
  type RequestOptions,
} from "./http.js";

export {
  AuthenticationError,
  ConflictError,
  ConnectionError,
  MailroomError,
  NotFoundError,
  PayloadTooLargeError,
  PermissionError,
  RateLimitError,
  ServerError,
  TimeoutError,
  ValidationError,
  WebhookVerificationError,
  isMailroomError,
  type MailroomErrorCode,
} from "./errors.js";

export {
  constructWebhookEvent,
  signWebhookPayload,
  verifyWebhook,
  type DeliveryEmailSummary,
  type MailroomWebhookEvent,
  type ReceivedEmail,
  type SentEmailSummary,
  type VerifyOptions,
  type WebhookEventEnvelope,
} from "./webhook.js";

export type * from "./types.js";

export type { ListEmailsParams } from "./resources/emails.js";
export type { ListThreadsParams, ReplyInput, UpdateThreadInput } from "./resources/threads.js";
export type { ListMessagesParams, UpdateMessageInput } from "./resources/messages.js";
export type { CreateMailboxInput, UpdateMailboxInput } from "./resources/mailboxes.js";
export type { CreateLabelInput, UpdateLabelInput } from "./resources/labels.js";
export type { ListContactsParams } from "./resources/contacts.js";
export type { ListSuppressionsParams } from "./resources/suppressions.js";
export type {
  CreateWebhookInput,
  ListDeliveriesParams,
  UpdateWebhookInput,
} from "./resources/webhooks.js";
export type { StatsParams } from "./resources/stats.js";
