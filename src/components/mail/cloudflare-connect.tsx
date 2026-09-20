"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectCloudflareAction, disconnectCloudflareAction } from "@/server/actions";
import { Check, ExternalLink, Loader2, Plug, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StatusPill } from "./settings-ui";

export interface CloudflareState {
  connected: boolean;
  source?: "settings" | "env";
  hint?: string;
  label?: string | null;
}

const TOKEN_URL =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%5D&name=Mail+DNS&accountId=*&zoneId=all";

export function CloudflareConnect({ state }: { state: CloudflareState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [zones, setZones] = useState<string[] | null>(null);

  if (state.connected) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-sm border bg-background px-2.5 py-1.5 text-[11.5px]">
        <StatusPill state="ok">
          <Check className="size-2.5" />
          cloudflare connected
        </StatusPill>
        <span className="font-mono text-muted-foreground">{state.hint}</span>
        {state.label && <span className="text-muted-foreground">{state.label}</span>}
        {state.source === "env" && (
          <span className="text-muted-foreground">from CLOUDFLARE_API_TOKEN</span>
        )}
        {state.source === "settings" && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 text-[11px]"
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
        )}
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-sm border bg-background px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="size-3.5 text-muted-foreground" />
        <span className="text-[12px]">
          Connect Cloudflare to publish DNS records with one click.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-[11.5px]"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Cancel" : "Connect"}
        </Button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11.5px] text-muted-foreground">
            Create a token with <strong>Zone → DNS → Edit</strong> and{" "}
            <strong>Zone → Zone → Read</strong>, then paste it here. It is encrypted before it is
            stored, and you can revoke it in Cloudflare at any time.
          </p>
          <a
            href={TOKEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
          >
            Create the token in Cloudflare
            <ExternalLink className="size-3" />
          </a>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste the API token"
              type="password"
              className="h-8 w-72 font-mono text-[12px]"
            />
            <Button
              size="sm"
              className="h-8 text-[12px]"
              disabled={pending || !token.trim()}
              onClick={() => {
                setError(null);
                setZones(null);
                start(async () => {
                  const result = await connectCloudflareAction(token);
                  if (result.ok) {
                    setZones(result.zones);
                    setToken("");
                    setOpen(false);
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

          {error && <p className="text-[11.5px] text-destructive">{error}</p>}
          {zones && <p className="text-[11.5px] text-ok">Connected. Zones: {zones.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
