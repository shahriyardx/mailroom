"use client";

import {
  Button,
  Field,
  Fieldset,
  IconButton,
  Input,
  List,
  ListEmpty,
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
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
      title="API keys"
      description="Send from your own code. Keys are stored hashed, so a key is shown once and never again."
      meta={`${keys.filter((item) => !item.revokedAt).length} active`}
    >
      {fresh && (
        <div className="mb-4 rounded-xl bg-ok-soft p-3">
          <p className="mb-2 text-[12.5px] font-medium text-ok">
            Copy this key now. It is stored hashed and will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-card px-2.5 py-2 font-mono text-[12px]">
              {fresh}
            </code>
            <IconButton
              size="md"
              variant="outline"
              label="Copy key"
              onClick={() => {
                navigator.clipboard.writeText(fresh).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check className="text-ok" /> : <Copy />}
            </IconButton>
          </div>
        </div>
      )}

      <List>
        {keys.map((item) => (
          <ListRow key={item.id} className="flex-wrap">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{item.name}</p>
              <p className="truncate font-mono text-[12px] text-muted-foreground">{item.prefix}</p>
            </div>

            {item.mailboxId && (
              <StatusPill state="pending">
                {mailboxes.find((box) => box.id === item.mailboxId)?.address ?? "One mailbox"}
              </StatusPill>
            )}
            <StatusPill state={item.revokedAt ? "bad" : "ok"}>
              {item.revokedAt ? "Revoked" : "Active"}
            </StatusPill>
            <span className="text-[12px] text-muted-foreground">
              {item.lastUsedAt ? `Used ${item.lastUsedAt.toLocaleDateString()}` : "Never used"}
            </span>

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
          </ListRow>
        ))}
        {keys.length === 0 && <ListEmpty>No keys yet.</ListEmpty>}
      </List>

      <Fieldset title="Create a key">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Name" htmlFor="key-name" className="w-52">
            <Input
              id="key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Billing service"
            />
          </Field>
          <Field label="Can send from" htmlFor="key-mailbox" className="w-56">
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
          <Button
            variant="solid"
            pill
            className="ml-auto"
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
        </div>
      </Fieldset>

      <details className="mt-4 rounded-xl border border-border bg-muted/40 p-3.5">
        <summary className="cursor-pointer text-[13px] font-medium">How to send with it</summary>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px] leading-relaxed">
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
