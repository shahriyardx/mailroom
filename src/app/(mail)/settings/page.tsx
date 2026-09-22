import { requireAccess } from "@/server/access";
import { settingsLanding } from "@/server/settings-landing";
import { redirect } from "next/navigation";

export default async function SettingsIndex() {
  const access = await requireAccess();
  redirect(await settingsLanding(access));
}
