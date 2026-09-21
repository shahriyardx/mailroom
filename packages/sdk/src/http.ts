import {
  ConnectionError,
  MailroomError,
  RateLimitError,
  TimeoutError,
  errorFromResponse,
} from "./errors.js";
import type { Page } from "./types.js";

/** A value that can go in a query string. */
export type QueryValue = string | number | boolean | Date | string[] | null | undefined;
export type Query = Record<string, QueryValue>;

export interface MailroomOptions {
  /**
   * The key, `mk_live_…`, from Settings → API keys.
   * Defaults to `process.env.MAILROOM_API_KEY`.
   */
  apiKey?: string;
  /**
   * Where your instance lives, e.g. `https://mail.example.com`. The `/api/v1`
   * suffix is added for you if you leave it off.
   * Defaults to `process.env.MAILROOM_BASE_URL`.
   */
  baseUrl?: string;
  /** Milliseconds to wait for a reply. Default 30000. */
  timeout?: number;
  /**
   * How many times to try again after a 429, a 5xx or a dropped connection.
   * Default 2. Only calls that are safe to repeat are retried: every GET, and
   * any POST sent with an idempotency key.
   */
  maxRetries?: number;
  /** Swap in your own fetch — a test double, or one with an agent attached. */
  fetch?: typeof globalThis.fetch;
  /** Sent on every request, under anything this package sets itself. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  /** Abort the call from outside. Combined with the client's own timeout. */
  signal?: AbortSignal;
  /** Extra headers for this one call. */
  headers?: Record<string, string>;
  /**
   * Makes a repeat of this call safe: the first reply is stored for 24 hours
   * and returned again instead of sending twice.
   */
  idempotencyKey?: string;
}

/** What the rate-limit headers said on the last reply. */
export interface RateLimitState {
  limit: number;
  remaining: number;
  /** When the current window ends. */
  resetAt: Date;
}

interface Call {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Query;
  body?: unknown;
  /** Statuses to hand back as a value rather than throw on. */
  allow?: number[];
  /** Return the raw bytes instead of parsing JSON. */
  raw?: boolean;
  options?: RequestOptions;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 2;
const VERSION = "0.1.0";

function env(name: string): string | undefined {
  const holder = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return holder.process?.env?.[name];
}

/**
 * The bit that actually talks to the server.
 *
 * Kept apart from the resource methods so the retry, timeout and error rules
 * are written once, and so `client.request()` can reach an endpoint this
 * package has not caught up with yet.
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly extraHeaders: Record<string, string>;

  /** The rate-limit headers from the most recent reply, or null before one. */
  rateLimit: RateLimitState | null = null;

  constructor(options: MailroomOptions = {}) {
    const apiKey = options.apiKey ?? env("MAILROOM_API_KEY");
    if (!apiKey) {
      throw new Error(
        "No API key. Pass { apiKey } or set MAILROOM_API_KEY. Keys are made in Settings → API keys.",
      );
    }

    const baseUrl = options.baseUrl ?? env("MAILROOM_BASE_URL");
    if (!baseUrl) {
      throw new Error(
        "No base URL. Pass { baseUrl: 'https://mail.example.com' } or set MAILROOM_BASE_URL.",
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_RETRIES;
    this.extraHeaders = options.headers ?? {};

    const chosen = options.fetch ?? globalThis.fetch;
    if (typeof chosen !== "function") {
      throw new Error(
        "No fetch available. Use Node 18 or newer, or pass { fetch } into the client.",
      );
    }
    // Bound, because an unbound global fetch throws "Illegal invocation".
    this.doFetch = chosen.bind(globalThis);
  }

  /** A call that returns JSON. */
  async request<T>(call: Call): Promise<T> {
    return (await this.send(call)) as T;
  }

  /** A call that returns bytes, such as a raw message or a downloaded file. */
  async requestBinary(call: Call): Promise<Uint8Array> {
    return (await this.send({ ...call, raw: true })) as Uint8Array;
  }

  private async send(call: Call): Promise<unknown> {
    const url = this.baseUrl + call.path + encodeQuery(call.query);
    const repeatable = call.method === "GET" || Boolean(call.options?.idempotencyKey);
    const attempts = repeatable ? this.maxRetries + 1 : 1;

    let lastError: MailroomError | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.once(url, call);
      } catch (error) {
        if (!(error instanceof MailroomError)) throw error;
        if (attempt === attempts || !worthRetrying(error)) throw error;
        lastError = error;
        await sleep(backoffMs(attempt, error));
      }
    }

    // Unreachable: the loop either returns or throws.
    throw lastError ?? new ConnectionError("The request could not be made", {});
  }

