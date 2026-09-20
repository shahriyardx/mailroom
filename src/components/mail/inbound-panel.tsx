"use client";

import {
  Button,
  Field,
  Fieldset,
  Input,
  InputGroup,
  List,
  ListEmpty,
  ListRow,
  Note,
  Panel,
  StatusPill,
} from "@/components/kit";
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
        title="The worker"
        description="The Cloudflare worker that receives your mail, stores attachments and hands each message to this app."
        action={
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill state={status.deployed ? "ok" : "pending"}>
              {status.deployed ? <Check /> : null}
              {status.deployed ? "Deployed" : "Not deployed"}
            </StatusPill>
          </div>
        }
      >
        {status.error && (
          <p className="mb-4 flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[12.5px] text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {status.error}
          </p>
        )}

        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 sm:grid-cols-3">
          <Cell label="Script">{status.scriptName}</Cell>
          <Cell label="Size">{(status.scriptBytes / 1024).toFixed(0)} KB</Cell>
          <Cell label="Updated">
            {status.modifiedOn ? new Date(status.modifiedOn).toLocaleString() : "—"}
          </Cell>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="solid"
            pill
            loading={pending}
            onClick={() => act(deployWorkerAction, "Worker uploaded to Cloudflare.")}
          >
            {!pending && (status.deployed ? <RotateCw /> : <CloudUpload />)}
            {status.deployed ? "Redeploy" : "Deploy worker"}
          </Button>

          {status.deployed && (
            <Button
              variant="outline"
              pill
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Delete the worker from Cloudflare? Inbound mail stops.")) {
                  return;
                }
                act(removeWorkerAction, "Worker deleted from Cloudflare.");
              }}
            >
              <Trash2 />
              Delete
            </Button>
          )}

          <Note>
            Uploads the bundled script with its R2 binding and secret. No wrangler, no deploy step.
          </Note>
        </div>

        {note && (
          <p
            className={cn(
              "mt-3 text-[12.5px]",
              note.tone === "ok" ? "text-ok" : "text-destructive",
            )}
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
        <List>
          {status.zones.map((zone) => (
            <ListRow key={zone.id} className="flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px]">{zone.name}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {zone.routingEnabled ? "Email routing on" : "Email routing off"}
                </p>
              </div>

              <StatusPill state={zone.catchAllToWorker ? "ok" : "pending"}>
                {zone.catchAllToWorker ? "Receiving" : "Not receiving"}
              </StatusPill>

              {zone.catchAllToWorker ? (
                <Button
                  variant="ghost"
                  size="sm"
                  pill
                  disabled={pending}
                  onClick={() =>
                    act(() => unrouteZoneAction(zone.id, false), `${zone.name} no longer receives.`)
                  }
                >
                  Stop
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  pill
                  disabled={pending || !status.deployed}
                  title={status.deployed ? undefined : "Deploy the worker first"}
                  onClick={() => act(() => routeZoneAction(zone.id), `${zone.name} now receives.`)}
                >
                  Receive mail here
                </Button>
              )}
            </ListRow>
          ))}
          {status.zones.length === 0 && <ListEmpty>No zones visible to this token.</ListEmpty>}
        </List>

        <Note className="mt-3">
          Turning a zone on replaces its MX records with Cloudflare's. Anything receiving mail on
          that domain today stops.
        </Note>
      </Panel>

      <Panel
        title="Cloudflare connection"
        description="Used to upload the worker and manage Email Routing."
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill state="ok">
            <Check />
            Connected
          </StatusPill>
          <span className="font-mono text-[12px] text-muted-foreground">{connection.hint}</span>
          {connection.label && (
            <span className="text-[12px] text-muted-foreground">{connection.label}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            pill
            className="ml-auto"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await disconnectCloudflareAction();
                router.refresh();
              })
            }
          >
            <Unplug />
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
      <Fieldset className="mt-0">
        <p className="mb-2 flex items-center gap-2 text-[13px] font-medium">
          <Plug className="size-4 text-muted-foreground" />
          Create a token with these permissions
        </p>
        <ul className="mb-3 space-y-1 font-mono text-[12px] text-muted-foreground">
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
          className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline"
        >
          Create it in Cloudflare
          <ExternalLink className="size-3" />
        </a>

        <Field
          label="API token"
          htmlFor="cloudflare-token"
          hint="The token is encrypted before it is stored and can be revoked in Cloudflare at any time."
          className="max-w-lg"
        >
          <InputGroup>
            <Input
              id="cloudflare-token"
              type="password"
              mono
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste the API token"
            />
            <Button
              variant="solid"
              pill
              loading={pending}
              disabled={!token.trim()}
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
              Verify and save
            </Button>
          </InputGroup>
        </Field>

        {error && <p className="mt-2 text-[12.5px] text-destructive">{error}</p>}
      </Fieldset>
    </Panel>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[12.5px]">{children}</dd>
    </div>
  );
}
