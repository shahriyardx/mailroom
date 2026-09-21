/**
 * Every failure the API can report, and the two this package adds for a call
 * that never reached it.
 *
 * The server sends `{ error, code }` on every non-2xx reply, so `code` is the
 * field to branch on and `message` is the sentence to log.
 */
export type MailroomErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "payload_too_large"
  | "server_error"
  /** The request could not be made at all: DNS, TLS, a dropped socket. */
  | "connection_error"
  /** No reply within the configured timeout. */
  | "timeout";

export interface MailroomErrorOptions {
  status: number;
  code: MailroomErrorCode;
  /** The decoded reply body, when there was one. */
  body?: unknown;
  /** Which field the server objected to, for `invalid_request`. */
  param?: string;
  method?: string;
  path?: string;
  cause?: unknown;
}

/** The base class every error this package throws extends. */
export class MailroomError extends Error {
  readonly status: number;
  readonly code: MailroomErrorCode;
  readonly body: unknown;
  readonly param?: string;
  readonly method?: string;
  readonly path?: string;

  constructor(message: string, options: MailroomErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
    this.param = options.param;
    this.method = options.method;
    this.path = options.path;
  }
}

/** 401 — the key is missing, mistyped, or has been revoked. */
export class AuthenticationError extends MailroomError {}

/**
 * 403 — the key is real but not allowed to do this. Either it lacks a scope,
 * or the thing being touched is outside its reach.
 */
export class PermissionError extends MailroomError {
  /** The scope the endpoint wanted, when a missing scope was the reason. */
  readonly requiredScope?: string;

  constructor(message: string, options: MailroomErrorOptions) {
    super(message, options);
    const body = options.body as { required_scope?: string } | undefined;
    this.requiredScope = body?.required_scope;
  }
}

/** 404 — no such object, or none this key may see. The two look the same on purpose. */
export class NotFoundError extends MailroomError {}

/** 422 — the request was understood and is wrong. `param` names the field. */
export class ValidationError extends MailroomError {}

/** 409 — it already exists, or a destructive call needs its confirmation flag. */
export class ConflictError extends MailroomError {}

/** 413 — the body is over the 30 MB limit. Usually an attachment. */
export class PayloadTooLargeError extends MailroomError {}

/** 429 — too many calls this minute. */
export class RateLimitError extends MailroomError {
  /** Seconds to wait, straight from the `Retry-After` header. */
  readonly retryAfter?: number;

  constructor(message: string, options: MailroomErrorOptions & { retryAfter?: number }) {
    super(message, options);
    this.retryAfter = options.retryAfter;
  }
}

/** 5xx — the instance failed. Safe to retry. */
export class ServerError extends MailroomError {}

/** The request never got a reply: DNS, TLS, a dropped socket, an abort. */
export class ConnectionError extends MailroomError {
  constructor(message: string, options: Omit<MailroomErrorOptions, "status" | "code">) {
    super(message, { ...options, status: 0, code: "connection_error" });
  }
}

/** No reply within `timeout` milliseconds. */
export class TimeoutError extends MailroomError {
  constructor(message: string, options: Omit<MailroomErrorOptions, "status" | "code">) {
    super(message, { ...options, status: 0, code: "timeout" });
  }
}

/** A webhook body that did not match its signature. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export function isMailroomError(value: unknown): value is MailroomError {
  return value instanceof MailroomError;
}

const BY_STATUS: Record<number, typeof MailroomError> = {
  401: AuthenticationError,
  403: PermissionError,
  404: NotFoundError,
  409: ConflictError,
  413: PayloadTooLargeError,
  422: ValidationError,
  429: RateLimitError,
};

/** Turns a non-2xx reply into the right class, whatever the body looks like. */
export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
  method: string,
  path: string,
): MailroomError {
  const shape = body as { error?: string; code?: MailroomErrorCode; param?: string } | undefined;
  const message =
    typeof shape?.error === "string" && shape.error.length > 0
      ? shape.error
      : `Mailroom replied ${status}`;
  const code = shape?.code ?? fallbackCode(status);

  const options: MailroomErrorOptions = { status, code, body, param: shape?.param, method, path };

  if (status === 429) {
    const header = headers.get("retry-after");
    const retryAfter = header === null ? undefined : Number(header);
    return new RateLimitError(message, {
      ...options,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
    });
  }

  const Kind = BY_STATUS[status] ?? (status >= 500 ? ServerError : MailroomError);
  return new Kind(message, options);
}

function fallbackCode(status: number): MailroomErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "invalid_request";
}