  private async once(url: string, call: Call): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: call.raw ? "*/*" : "application/json",
      "User-Agent": `mailroom-node/${VERSION}`,
      ...this.extraHeaders,
      ...call.options?.headers,
    };
    if (call.body !== undefined) headers["Content-Type"] = "application/json";
    if (call.options?.idempotencyKey) headers["Idempotency-Key"] = call.options.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const outside = call.options?.signal;
    const relay = () => controller.abort();
    outside?.addEventListener("abort", relay, { once: true });

    let response: Response;
    try {
      response = await this.doFetch(url, {
        method: call.method,
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
        signal: controller.signal,
      });
    } catch (cause) {
      // An abort from the caller is theirs to see; one from our own timer is
      // a timeout, and saying so saves somebody reading their own code.
      if (outside?.aborted) throw cause;
      const aborted = (cause as { name?: string })?.name === "AbortError";
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw aborted
        ? new TimeoutError(`No reply from ${this.baseUrl} within ${this.timeout}ms`, {
            method: call.method,
            path: call.path,
            cause,
          })
        : new ConnectionError(`Could not reach ${this.baseUrl}: ${detail}`, {
            method: call.method,
            path: call.path,
            cause,
          });
    } finally {
      clearTimeout(timer);
      outside?.removeEventListener("abort", relay);
    }

    this.readRateLimit(response.headers);

    const allowed = response.ok || (call.allow?.includes(response.status) ?? false);

    if (call.raw && allowed) {
      return new Uint8Array(await response.arrayBuffer());
    }

    const body = await readJson(response);
    if (allowed) return body;

    throw errorFromResponse(response.status, body, response.headers, call.method, call.path);
  }

  private readRateLimit(headers: Headers) {
    const limit = Number(headers.get("x-ratelimit-limit"));
    const remaining = Number(headers.get("x-ratelimit-remaining"));
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return;
    this.rateLimit = {
      limit,
      remaining,
      resetAt: new Date((Number.isFinite(reset) ? reset : Date.now() / 1000) * 1000),
    };
  }
}

/** `https://mail.example.com/` and `…/api/v1` both mean the same thing. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /\/api\/v1$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`;
}

export function encodeQuery(query: Query | undefined): string {
  if (!query) return "";
  const parts = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      parts.set(name, value.join(","));
    } else if (value instanceof Date) {
      parts.set(name, value.toISOString());
    } else {
      parts.set(name, String(value));
    }
  }
  const encoded = parts.toString();
  return encoded ? `?${encoded}` : "";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // An HTML error page from a proxy in front of the instance, most likely.
    return { error: text.slice(0, 500) };
  }
}

function worthRetrying(error: MailroomError) {
  return (
    error.code === "connection_error" ||
    error.code === "timeout" ||
    error.code === "rate_limited" ||
    error.status >= 500
  );
}

/** Exponential, with jitter, and never shorter than the server asked for. */
function backoffMs(attempt: number, error: MailroomError) {
  if (error instanceof RateLimitError && error.retryAfter) {
    return Math.min(error.retryAfter * 1000, 60_000);
  }
  const base = Math.min(500 * 2 ** (attempt - 1), 8_000);
  return base + Math.random() * 250;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Walks every page of a list endpoint, one object at a time.
 *
 * `for await (const thread of mail.threads.listAll())` reads as a loop over
 * threads, and the cursor never has to be held by the caller.
 */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.data) yield item;
    if (!page.has_more || !page.next_cursor) return;
    cursor = page.next_cursor;
  }
}
