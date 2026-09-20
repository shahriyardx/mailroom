"use client";

import {
  Button,
  Field,
  Fieldset,
  Hint,
  IconButton,
  Input,
  InputGroup,
  List,
  ListEmpty,
  ListRow,
  Note,
  Panel,
  StatusPill,
  Switch,
} from "@/components/kit";
import type { Domain } from "@/db/schema";
import { type DnsRecord, relativeName } from "@/lib/ses";
import { cn } from "@/lib/utils";
import {
  addDomainAction,
  importDomainsAction,
  refreshDomainAction,
  removeDomainAction,
  setDomainAutoCreateAction,
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
      title="Sending identities"
      description="Sending identities in Amazon SES. Import what is already verified, or add a new one."
      action={
        <Button variant="outline" pill onClick={importNow} loading={pending}>
          {!pending && <DownloadCloud />}
          Import from SES
        </Button>
      }
    >
      {account && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
          <StatusPill state={account.productionAccess ? "ok" : "pending"}>
            {account.productionAccess ? "Production access" : "Sandbox"}
          </StatusPill>
          <StatusPill state={account.enforcementStatus === "HEALTHY" ? "ok" : "bad"}>
            {account.enforcementStatus === "HEALTHY" ? "Healthy" : account.enforcementStatus}
          </StatusPill>
          <span className="text-[12px] text-muted-foreground">
            <span className="font-mono">{account.sentLast24Hours.toLocaleString()}</span> of{" "}
            <span className="font-mono">{account.max24Hour.toLocaleString()}</span> sent in 24
            hours, up to <span className="font-mono">{account.maxSendRate}</span> a second
          </span>
        </div>
      )}

      {syncError && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[12.5px] text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          SES could not be reached: {syncError}
        </p>
      )}

      <List>
        {domains.map((row) => (
          <DomainRowItem key={row.id} row={row} />
        ))}
        {domains.length === 0 && (
          <ListEmpty>No domains yet. Import the ones already verified in SES.</ListEmpty>
        )}
      </List>

      <Fieldset title="Add a domain">
        <Field
          label="Domain"
          htmlFor="domain-name"
          hint="A subdomain of a domain you have already verified is added with no records to publish. Anything else creates an SES identity with its own DKIM and return path."
          className="max-w-md"
        >
          <InputGroup>
            <Input
              id="domain-name"
              mono
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="acme.com"
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) add();
              }}
            />
            <Button variant="solid" pill onClick={add} loading={pending} disabled={!name.trim()}>
              Add domain
            </Button>
          </InputGroup>
        </Field>
      </Fieldset>

      {note && (
        <p
          className={cn("mt-3 text-[12.5px]", note.tone === "ok" ? "text-ok" : "text-destructive")}
        >
          {note.text}
        </p>
      )}
    </Panel>
  );
}

const LABELS: Record<string, string> = {
  dkim: "DKIM",
  "mail-from": "Return path",
  spf: "SPF",
  dmarc: "DMARC",
};

/** The individual things SES and DNS have to agree on before a domain works. */
function checksFor(row: DomainRow) {
  if (row.inheritedFrom) return [];
  return [
    { key: "dkim", ok: row.dkimStatus === "verified", required: true },
    ...(row.mailFromDomain
      ? [{ key: "mail-from", ok: row.mailFromStatus === "verified", required: true }]
      : []),
    { key: "spf", ok: row.spfVerified, required: false },
    { key: "dmarc", ok: row.dmarcVerified, required: false },
  ];
}

