"use client";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Panel } from "./settings-ui";

interface Props {
  name: string;
  email: string;
  createdAt: Date;
  mailboxCount: number;
  domainCount: number;
}

export function AccountPanel({ name, email, createdAt, mailboxCount, domainCount }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Panel title="Account" description="The login this mail app is tied to.">
      <dl className="divide-y rounded-xl border text-[12.5px]">
        <Row label="name" value={name} />
        <Row label="email" value={email} mono />
        <Row label="joined" value={createdAt.toLocaleDateString()} />
        <Row label="mailboxes" value={String(mailboxCount)} />
        <Row label="domains" value={String(domainCount)} />
      </dl>

      <div className="mt-3">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await authClient.signOut();
            router.push("/sign-in");
            router.refresh();
          }}
        >
          <LogOut className="size-3.5" />
          Sign out
        </Button>
      </div>
    </Panel>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <dt className="w-24 shrink-0 font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.1em]">
        {label}
      </dt>
      <dd className={mono ? "min-w-0 truncate font-mono" : "min-w-0 truncate"}>{value}</dd>
    </div>
  );
}
