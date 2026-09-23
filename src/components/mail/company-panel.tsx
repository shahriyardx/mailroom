"use client";

import { Button, Field, Input, List, ListRow, Note, Panel, Textarea } from "@/components/kit";
import { useSubmit } from "@/lib/use-submit";
import { setWorkspaceBrandAction } from "@/server/actions";
import { renameCompanyAction } from "@/server/team";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  company: { name: string; createdAt: Date };
  /** False for an administrator: the name is the owner's to set. */
  canRename: boolean;
  /** Where the company is, printed at the foot of every campaign. */
  postalAddress: string | null;
}

/**
 * The name this instance goes by. It belongs beside the rest of the instance
 * rather than under Account, which is about one person's own login: every
 * invitation says the reader is being invited to whatever is written here.
 */
export function CompanyPanel({ company, canRename, postalAddress }: Props) {
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

      {canRename && <PostalAddress value={postalAddress} />}
    </Panel>
  );
}

/**
 * The address the law asks bulk email to carry.
 *
 * Here rather than on a campaigns screen because it is a fact about the
 * company, not about one send — and because an instance that never sends a
 * campaign should still be able to fill it in without going looking.
 */
function PostalAddress({ value }: { value: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(value ?? "");
  const [sending, submit] = useSubmit();

  const changed = text.trim() !== (value ?? "").trim();

  function save() {
    submit(async () => {
      const result = await setWorkspaceBrandAction({ postalAddress: text.trim() || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Address saved");
      router.refresh();
    });
  }

  return (
    <div className="mt-6 border-border border-t pt-5">
      <Field label="Postal address" htmlFor="postal-address" className="max-w-md">
        <Textarea
          id="postal-address"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"Acme Ltd\n12 Example Street\nLondon EC1A 1AA"}
        />
      </Field>

      <Note className="mt-2 max-w-md">
        Printed at the foot of every campaign and every automation. US CAN-SPAM requires a valid
        physical address in commercial email, and Gmail's bulk sender rules look for one. Leave it
        empty and sends still work — the campaign screens will keep saying so.
      </Note>

      <Button
        variant="outline"
        pill
        className="mt-3"
        loading={sending}
        disabled={!changed || sending}
        onClick={save}
      >
        Save address
      </Button>
    </div>
  );
}
