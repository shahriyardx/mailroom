"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Domain } from "@/db/schema";
import { type DnsRecord, relativeName } from "@/lib/ses";
import { cn } from "@/lib/utils";
import {
  addDomainAction,
  importDomainsAction,
  refreshDomainAction,
  removeDomainAction,
  useOwnDkimKeyAction,
} from "@/server/actions";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  DownloadCloud,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyNote, Panel, StatusPill } from "./settings-ui";

export interface DomainRow extends Domain {
  records: DnsRecord[];
}

interface Props {
  domains: DomainRow[];
  account: {
    productionAccess: boolean;
    enforcementStatus: string;
    max24Hour: number;
    sentLast24Hours: number;
    maxSendRate: number;
  } | null;
  syncError?: string;
}

export function DomainPanel({ domains, account, syncError }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  function importNow() {
    setNote(null);
    start(async () => {
      const result = await importDomainsAction();
      setNote(
        result.ok
          ? {
              tone: "ok",
              text: `${result.imported} imported, ${result.updated} refreshed, ${result.total} found in SES.`,
            }
          : { tone: "bad", text: result.error },
      );
      router.refresh();
    });
  }

  function add() {
    setNote(null);
    start(async () => {
      const result = await addDomainAction(name);
      if (result.ok) {
        setName("");
        setNote({
          tone: "ok",
          text: `${result.name} added. Add the DNS records below at your DNS host.`,
        });
      } else {
        setNote({ tone: "bad", text: result.error });
      }
      router.refresh();
    });
  }

  return (
    <Panel
      title="Domains"
      description="Sending identities in Amazon SES. Import what is already verified, or add a new one."
      meta={`${domains.length}`}
      action={
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 text-[12px]"
          onClick={importNow}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <DownloadCloud className="size-3.5" />
          )}
          Import from SES
        </Button>
      }
    >
      {account && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-background px-2.5 py-1.5">
          <StatusPill state={account.productionAccess ? "ok" : "pending"}>
            {account.productionAccess ? "production" : "sandbox"}
          </StatusPill>
          <StatusPill state={account.enforcementStatus === "HEALTHY" ? "ok" : "bad"}>
            {account.enforcementStatus.toLowerCase()}
          </StatusPill>
          <span className="font-mono text-[11px] text-muted-foreground">
            {account.sentLast24Hours.toLocaleString()}/{account.max24Hour.toLocaleString()} per 24h
            · {account.maxSendRate}/sec
          </span>
        </div>
      )}

      {syncError && (
        <p className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          SES could not be reached: {syncError}
        </p>
      )}

      <div className="divide-y rounded-xl border">
        {domains.map((row) => (
          <DomainRowItem key={row.id} row={row} />
        ))}
        {domains.length === 0 && (
          <div className="px-3 py-3">
            <EmptyNote>none yet — press import from ses</EmptyNote>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="acme.com"
          className="h-8 w-56 font-mono text-[12.5px]"
        />
        <Button
          size="sm"
          className="h-8 text-[12px]"
          onClick={add}
          disabled={pending || !name.trim()}
        >
          Add domain
        </Button>
        <span className="text-[11.5px] text-muted-foreground">
          Creates the identity with Easy DKIM and a custom return path.
        </span>
      </div>

      {note && (
        <p className={cn("mt-2 text-[12px]", note.tone === "ok" ? "text-ok" : "text-destructive")}>
          {note.text}
        </p>
      )}
    </Panel>
  );
}

function DomainRowItem({ row }: { row: DomainRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(row.status !== "verified");

  const verified = row.status === "verified" && row.sendingEnabled;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Hide DNS records" : "Show DNS records"}
        >
          <ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12.5px]">{row.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {row.region}
            {row.importedAt && " · imported"}
            {row.lastCheckedAt && ` · checked ${row.lastCheckedAt.toLocaleTimeString()}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <StatusPill state={verified ? "ok" : row.status === "failed" ? "bad" : "pending"}>
            {verified && <Check className="size-2.5" />}
            {verified ? "verified" : row.status}
          </StatusPill>
          <StatusPill state={row.dkimStatus === "verified" ? "ok" : "pending"}>dkim</StatusPill>
          {row.mailFromDomain && (
            <StatusPill state={row.mailFromStatus === "verified" ? "ok" : "pending"}>
              mail-from
            </StatusPill>
          )}
          <StatusPill state={row.spfVerified ? "ok" : "pending"}>spf</StatusPill>
          <StatusPill state={row.dmarcVerified ? "ok" : "pending"}>dmarc</StatusPill>
        </div>

        {row.dkimOrigin !== "EXTERNAL" && row.dkimTokens.length > 1 && (
          <button
            type="button"
            title="Replace the three DKIM CNAMEs with one TXT record"
            className="whitespace-nowrap rounded-lg border px-1.5 py-1 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() =>
              start(async () => {
                await useOwnDkimKeyAction(row.id);
                router.refresh();
              })
            }
          >
            Use one TXT record
          </button>
        )}

        <button
          type="button"
          title="Check status now"
          className="text-muted-foreground hover:text-foreground"
          onClick={() =>
            start(async () => {
              await refreshDomainAction(row.id);
              router.refresh();
            })
          }
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </button>

        <button
          type="button"
          title="Remove domain"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => {
            const alsoSes = window.confirm(
              `Remove ${row.name} from this app?\n\nOK = also delete the identity in SES.\nCancel = remove it here only.`,
            );
            start(async () => {
              await removeDomainAction(row.id, alsoSes);
              router.refresh();
            });
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="border-t bg-background px-3 py-2.5">
          <p className="mb-2 text-[11.5px] text-muted-foreground">
            Add these at your DNS host. Click any value to copy it. SES usually verifies minutes
            after the CNAMEs go live.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-[11.5px]">
              <thead>
                <tr className="font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.1em]">
                  <th className="w-12 py-1 pr-2 font-normal">type</th>
                  <th className="py-1 pr-4 font-normal">name</th>
                  <th className="py-1 pr-4 font-normal">value</th>
                  <th className="w-10 py-1 pr-3 text-right font-normal">prio</th>
                  <th className="w-36 py-1 font-normal">purpose</th>
                </tr>
              </thead>
              <tbody>
                {row.records.map((record) => (
                  <tr
                    key={`${record.kind}-${record.name}-${record.value}`}
                    className="border-t align-top"
                  >
                    <td className="w-12 py-1.5 pr-2 font-mono text-muted-foreground">
                      {record.kind}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-4">
                      <CopyCell value={relativeName(record.name, row.name)} copy={record.name} />
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-4">
                      {record.informational ? (
                        <span className="px-1 py-0.5 text-muted-foreground italic">
                          {record.value}
                        </span>
                      ) : (
                        <CopyCell value={record.value} />
                      )}
                    </td>
                    <td className="w-10 py-1.5 pr-3 text-right font-mono text-muted-foreground">
                      {record.priority ?? "—"}
                    </td>
                    <td className="w-36 whitespace-nowrap py-1.5 text-muted-foreground">
                      {record.purpose}
                      {!record.required && (
                        <span className="text-muted-foreground/60"> (optional)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shows one value and copies it on click. `copy` overrides what lands on the
 * clipboard, so a name can display as "mail" but copy as the full hostname for
 * DNS hosts that want it written out.
 */
function CopyCell({ value, copy }: { value: string; copy?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${copy ?? value}`}
      onClick={() => {
        navigator.clipboard.writeText(copy ?? value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left font-mono hover:bg-accent"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-ok" />
      ) : (
        <Copy className="size-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      )}
    </button>
  );
}
