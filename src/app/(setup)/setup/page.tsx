import { SetupWizard } from "@/components/mail/setup-wizard";
import { requireAccess } from "@/server/access";
import { can } from "@/server/permissions";
import { setupState } from "@/server/setup";
import { needsSetup } from "@/server/workspace";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const access = await requireAccess();

  // Already done. Somebody who typed the URL should land where they meant to
  // go, not be walked through a set-up they finished months ago.
  if (!(await needsSetup(access.orgId))) redirect("/mail");

  /*
   * Only the owner can answer these. A member who signs in first while the
   * owner is still setting up would otherwise be asked what the company's
   * email is for, and their answer would stick.
   */
  if (!can(access, "instance:manage")) {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-[20px] font-semibold tracking-[-0.02em]">
            Nearly ready
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            The owner of this instance is still setting it up. You will be able to sign in as soon
            as they have finished.
          </p>
        </div>
      </main>
    );
  }

  const state = await setupState(access.orgId);
  return <SetupWizard state={state} />;
}
