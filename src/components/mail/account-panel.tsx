"use client";

import { Button, Field, Input, List, ListRow, Panel } from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import { renameCompanyAction } from "@/server/team";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface Props {
  company: { name: string; createdAt: Date } | null;
  canRename: boolean;
  name: string;
  role: string;
  email: string;
  createdAt: Date;
  mailboxCount: number;
  domainCount: number;
}

export function AccountPanel({
  company,
  canRename,
  name,
  role,
  email,
  createdAt,
  mailboxCount,
  domainCount,
}: Props) {
  const [companyName, setCompanyName] = useState(company?.name ?? "");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, start] = useTransition();

  return (
    <>
      {company && (
        <Panel
          title="Company"
          description="The name this instance goes by. It is what an invitation says someone is being invited to."
        >
          {canRename ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Name" htmlFor="company-name" className="max-w-xs flex-1">
                <Input
                  id="company-name"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                />
              </Field>
              <Button
                variant="solid"
                pill
                disabled={!companyName.trim() || companyName.trim() === company.name}
                onClick={() =>
                  start(async () => {
                    const result = await renameCompanyAction(companyName);
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success("Company renamed");
                    router.refresh();
                  })
                }
              >
                Rename
              </Button>
            </div>
          ) : (
            <List>
              <Row label="Name" value={company.name} />
              <Row label="Since" value={company.createdAt.toLocaleDateString()} />
            </List>
          )}
        </Panel>
      )}

      <Panel title="Signed in as" description="The login this mail app is tied to.">
        <List>
          <Row label="Name" value={name} />
          <Row label="Email" value={email} mono />
          <Row label="Role" value={role} />
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
    </>
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
