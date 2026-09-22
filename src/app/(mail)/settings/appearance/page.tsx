import { AppearancePanel } from "@/components/mail/appearance-panel";
import { requireAccess } from "@/server/access";
import { getAppearance } from "@/server/preferences";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const access = await requireAccess();
  return <AppearancePanel initial={await getAppearance(access.userId)} />;
}
