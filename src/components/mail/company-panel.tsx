"use client";

import { Button, Field, Input, List, ListRow, Panel } from "@/components/kit";
import { useSubmit } from "@/lib/use-submit";
import { renameCompanyAction } from "@/server/team";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  company: { name: string; createdAt: Date };
  /** False for an administrator: the name is the owner's to set. */
  canRename: boolean;
}

/**
 * The name this instance goes by. It belongs beside the rest of the instance
 * rather than under Account, which is about one person's own login: every
 * invitation says the reader is being invited to whatever is written here.
 */
export function CompanyPanel({ company, canRename }: Props) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [sending, submit] = useSubmit();

  function save() {
    submit(async () => {
      const result = await renameCompanyAction(name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Company renamed");
      router.refresh();
    });
  }

  return (
    <Panel
      title="Company"
      description="What this instance calls itself, and what an invitation says someone is being invited to."
    >
      {canRename ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name" htmlFor="company-name" className="max-w-xs flex-1">
            <Input
              id="company-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
              }}
            />
          </Field>
          <Button
            variant="solid"
            pill
            loading={sending}
            disabled={!name.trim() || name.trim() === company.name || sending}
            onClick={save}
          >
            Rename
          </Button>
        </div>
      ) : (
        <List>
          <ListRow>
            <span className="min-w-0 flex-1 text-[13px]">Name</span>
            <span className="text-[13px] text-muted-foreground">{company.name}</span>
          </ListRow>
          <ListRow>
            <span className="min-w-0 flex-1 text-[13px]">Since</span>
            <span className="text-[13px] text-muted-foreground">
              {company.createdAt.toLocaleDateString()}
            </span>
          </ListRow>
        </List>
      )}
    </Panel>
  );
}
