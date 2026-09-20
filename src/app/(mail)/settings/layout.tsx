import { SettingsShell } from "@/components/mail/settings-shell";
import { requireUser } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <SettingsShell user={{ name: user.name ?? user.email, email: user.email }}>
      {children}
    </SettingsShell>
  );
}
