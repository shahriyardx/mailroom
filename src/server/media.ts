import "server-only";

import { db } from "@/db";
import { type Media, media } from "@/db/schema";
import { env } from "@/lib/env";
import { putObject } from "@/lib/r2";
import { newId } from "@/lib/utils";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * The files an account can put in its own mail.
 *
 * Kept deliberately plain: an object in R2, a row saying whose it is, and an
 * address anybody can fetch. No folders, no tags, no versions — a mail
 * account's picture library is a few dozen logos and headers, and every one
 * of those features is a thing to maintain for a list that fits on a screen.
 */

/** What a mail client will be asked to fetch. Absolute, because it is remote. */
export function mediaUrl(id: string) {
  return `${env.appUrl.replace(/\/+$/, "")}/m/${id}`;
}

export const MAX_BYTES = 10 * 1024 * 1024;

/** Only what a mail client will actually draw, and nothing that can run. */
export const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
];

export function isAllowedType(type: string) {
  return ALLOWED_TYPES.includes(type.toLowerCase());
}

export async function listMedia(orgId: string): Promise<Media[]> {
  return db
    .select()
    .from(media)
    .where(eq(media.organizationId, orgId))
    .orderBy(desc(media.createdAt));
}

export async function findMedia(id: string): Promise<Media | null> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row ?? null;
}

export async function storeMedia(input: {
  orgId: string;
  userId?: string | null;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  width?: number | null;
  height?: number | null;
}): Promise<Media> {
  const id = newId("med");
  // The id is in the key as well as the row, so an object is traceable back
  // to what it belongs to without the database being up.
  const key = `media/${input.orgId}/${id}/${safeName(input.filename)}`;

  await putObject(key, input.bytes, input.contentType);

  const [row] = await db
    .insert(media)
    .values({
      id,
      organizationId: input.orgId,
      filename: input.filename.slice(0, 200),
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      r2Key: key,
      width: input.width ?? null,
      height: input.height ?? null,
      uploadedBy: input.userId ?? null,
    })
    .returning();

  return row!;
}

/**
 * Forgets the row and leaves the object.
 *
 * A picture in an email that has already gone out is fetched every time
 * somebody opens that message, which may be years from now. Deleting the
 * object would put a broken image into mail that was correct when it was
 * sent, so this only takes it out of the library.
 */
export async function forgetMedia(orgId: string, id: string) {
  const result = await db
    .delete(media)
    .where(and(eq(media.organizationId, orgId), eq(media.id, id)))
    .returning({ id: media.id });
  return result.length > 0;
}

export async function mediaUsage(orgId: string) {
  const [row] = await db
    .select({
      files: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${media.sizeBytes}), 0)::bigint`,
    })
    .from(media)
    .where(eq(media.organizationId, orgId));

  return { files: row?.files ?? 0, bytes: Number(row?.bytes ?? 0) };
}

/** A key that cannot climb out of its own folder. */
function safeName(filename: string) {
  return (
    filename
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^[.-]+/, "")
      .slice(0, 80) || "file"
  );
}
