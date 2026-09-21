import { getAccess } from "@/server/access";
import { type MailEvent, subscribe } from "@/server/realtime";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Long enough to sit under any proxy's idle timeout, short enough to hold it open. */
const HEARTBEAT_MS = 25_000;

/**
 * A stream of this account's mail events. The browser keeps one open and
 * re-renders when something arrives, so nothing is polled and nothing is
 * reloaded.
 */
export async function GET(request: NextRequest) {
  const access = await getAccess();
  if (!access) return new Response("Unauthorized", { status: 401 });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };

      // Tell the browser how long to wait before reconnecting, and prove the
      // stream works before anything has happened.
      send("retry: 3000\n\n");
      send(": connected\n\n");

      const unsubscribe = await subscribe(access.orgId, (event: MailEvent) => {
        send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // A comment keeps the connection alive through proxies that cut an idle
      // one, and is ignored by EventSource.
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers by default, which would hold every event back.
      "X-Accel-Buffering": "no",
    },
  });
}
