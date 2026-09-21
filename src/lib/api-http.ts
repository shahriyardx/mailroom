import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * One shape for every reply the public API gives, so a client can be written
 * once instead of per endpoint.
 *
 * Errors keep `error` as a plain sentence, which is what the first version of
 * this API returned and what a person reads in a log, and add `code` for the
 * cases a program wants to branch on.
 */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "payload_too_large"
  | "server_error";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 422,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  server_error: 500,
};

export function fail(code: ErrorCode, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, code, ...extra }, { status: STATUS[code] });
}

export function ok<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

/** A page of results. `next_cursor` is opaque: pass it back untouched. */
export function page<T>(data: T[], nextCursor: string | null, extra?: Record<string, unknown>) {
  return NextResponse.json({
    object: "list",
    data,
    has_more: nextCursor !== null,
    next_cursor: nextCursor,
    ...extra,
  });
}

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;

/** `?limit=` clamped to something a single query can answer. */
export function limitOf(url: URL, fallback = DEFAULT_LIMIT) {
  const raw = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}

/** A date query parameter. Anything unparseable is treated as absent. */
export function dateOf(url: URL, name: string) {
  const raw = url.searchParams.get(name);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function boolOf(url: URL, name: string) {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  return raw === "" || raw === "1" || raw.toLowerCase() === "true";
}

/**
 * A cursor is "<sort value>|<id>", which keeps paging stable when many rows
 * share a timestamp. Returned as strings so each caller parses its own sort
 * column.
 */
export function splitCursor(cursor: string | null): [string, string] | null {
  if (!cursor) return null;
  const at = cursor.lastIndexOf("|");
  if (at <= 0) return null;
  return [cursor.slice(0, at), cursor.slice(at + 1)];
}

export function makeCursor(sortValue: Date | number | string, id: string) {
  const left = sortValue instanceof Date ? sortValue.getTime() : sortValue;
  return `${left}|${id}`;
}

/** Bodies bigger than this are refused before they are parsed. */
export const MAX_BODY_BYTES = 30 * 1024 * 1024;

export class BodyError extends Error {
  constructor(
    readonly response: NextResponse,
    message = "bad body",
  ) {
    super(message);
  }
}

/**
 * Reads and validates a JSON body. Throws a {@link BodyError} carrying the
 * reply to send, so a handler can `try`/`catch` once around its real work
 * rather than threading a union type through it.
 */
export async function readBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new BodyError(fail("payload_too_large", "The request body is too large"));
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new BodyError(fail("invalid_request", "The request body is not valid JSON"));
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BodyError(
      fail("invalid_request", parsed.error.issues.map(describeIssue).join(", "), {
        param: first ? first.path.join(".") : undefined,
      }),
    );
  }
  return parsed.data;
}

function describeIssue(issue: z.ZodIssue) {
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Turns an unexpected throw into a reply without leaking its internals. */
export function serverError(context: string, error: unknown) {
  console.error(`api ${context} failed`, error);
  return fail("server_error", "Something went wrong handling this request");
}
