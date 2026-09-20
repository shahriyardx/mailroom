"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiKey, Mailbox } from "@/db/schema";
import { createApiKeyAction, deleteApiKeyAction, revokeApiKeyAction } from "@/server/actions";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyNote, Panel, StatusPill } from "./settings-ui";

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
        <div className="mb-3 rounded-xl border border-ok/30 bg-ok/10 p-2.5">
          <p className="mb-1.5 text-[12px]">Copy this key now — it will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border bg-card px-2 py-1.5 font-mono text-[11.5px]">
              {fresh}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              title="Copy key"
              onClick={() => {
                navigator.clipboard.writeText(fresh).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        </div>
      )}

      <div className="divide-y rounded-xl border">
        {keys.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px]">{item.name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{item.prefix}</p>
            </div>

            {item.mailboxId && (
              <StatusPill state="pending">
                {mailboxes.find((box) => box.id === item.mailboxId)?.address ?? "one mailbox"}
              </StatusPill>
            )}
            <StatusPill state={item.revokedAt ? "bad" : "ok"}>
              {item.revokedAt ? "revoked" : "active"}
            </StatusPill>
            <span className="text-[11px] text-muted-foreground">
              {item.lastUsedAt ? `used ${item.lastUsedAt.toLocaleDateString()}` : "never used"}
            </span>

            {!item.revokedAt && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11.5px]"
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
            <button
              type="button"
              aria-label={`Delete ${item.name}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() =>
                start(async () => {
                  await deleteApiKeyAction(item.id);
                  router.refresh();
                })
              }
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {keys.length === 0 && (
          <div className="px-3 py-3">
            <EmptyNote>no keys yet</EmptyNote>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Billing service"
          className="h-8 w-48 text-[12.5px]"
        />
        <Select value={mailboxId} onValueChange={(value) => value && setMailboxId(value)}>
          <SelectTrigger size="sm" className="h-8 min-w-44 font-mono text-[12px]">
            <SelectValue placeholder="any mailbox" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_MAILBOX} className="font-mono text-[12px]">
              any mailbox
            </SelectItem>
            {mailboxes.map((box) => (
              <SelectItem key={box.id} value={box.id} className="font-mono text-[12px]">
                {box.address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8 text-[12px]"
          disabled={pending || !name.trim()}
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
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Create key
        </Button>
      </div>

      <details className="mt-3 rounded-xl border bg-background p-2.5">
        <summary className="cursor-pointer text-[12px]">How to send with it</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg border bg-card p-2.5 font-mono text-[11px] leading-relaxed">
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
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          Check one send with <code className="font-mono">GET /api/v1/emails/&lt;id&gt;</code>, list
          sending domains with <code className="font-mono">GET /api/v1/domains</code>.
        </p>
      </details>
    </Panel>
  );
}
