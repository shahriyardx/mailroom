/**
 * Enough of `next/server` for the server modules to load outside Next.
 *
 * The helpers in `@/lib/api-http` build replies with `NextResponse.json`, and
 * a module that imports one of them drags the whole framework in. What those
 * helpers actually need is a JSON Response with a status and some headers,
 * which the platform has had for years.
 */
export const NextResponse = {
  json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    return new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  },
};

export type NextRequest = Request;
