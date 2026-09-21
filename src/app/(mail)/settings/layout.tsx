import { SettingsShell } from "@/components/mail/settings-shell";
import { requireAccess } from "@/server/access";
import { CAPABILITIES, can } from "@/server/permissions";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  const allowed = Object.keys(CAPABILITIES).filter((capability) =>
    can(access, capability as keyof typeof CAPABILITIES),
  );

  return (
    <SettingsShell
      user={{ name: access.name ?? access.email, email: access.email }}
      allowed={allowed}
    >
      {children}
    </SettingsShell>
  );
}
