"use client";

import { Note, Panel, Switch } from "@/components/kit";
import { setWorkspaceFeaturesAction } from "@/server/actions";
import type { WorkspaceSettings } from "@/server/workspace";
import { Inbox, Megaphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

/**
 * Which halves of the product this instance shows.
 *
 * Two things share this codebase and they are not the same job: a team
 * reading its mail, and a list being sent a broadcast. Rather than shipping
 * two builds, an instance says which it is here and the navigation follows.
 *
 * Turning one off hides its screens. It does not delete anything — a
 * campaigns instance that switches Inbox back on finds its mailboxes where it
 * left them, which is what makes this safe to try.
 */
export function FeaturesPanel({ settings }: { settings: WorkspaceSettings }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  function set(patch: { inboxEnabled?: boolean; campaignsEnabled?: boolean }, done: string) {
    startTransition(async () => {
      const result = await setWorkspaceFeaturesAction(patch);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Features"
      description="What this instance is for. Both can be on — a company with team mailboxes and a newsletter needs one instance, not two."
    >
      <div className="space-y-2.5">
        <FeatureRow
          icon={<Inbox />}
          title="Inbox"
          detail="Mailboxes, conversations, filters, labels, forwarding and the browser extension."
          on={settings.inboxEnabled}
          disabled={busy}
          onChange={(on) =>
            set({ inboxEnabled: on }, on ? "Inbox switched on" : "Inbox switched off")
          }
        />
        <FeatureRow
          icon={<Megaphone />}
          title="Campaigns"
          detail="Lists, broadcasts to many people at once, unsubscribe handling and open tracking."
          on={settings.campaignsEnabled}
          disabled={busy}
          onChange={(on) =>
            set({ campaignsEnabled: on }, on ? "Campaigns switched on" : "Campaigns switched off")
          }
        />
      </div>

      <Note className="mt-3">
        Switching one off only hides its screens. Nothing is deleted, so turning it back on finds
        everything where you left it. One of the two has to stay on.
      </Note>
    </Panel>
  );
}

function FeatureRow({
  icon,
  title,
  detail,
  on,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <Switch
        checked={on}
        disabled={disabled}
        aria-label={`${title} ${on ? "on" : "off"}`}
        onCheckedChange={onChange}
      />
    </div>
  );
}
