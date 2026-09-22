import { NotificationsPanel } from "@/components/mail/notifications-panel";
import { env } from "@/lib/env";
import { requireAccess } from "@/server/access";
import { browsersFor } from "@/server/push";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const access = await requireAccess();

  // The public key is handed to the browser on purpose: it is the identifier
  // a push service checks a signature against, not a secret.
  return (
    <NotificationsPanel
      publicKey={env.push.configured ? env.push.publicKey : ""}
      browsers={await browsersFor(access.userId)}
    />
  );
}
