import { type Settings, getSettings, watchedMailboxIds, watchesNothing } from "./settings";
import type { ApiIdentity, ApiList, ApiMailbox, ApiMessage, ApiThread, View } from "./types";

/**
 * A thin client for the Mailroom v1 API.
 *
 * Fetches run from the extension's own pages and its background worker, both
 * of which hold the host permission for the instance, so no CORS dance is
 * needed and no server change was required to support this.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  /** Worth telling the reader to go and check their key over. */
  get isAuth() {
    return this.status === 401 || this.status === 403;
  }
}

interface Options {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function call<T>(
  settings: Pick<Settings, "baseUrl" | "apiKey">,
  path: string,
  options: Options = {},
): Promise<T> {
  if (!settings.baseUrl || !settings.apiKey) {
    throw new ApiError(401, "unauthorized", "Mailroom is not connected yet.");
  }

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}/api/v1${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      // The key is the credential; a cookie from a signed-in tab must never
      // be what decides who this call is.
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "unreachable", `Could not reach ${settings.baseUrl}.`);
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (body && typeof body.error === "string" && body.error) ||
      `The server answered ${response.status}.`;
    const code = (body && typeof body.code === "string" && body.code) || "server_error";
    throw new ApiError(response.status, code, message);
  }

  return body as T;
}

/** The same call, with the stored settings looked up for you. */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  return call<T>(await getSettings(), path, options);
}

/* ------------------------------------------------------------------ queries */

/** A view turned into the query the API understands. */
export function query(
  view: View,
  extra: { mailboxIds?: string[]; search?: string; limit?: number; cursor?: string | null } = {},
): string {
  const params = new URLSearchParams();

  if (view === "starred") {
    params.set("folder", "all");
    params.set("starred", "true");
  } else {
    params.set("folder", view === "unread" ? "inbox" : view);
    if (view === "unread") params.set("unread", "true");
  }

  // The API narrows to one mailbox at a time. With several chosen the caller
  // asks once per mailbox and merges; with one it goes in here.
  const only = extra.mailboxIds ?? [];
  if (only.length === 1) params.set("mailbox_id", only[0] as string);

  if (extra.search?.trim()) params.set("q", extra.search.trim());
  params.set("limit", String(extra.limit ?? 25));
  if (extra.cursor) params.set("next_cursor", extra.cursor);

  return params.toString();
}

export interface ListResult {
  threads: ApiThread[];
  nextCursor: string | null;
}

/**
 * A page of conversations.
 *
 * When the reader has picked more than one mailbox this fans out and merges,
 * because the API takes a single `mailbox_id`. Paging past the first page is
 * only offered for a single scope: merged cursors from different queries
 * cannot be combined into one, and quietly returning the wrong second page
 * would be worse than not having one.
 */
export async function listThreads(
  settings: Settings,
  view: View,
  extra: { search?: string; cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<ListResult> {
  // Watching nothing is a real answer, and it is not the same as watching
  // everything. Asking the server here would return the whole account.
  if (watchesNothing(settings)) return { threads: [], nextCursor: null };

  const ids = watchedMailboxIds(settings) ?? [];

  if (ids.length > 1) {
    const pages = await Promise.all(
      ids.map((id) =>
        call<ApiList<ApiThread>>(
          settings,
          `/threads?${query(view, { mailboxIds: [id], search: extra.search, limit: extra.limit })}`,
          { signal: extra.signal },
        ).catch(() => null),
      ),
    );
    const merged = pages
      .filter((page): page is ApiList<ApiThread> => page !== null)
      .flatMap((page) => page.data)
      .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
    return { threads: merged.slice(0, extra.limit ?? 25), nextCursor: null };
  }

  const page = await call<ApiList<ApiThread>>(
    settings,
    `/threads?${query(view, {
      mailboxIds: ids,
      search: extra.search,
      limit: extra.limit,
      cursor: extra.cursor,
    })}`,
    { signal: extra.signal },
  );
  return { threads: page.data, nextCursor: page.next_cursor };
}

export async function getThread(settings: Settings, id: string, signal?: AbortSignal) {
  return call<ApiThread>(settings, `/threads/${id}`, { signal });
}

export interface ThreadPatch {
  folder?: string;
  is_read?: boolean;
  is_starred?: boolean;
  add_labels?: string[];
  remove_labels?: string[];
}

export async function patchThread(settings: Settings, id: string, patch: ThreadPatch) {
  return call<ApiThread>(settings, `/threads/${id}`, { method: "PATCH", body: patch });
}

export async function deleteThread(settings: Settings, id: string, permanent = false) {
  return call<{ deleted: boolean }>(
    settings,
    `/threads/${id}${permanent ? "?permanent=true" : ""}`,
    { method: "DELETE" },
  );
}

export async function listMailboxes(settings: Settings, signal?: AbortSignal) {
  const page = await call<ApiList<ApiMailbox>>(settings, "/mailboxes?limit=100", { signal });
  return page.data;
}

export async function whoami(settings: Settings, signal?: AbortSignal) {
  return call<ApiIdentity>(settings, "/me", { signal });
}

/* --------------------------------------------------------------- deep links */

/** Where a thread lives in the web app. */
export function threadUrl(settings: Settings, thread: { id: string }, folder = "inbox") {
  return `${settings.baseUrl}/mail/all/${folder}?t=${encodeURIComponent(thread.id)}`;
}

/** The same, with the reply box already open. */
export function replyUrl(
  settings: Settings,
  thread: { id: string },
  folder = "inbox",
  mode: "reply" | "replyAll" | "forward" = "reply",
) {
  return `${threadUrl(settings, thread, folder)}&reply=${mode}`;
}

/** The newest message in a thread, which is the one worth showing first. */
export function latest(thread: ApiThread): ApiMessage | null {
  if (!thread.messages || thread.messages.length === 0) return null;
  return thread.messages[thread.messages.length - 1] ?? null;
}