function DomainRowItem({ row }: { row: DomainRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const verified = row.status === "verified" && row.sendingEnabled;
  const checks = checksFor(row);
  const blocking = checks.filter((check) => check.required && !check.ok);

  // Only something that actually stops mail is worth opening a row for, and an
  // inherited subdomain has nothing to show at all.
  const [open, setOpen] = useState(!row.inheritedFrom && (!verified || blocking.length > 0));

  return (
    <div>
      <ListRow className="gap-2.5">
        {row.inheritedFrom ? (
          <span className="size-6 shrink-0" aria-hidden />
        ) : (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="-ml-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={open ? "Hide DNS records" : "Show DNS records"}
          >
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px]">{row.name}</p>
          <p
            className="truncate text-[12px] text-muted-foreground"
            title={
              row.lastCheckedAt ? `Last checked ${row.lastCheckedAt.toLocaleString()}` : undefined
            }
          >
            {row.inheritedFrom ? `Covered by ${row.inheritedFrom}` : row.region}
            {!row.inheritedFrom && row.importedAt && " · imported"}
          </p>
        </div>

        {/* One pill when a domain is done. The outstanding items only, when it
            is not. Repeating five green chips per row says nothing. */}
        {row.inheritedFrom ? (
          <StatusPill state="ok">
            <Check />
            No setup needed
          </StatusPill>
        ) : verified && blocking.length === 0 ? (
          <StatusPill state="ok">
            <Check />
            Ready
          </StatusPill>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {!verified && (
              <StatusPill state={row.status === "failed" ? "bad" : "pending"}>
                {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
              </StatusPill>
            )}
            {blocking.length > 0 && (
              <StatusPill state="pending">
                {blocking.map((check) => LABELS[check.key] ?? check.key).join(" and ")} pending
              </StatusPill>
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          {/* There is no identity to poll: it stands or falls with its parent. */}
          {!row.inheritedFrom && (
            <Hint label="Check status now">
              <IconButton
                label="Check status now"
                onClick={() =>
                  start(async () => {
                    await refreshDomainAction(row.id);
                    router.refresh();
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              </IconButton>
            </Hint>
          )}

          <Hint label="Remove domain">
            <IconButton
              variant="danger"
              label="Remove domain"
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
              <Trash2 />
            </IconButton>
          </Hint>
        </div>
      </ListRow>

      {open && !row.inheritedFrom && (
        <div className="border-t border-border py-3.5">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {checks.map((check) => (
                <li
                  key={check.key}
                  className={cn(
                    "flex items-center gap-1.5 text-[12px]",
                    check.ok ? "text-ok" : "text-muted-foreground",
                  )}
                >
                  {check.ok ? (
                    <Check className="size-3.5" />
                  ) : (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        check.required ? "bg-warn" : "bg-muted-foreground/45",
                      )}
                    />
                  )}
                  {LABELS[check.key] ?? check.key}
                  {!check.required && !check.ok && (
                    <span className="text-muted-foreground/70">optional</span>
                  )}
                </li>
              ))}
            </ul>

            {row.dkimOrigin !== "EXTERNAL" && row.dkimTokens.length > 1 && (
              <button
                type="button"
                title="Replace the three DKIM CNAMEs with one TXT record"
                className="ml-auto whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
          </div>

          {/* Receiving behaviour for this domain, beside the records that make
              receiving work at all. */}
          <div className="mb-3 flex items-start gap-3 border-b border-border pb-3">
            <Switch
              id={`auto-${row.id}`}
              checked={row.autoCreateMailboxes}
              onCheckedChange={(on) =>
                start(async () => {
                  await setDomainAutoCreateAction(row.id, on === true);
                  router.refresh();
                })
              }
              className="mt-0.5"
            />
            <label htmlFor={`auto-${row.id}`} className="min-w-0 cursor-pointer">
              <span className="block text-[12.5px] font-medium">Capture every address</span>
              <span className="block text-[12px] leading-relaxed text-muted-foreground">
                Mail to any address on {row.name} that no mailbox claims creates that mailbox and is
                kept here. With this off it is forwarded on instead, and nothing is stored.
              </span>
            </label>
          </div>

          <Note className="mb-2">Add these at your DNS host. Click any value to copy it.</Note>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead>
                <tr className="text-[11.5px] text-muted-foreground">
                  <th className="w-12 py-1 pr-2 font-medium">Type</th>
                  <th className="py-1 pr-4 font-medium">Name</th>
                  <th className="py-1 pr-4 font-medium">Value</th>
                  <th className="w-12 py-1 pr-3 text-right font-medium">Priority</th>
                  <th className="w-36 py-1 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {row.records.map((record) => (
                  <tr
                    key={`${record.kind}-${record.name}-${record.value}`}
                    className="border-t border-border align-top"
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
                    <td className="w-12 py-1.5 pr-3 text-right font-mono text-muted-foreground">
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
