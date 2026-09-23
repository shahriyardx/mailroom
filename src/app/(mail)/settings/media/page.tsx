import { MediaPanel } from "@/components/mail/media-panel";
import { listMedia, mediaUrl } from "@/server/media";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const access = await requireCapability("rules:manage");
  const rows = await listMedia(access.orgId);

  return (
    <MediaPanel
      media={rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt,
        url: mediaUrl(row.id),
      }))}
    />
  );
}
