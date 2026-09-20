"use client";

import { Button, Input } from "@/components/kit";
import { cn } from "@/lib/utils";
import {
  connectCloudflareAction,
  deployWorkerAction,
  disconnectCloudflareAction,
  removeWorkerAction,
  routeZoneAction,
  unrouteZoneAction,
} from "@/server/actions";
import type { InboundStatus } from "@/server/inbound";
import {
  AlertTriangle,
  Check,
  CloudUpload,
  ExternalLink,
  Loader2,
  Plug,
  RotateCw,
  Trash2,
  Unplug,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyNote, Panel, StatusPill } from "./settings-ui";

const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

interface Props {
  status: InboundStatus;
  connection: { connected: boolean; hint?: string; label?: string | null };
}

export function InboundPanel({ status, connection }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  function act(run: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setNote(null);
    start(async () => {
      const result = await run();
      setNote(
        result.ok ? { tone: "ok", text: success } : { tone: "bad", text: result.error ?? "" },
      );
      router.refresh();
    });
  }

  if (!connection.connected) {
    return <ConnectCard />;
  }

  return (
    <>
      <Panel
        title="Inbound worker"
        description="The Cloudflare worker that receives your mail, stores attachments and hands each message to this app."
        action={
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill state={status.deployed ? "ok" : "pending"}>
              {status.deployed ? <Check className="size-2.5" /> : null}
              {status.deployed ? "deployed" : "not deployed"}
            </StatusPill>
          </div>
        }
      >
        {status.error && (
          <p className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            {status.error}
          </p>
        )}

        <dl className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
          <Cell label="script">{status.scriptName}</Cell>
          <Cell label="size">{(status.scriptBytes / 1024).toFixed(0)} KB</Cell>
          <Cell label="updated">
            {status.modifiedOn ? new Date(status.modifiedOn).toLocaleString() : "—"}
          </Cell>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-full text-[12px]"
            disabled={pending}
            onClick={() => act(deployWorkerAction, "Worker uploaded to Cloudflare.")}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : status.deployed ? (
              <RotateCw className="size-3.5" />
            ) : (
              <CloudUpload className="size-3.5" />
            )}
            {status.deployed ? "Redeploy" : "Deploy worker"}
          </Button>

          {status.deployed && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full text-[12px]"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Delete the worker from Cloudflare? Inbound mail stops.")) {
                  return;
                }
                act(removeWorkerAction, "Worker deleted from Cloudflare.");
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          )}

          <span className="text-[11.5px] text-muted-foreground">
            Uploads the bundled script with its R2 binding and secret. No wrangler, no deploy step.
          </span>
        </div>

        {note && (
          <p
            className={cn("mt-2 text-[12px]", note.tone === "ok" ? "text-ok" : "text-destructive")}
          >
            {note.text}
          </p>
        )}
      </Panel>

      <Panel
        title="Receiving domains"
        description="Turning a zone on publishes Cloudflare's MX records and points every address at the worker."
        meta={`${status.zones.filter((zone) => zone.catchAllToWorker).length}/${status.zones.length}`}
      >
        <div className="divide-y rounded-xl border">
          {status.zones.map((zone) => (
            <div key={zone.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px]">{zone.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {zone.routingEnabled ? "email routing on" : "email routing off"}
                </p>
              </div>

              <StatusPill state={zone.catchAllToWorker ? "ok" : "pending"}>
                {zone.catchAllToWorker ? "receiving" : "not receiving"}
              </StatusPill>

              {zone.catchAllToWorker ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full text-[11.5px]"
                  disabled={pending}
                  onClick={() =>
                    act(() => unrouteZoneAction(zone.id, false), `${zone.name} no longer receives.`)
                  }
                >
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-[11.5px]"
                  disabled={pending || !status.deployed}
                  title={status.deployed ? undefined : "Deploy the worker first"}
                  onClick={() => act(() => routeZoneAction(zone.id), `${zone.name} now receives.`)}
                >
                  Receive mail here
                </Button>
              )}
            </div>
          ))}
          {status.zones.length === 0 && (
            <div className="px-3 py-3">
              <EmptyNote>no zones visible to this token</EmptyNote>
            </div>
          )}
        </div>

        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          Turning a zone on replaces its MX records with Cloudflare's. Anything receiving mail on
          that domain today stops.
        </p>
      </Panel>

      <Panel
        title="Cloudflare connection"
        description="Used to upload the worker and manage Email Routing."
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill state="ok">
            <Check className="size-2.5" />
            connected
          </StatusPill>
          <span className="font-mono text-[11.5px] text-muted-foreground">{connection.hint}</span>
          {connection.label && (
            <span className="text-[11.5px] text-muted-foreground">{connection.label}</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1.5 rounded-full text-[11.5px]"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await disconnectCloudflareAction();
                router.refresh();
              })
            }
          >
            <Unplug className="size-3" />
            Disconnect
          </Button>
        </div>
      </Panel>
    </>
  );
}

function ConnectCard() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel
      title="Connect Cloudflare"
      description="With a token, the worker deploys and your domains start receiving from here. No wrangler, no separate deployment."
    >
      <div className="rounded-xl border bg-background p-3">
        <p className="mb-2 flex items-center gap-2 text-[12px]">
          <Plug className="size-3.5 text-muted-foreground" />
          Create a token with these permissions:
        </p>
        <ul className="mb-3 space-y-1 font-mono text-[11.5px] text-muted-foreground">
          <li>Account → Workers Scripts → Edit</li>
          <li>Account → Workers R2 Storage → Edit</li>
          <li>Zone → Zone → Read</li>
          <li>Zone → Email Routing → Edit</li>
          <li>Zone → DNS → Edit</li>
        </ul>

        <a
          href={TOKEN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
        >
          Create it in Cloudflare
          <ExternalLink className="size-3" />
        </a>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste the API token"
            className="h-9 w-72 rounded-full font-mono text-[12px]"
          />
          <Button
            size="sm"
            className="h-9 rounded-full text-[12px]"
            disabled={pending || !token.trim()}
            onClick={() => {
              setError(null);
              start(async () => {
                const result = await connectCloudflareAction(token);
                if (result.ok) {
                  setToken("");
                  router.refresh();
                } else {
                  setError(result.error);
                }
              });
            }}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Verify and save
          </Button>
        </div>

        {error && <p className="mt-2 text-[11.5px] text-destructive">{error}</p>}

        <p className="mt-3 text-[11.5px] text-muted-foreground">
          The token is encrypted before it is stored and can be revoked in Cloudflare at any time.
        </p>
      </div>
    </Panel>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[11.5px]">{children}</dd>
    </div>
  );
}
