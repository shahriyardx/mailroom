"use client";

import { Button, List, ListRow, Panel, Switch } from "@/components/kit";
import {
  currentSubscription,
  permissionState,
  pushSupport,
  subscribe,
  unsubscribe,
} from "@/lib/push-client";
import {
  subscribeToPushAction,
  testPushAction,
  unsubscribeEverywhereAction,
  unsubscribeFromPushAction,
} from "@/server/actions";
import { BellRing, Laptop, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

export interface Browser {
  id: string;
  endpoint: string;
  label: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

interface Props {
  /** Empty when the instance has no push keys, which disables the whole thing. */
  publicKey: string;
  browsers: Browser[];
}

/**
 * Desktop notifications, switched on per browser.
 *
 * Per browser and not per account, because that is what the permission
 * actually is: granting it on a laptop says nothing about a phone, and a
 * single account-wide switch would be lying about which screens will light
 * up. So the switch reflects *this* browser, and every other one it knows
 * about is listed underneath where it can be turned off from here.
 */
export function NotificationsPanel({ publicKey, browsers }: Props) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [working, setWorking] = useState(false);

  const [support, setSupport] = useState<ReturnType<typeof pushSupport> | null>(null);
  const [permission, setPermission] = useState<ReturnType<typeof permissionState>>("default");
  /** This browser's endpoint, if it has one. The switch is this being set. */
  const [mine, setMine] = useState<string | null>(null);

  // Everything here is a browser fact, so none of it is known until the page
  // is running in one.
  useEffect(() => {
    setSupport(pushSupport());
    setPermission(permissionState());
    void currentSubscription().then((entry) => setMine(entry?.endpoint ?? null));
  }, []);

  const configured = Boolean(publicKey);
  const usable = support === "ready" && configured;
  /** Registered with the browser, and known to the server. */
  const on = Boolean(mine && browsers.some((entry) => entry.endpoint === mine));

  async function turnOn() {
    setWorking(true);
    try {
      const keys = await subscribe(publicKey);
      await subscribeToPushAction(keys);
      setMine(keys.endpoint);
      setPermission(permissionState());
      toast.success("Notifications are on for this browser");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work");
      setPermission(permissionState());
    } finally {
      setWorking(false);
    }
  }

  async function turnOff() {
    setWorking(true);
    try {
      const endpoint = (await unsubscribe()) ?? mine;
      if (endpoint) await unsubscribeFromPushAction(endpoint);
      setMine(null);
      toast.success("Notifications are off for this browser");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work");
    } finally {
      setWorking(false);
    }
  }

  const others = browsers.filter((entry) => entry.endpoint !== mine);

  return (
    <>
      <Panel
        title="Desktop notifications"
        description="A notice when mail arrives, whether or not Mailroom is open."
      >
        {!configured ? (
          <Warning>
            This instance has no push keys, so it cannot send notifications. Run{" "}
            <code className="font-mono">pnpm push:keys</code>, set{" "}
            <code className="font-mono">VAPID_PUBLIC_KEY</code> and{" "}
            <code className="font-mono">VAPID_PRIVATE_KEY</code>, then restart it.
          </Warning>
        ) : support === "insecure" ? (
          <Warning>
            Notifications need a secure connection. Open Mailroom over https and this will work.
          </Warning>
        ) : support === "unsupported" ? (
          <Warning>This browser cannot show push notifications.</Warning>
        ) : null}

        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium">Notify me on this browser</div>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {on
                  ? "Mail arriving in a mailbox you can read will be announced here."
                  : "The browser will ask for permission the first time."}
              </p>
              {permission === "denied" ? (
                <p className="mt-1 text-[12.5px] text-warn">
                  Notifications are blocked for this site. Allow them in the browser's own site
                  settings first — this switch cannot override that.
                </p>
              ) : null}
            </div>
            <Switch
              checked={on}
              disabled={!usable || working || permission === "denied"}
              onCheckedChange={(next) => void (next ? turnOn() : turnOff())}
              aria-label="Notify me on this browser"
            />
          </div>

          {on ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                pill
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const reached = await testPushAction();
                    toast[reached > 0 ? "success" : "error"](
                      reached > 0
                        ? `Sent to ${reached} ${reached === 1 ? "browser" : "browsers"}`
                        : "Nothing was reached. Try turning it off and on again.",
                    );
                  })
                }
              >
                <BellRing />
                Send a test
              </Button>
              <span className="text-[12px] text-muted-foreground">
                Nothing arrives? The operating system can hide notifications too.
              </span>
            </div>
          ) : null}
        </div>
      </Panel>

      {browsers.length > 0 ? (
        <Panel
          title="Devices"
          meta={browsers.length}
          description="Every browser signed in as you that is set up to be notified."
          action={
            browsers.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                pill
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    await unsubscribeEverywhereAction();
                    setMine(null);
                    toast.success("Notifications are off everywhere");
                    router.refresh();
                  })
                }
              >
                Turn off everywhere
              </Button>
            ) : undefined
          }
        >
          <List>
            {mine && browsers.some((entry) => entry.endpoint === mine) ? (
              <Device
                browser={browsers.find((entry) => entry.endpoint === mine) as Browser}
                here
                onRemove={() => void turnOff()}
                busy={working}
              />
            ) : null}

            {others.map((browser) => (
              <Device
                key={browser.id}
                browser={browser}
                onRemove={() =>
                  startTransition(async () => {
                    await unsubscribeFromPushAction(browser.endpoint);
                    toast.success("That device will not be notified any more");
                    router.refresh();
                  })
                }
                busy={busy}
              />
            ))}
          </List>
        </Panel>
      ) : null}
    </>
  );
}

function Device({
  browser,
  here = false,
  onRemove,
  busy,
}: {
  browser: Browser;
  here?: boolean;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <ListRow>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        <Laptop />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className="truncate">{browser.label ?? "A browser"}</span>
          {here ? (
            <span className="shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium text-primary-soft-foreground">
              this one
            </span>
          ) : null}
        </div>
        <div className="text-[12px] text-muted-foreground">
          Added{" "}
          {browser.createdAt.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </div>
      </div>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
        Remove
      </Button>
    </ListRow>
  );
}

/** Something the reader has to fix before any of this can work. */
function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
      <p>{children}</p>
    </div>
  );
}
