import data from "emojibase-data/en/data.json";
import messages from "emojibase-data/en/messages.json";

/**
 * The emoji list the builder's picker reads, served from here.
 *
 * The picker fetches it from a CDN unless told otherwise, and a self-hosted
 * instance may have no way out to one. It is bundled at build time, so it
 * changes only when the app does and can be cached for good.
 */
const FILES: Record<string, unknown> = { "data.json": data, "messages.json": messages };

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(FILES).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const body = FILES[file];
  if (!body) return new Response("Not found", { status: 404 });
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
