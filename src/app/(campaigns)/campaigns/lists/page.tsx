import { ListsPanel } from "@/components/mail/lists-panel";
import { listsView, membersView } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function ListsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const access = await requireCapability("rules:manage");
  const { list } = await searchParams;

  const lists = await listsView(access.orgId);
  // The one asked for, or the first, so the screen is never half empty.
  const selected = lists.find((entry) => entry.id === list) ?? lists[0] ?? null;
  const members = selected ? await membersView(access.orgId, selected.id) : [];

  return <ListsPanel lists={lists} selected={selected} members={members} />;
}
