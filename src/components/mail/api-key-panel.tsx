"use client";

import {
  BlankSlate,
  Button,
  Field,
  Fieldset,
  FieldsetActions,
  IconButton,
  Input,
  List,
  ListRow,
  Note,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
} from "@/components/kit";
import type { ApiKey, Mailbox } from "@/db/schema";
import { createApiKeyAction, deleteApiKeyAction, revokeApiKeyAction } from "@/server/actions";
import { Check, ChevronRight, Copy, KeyRound, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

const ANY_MAILBOX = "__any__";

interface Props {
  keys: ApiKey[];
  mailboxes: Mailbox[];
  appUrl: string;
}

export function ApiKeyPanel({ keys, mailboxes, appUrl }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [mailboxId, setMailboxId] = useState(ANY_MAILBOX);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <Panel
      title="Your keys"
      description="Send from your own code. A key is either locked to one mailbox, or free to send as any address on a verified domain."
      meta={`${keys.filter((item) => !item.revokedAt).length} active`}
    >
      {fresh && (
        <div className="mb-4 rounded-xl bg-ok-soft p-3.5">
          <p className="mb-2 text-[12.5px] font-medium text-ok">
            Copy this key now. It is stored hashed and will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-2.5 py-2 font-mono text-[12px]">
              {fresh}
            </code>
            <IconButton
              size="md"
              variant="outline"
              label="Copy key"
              onClick={() => {
                navigator.clipboard.writeText(fresh).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                    toast.success("API key copied", {
                      description: "It will not be shown again.",
                    });
                  },
                  () => toast.error("Could not copy. Select the key and copy it by hand."),
                );
              }}
            >
              {copied ? <Check className="text-ok" /> : <Copy />}
            </IconButton>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <BlankSlate
          icon={<KeyRound />}
          title="No keys yet"
          hint="Make one below to send mail from a script, a server, or anything else outside this screen."
        />
      ) : (
        <>
          <div className="flex items-center gap-3 border-border border-b pb-1.5 text-[11.5px] text-muted-foreground">
            <span className="min-w-0 flex-1">Key</span>
            <span className="w-44 shrink-0">Can send from</span>
            <span className="w-24 shrink-0">Last used</span>
            <span className="w-[4.5rem] shrink-0" />
          </div>
          <List>
            {keys.map((item) => (
              <ListRow key={item.id}>
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[13px] font-medium">
                    {item.name}
                    {item.revokedAt && <StatusPill state="bad">Revoked</StatusPill>}
                  </p>
                  <p className="truncate font-mono text-[12px] text-muted-foreground">
                    {item.prefix}
                  </p>
                </div>

                <span className="w-44 shrink-0 truncate font-mono text-[12px] text-muted-foreground">
                  {item.mailboxId
                    ? (mailboxes.find((box) => box.id === item.mailboxId)?.address ?? "One mailbox")
                    : "Any address"}
                </span>
                <span className="w-24 shrink-0 text-[12px] text-muted-foreground">
                  {item.lastUsedAt ? item.lastUsedAt.toLocaleDateString() : "Never"}
                </span>

                {/* The slot is the same width whether or not a key can still
                    be revoked, so the bins stay in one column. */}
                <span className="flex w-[4.5rem] shrink-0 items-center justify-end gap-1">
                  {!item.revokedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      pill
                      onClick={() =>
                        start(async () => {
                          await revokeApiKeyAction(item.id);
                          router.refresh();
                        })
                      }
                    >
                      Revoke
                    </Button>
                  )}
                  <IconButton
                    variant="danger"
                    label={`Delete ${item.name}`}
                    onClick={() =>
                      start(async () => {
                        await deleteApiKeyAction(item.id);
                        router.refresh();
                      })
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </span>
              </ListRow>
            ))}
          </List>
        </>
      )}

      <Fieldset title="Create a key">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="key-name">
            <Input
              id="key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Billing service"
            />
          </Field>
          <Field
            label="Can send from"
            htmlFor="key-mailbox"
            hint={
              mailboxId === ANY_MAILBOX
                ? "Any address on a verified domain, even one that does not exist yet."
                : "Only this address."
            }
          >
            <Select value={mailboxId} onValueChange={(value) => value && setMailboxId(value)}>
              <SelectTrigger id="key-mailbox" className="font-mono text-[12.5px]">
                <SelectValue placeholder="Any mailbox" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_MAILBOX}>Any mailbox</SelectItem>
                {mailboxes.map((box) => (
                  <SelectItem key={box.id} value={box.id} className="font-mono">
                    {box.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <FieldsetActions note="The key is shown once. Store it somewhere safe.">
          <Button
            variant="solid"
            pill
            loading={pending}
            disabled={!name.trim()}
            onClick={() =>
              start(async () => {
                const result = await createApiKeyAction(
                  name.trim(),
                  mailboxId === ANY_MAILBOX ? undefined : mailboxId,
                );
                setFresh(result.token);
                setName("");
                router.refresh();
              })
            }
          >
            Create key
          </Button>
        </FieldsetActions>
      </Fieldset>

      <details className="group mt-5 border-t border-border pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
          How to send with it
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-muted p-3.5 font-mono text-[11.5px] leading-relaxed">
          {`curl -X POST ${appUrl}/api/v1/emails \\
  -H "Authorization: Bearer mk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "${mailboxes[0]?.address ?? "hello@acme.com"}",
    "to": ["someone@example.com"],
    "subject": "Hello",
    "html": "<p>Sent through SES</p>"
  }'`}
        </pre>
        <Note className="mt-2">
          Check one send with <code className="font-mono">GET /api/v1/emails/&lt;id&gt;</code>, list
          sending domains with <code className="font-mono">GET /api/v1/domains</code>.
        </Note>
      </details>
    </Panel>
  );
}
