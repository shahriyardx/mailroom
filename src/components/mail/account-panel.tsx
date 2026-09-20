"use client";

import { Button, List, ListRow, Panel } from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <Panel title="Signed in as" description="The login this mail app is tied to.">
      <List>
        <Row label="Name" value={name} />
        <Row label="Email" value={email} mono />
        <Row label="Joined" value={createdAt.toLocaleDateString()} />
        <Row label="Mailboxes" value={String(mailboxCount)} />
        <Row label="Domains" value={String(domainCount)} />
      </List>

      <div className="mt-4">
        <Button
          variant="outline"
          pill
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await authClient.signOut();
            router.push("/sign-in");
            router.refresh();
          }}
        >
          <LogOut />
          Sign out
        </Button>
      </div>
    </Panel>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <ListRow>
      <span className="w-24 shrink-0 text-[12.5px] text-muted-foreground">{label}</span>
      <span
        className={mono ? "min-w-0 truncate font-mono text-[13px]" : "min-w-0 truncate text-[13px]"}
      >
        {value}
      </span>
    </ListRow>
  );
}
