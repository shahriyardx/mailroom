import { ForwardingPanel } from "@/components/mail/forwarding-panel";
import { forwardingProblem, forwardingView, refreshForwardingAddresses } from "@/server/forwarding";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function ForwardingSettingsPage() {
  const access = await requireCapability("inbound:manage");

  // Nobody tells us when somebody clicks the link in their verification mail,
  // so the page asks Cloudflare on the way in. A failure is not worth a blank
  // page: the rules still render, with whatever state was last known, and the
  // reason is handed to the panel so it can say what to do about it — a token
  // without the address permission is the expected way to arrive here, since
  // receiving does not need that permission and the token is made for
  // receiving first.
  const problem = await refreshForwardingAddresses(access.orgId).then(
    () => null,
    (error: unknown) => forwardingProblem(error),
  );

  const view = await forwardingView(access.orgId);
  return <ForwardingPanel view={view} problem={problem} />;
}
