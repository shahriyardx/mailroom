import { getSession } from "@/lib/session";
import { requireAccess } from "@/server/access";
import { needsSetup, workspaceSettings } from "@/server/workspace";
import { redirect } from "next/navigation";

/**
 * Where "/" goes.
 *
 * Not always the inbox: an instance running campaigns alone has no inbox to
 * send anybody to, and landing on an empty one would look broken.
 */
export default async function Home() {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in");

  const access = await requireAccess();
  if (await needsSetup(access.orgId)) redirect("/setup");

  const settings = await workspaceSettings(access.orgId);
  redirect(settings.inboxEnabled ? "/mail/all/inbox" : "/campaigns");
}
