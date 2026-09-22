import { Button, Choice, Field, Input, Spinner, Switch } from "@/components/kit";
import { ApiError, listMailboxes, whoami } from "@/lib/api";
import { cx } from "@/lib/format";
import { useSettings, useTheme } from "@/lib/hooks";
import { type Settings, normalizeBase, originPattern } from "@/lib/settings";
import type { ApiIdentity, ApiMailbox } from "@/lib/types";
import { ExternalLink, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

/**
 * Connecting the extension to an instance, and the few preferences that go
 * with it.
 *
 * A full page rather than a panel inside the popup, for one practical reason:
 * asking for a host permission closes the popup on Firefox, which would take
 * the half-filled form with it.
 */

type Status =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; identity: ApiIdentity }
  | { state: "error"; message: string; hint?: string };

export function Options() {
  const { settings, update } = useSettings();
  useTheme(settings?.theme);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [mailboxes, setMailboxes] = useState<ApiMailbox[]>([]);

  // Seed the form once the stored values arrive, and not again afterwards, so
  // typing is never overwritten by an echo of what was saved.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!settings || seeded) return;
    setBaseUrl(settings.baseUrl);
    setApiKey(settings.apiKey);
    setSeeded(true);
  }, [settings, seeded]);

  // Already connected: show who we are without being asked.
  useEffect(() => {
    if (!settings?.baseUrl || !settings.apiKey || status.state !== "idle") return;
    let alive = true;
    void whoami(settings)
      .then((identity) => {
        if (alive) setStatus({ state: "ok", identity });
      })
      .catch(() => {});
    void listMailboxes(settings)
      .then((rows) => {
        if (alive) setMailboxes(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings, status.state]);

  async function connect() {
    const origin = originPattern(baseUrl);
    if (!origin) {
      setStatus({ state: "error", message: "That does not look like an address." });
      return;
    }

    // Asked for first and from inside the click, because a permission prompt
    // raised later in the turn is not attached to a gesture and is refused.
    let granted = false;
    try {
      granted = await browser.permissions.request({ origins: [origin] });
    } catch {
      granted = false;
    }

    if (!granted) {
      setStatus({
        state: "error",
        message: "Without permission to reach that address the extension cannot read anything.",
        hint: origin,
      });
      return;
    }

    setStatus({ state: "checking" });
    const candidate = { baseUrl: normalizeBase(baseUrl), apiKey: apiKey.trim() };

    try {
      const identity = await whoami(candidate as Settings);
      await update(candidate);
      setStatus({ state: "ok", identity });
      const rows = await listMailboxes({ ...(settings as Settings), ...candidate });
      setMailboxes(rows);
      void browser.runtime.sendMessage({ type: "poll" }).catch(() => {});
    } catch (caught) {
      const failure = caught instanceof ApiError ? caught : null;
      setStatus({
        state: "error",
        message: failure?.message ?? "Could not reach that instance.",
        hint: failure?.isAuth
          ? "Settings → API keys in Mailroom will make you a new one. It needs the mail:read and mail:write scopes."
          : undefined,
      });
    }
  }

  async function disconnect() {
    await update({ baseUrl: "", apiKey: "", watchAll: true, mailboxIds: [] });
    setBaseUrl("");
    setApiKey("");
    setMailboxes([]);
    setStatus({ state: "idle" });
  }

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  /**
   * "Every mailbox" is its own switch, not the state of having ticked them all.
   *
   * Those two look identical on the day they are chosen and differ on the day
   * a seventh address is made — one picks it up, the other never will. Keeping
   * them apart is also what makes an empty list mean what it says: none, which
   * is a choice somebody is allowed to make rather than a slip to be corrected
   * by turning everything back on.
   */
  const watchingAll = settings.watchAll;
  const picked = new Set(settings.mailboxIds);

  function watchEvery(on: boolean) {
    // Turning it off leaves the reader with their own list, which starts
    // empty. Seeding it with today's addresses would be this screen deciding
    // something it was not asked to decide.
    void update(on ? { watchAll: true } : { watchAll: false, mailboxIds: [] });
  }

  function watchOne(id: string, on: boolean) {
    // Reaching for one address while "every mailbox" is on means that one,
    // and not "all of them plus this one again".
    if (watchingAll) {
      void update({ watchAll: false, mailboxIds: on ? [id] : [] });
      return;
    }
    const next = on
      ? [...new Set([...settings!.mailboxIds, id])]
      : settings!.mailboxIds.filter((entry) => entry !== id);
    void update({ mailboxIds: next });
  }

  return (
    <div className="min-h-screen bg-background py-10">
      <div className="mx-auto w-full max-w-[640px] space-y-6 px-6">
        <header>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Mailroom</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Your inbox in the toolbar. Self-hosted, so you say where it lives.
          </p>
        </header>

        {/* ------------------------------------------------------ connection */}
        <section className="rounded-[14px] border border-border bg-card p-5 shadow-raise">
          <h2 className="mb-1 text-[14px] font-semibold">Instance</h2>
          <p className="mb-4 text-[12.5px] text-muted-foreground">
            The address of your Mailroom and a key it will accept. The key is kept in this browser
            only and is never synced to your account.
          </p>

          <div className="space-y-4">
            <Field label="Address" hint="For example https://mail.example.com">
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://mail.example.com"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>

            <Field
              label="API key"
              hint="Mailroom → Settings → API keys. It needs mail:read, and mail:write for triage."
            >
              <Input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="mk_live_…"
                type="password"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="md"
                pill
                busy={status.state === "checking"}
                disabled={!baseUrl.trim() || !apiKey.trim()}
                onClick={() => void connect()}
              >
                <KeyRound />
                {settings.baseUrl ? "Reconnect" : "Connect"}
              </Button>

              {settings.baseUrl ? (
                <Button size="md" variant="ghost" pill onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              ) : null}

              {baseUrl.trim() ? (
                <a
                  href={`${normalizeBase(baseUrl)}/settings/api-keys`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
                >
                  Make a key
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </div>

            <StatusLine status={status} />
          </div>
        </section>

        {/* --------------------------------------------------------- watching */}
        {mailboxes.length > 0 ? (
          <section className="rounded-[14px] border border-border bg-card p-5 shadow-raise">
            <h2 className="mb-1 text-[14px] font-semibold">Mailboxes</h2>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              Which addresses the popup shows.
            </p>

            <div className="space-y-1">
              <label
                className={cx(
                  "flex cursor-pointer items-start gap-2.5 rounded-[9px] px-2 py-2 transition",
                  watchingAll ? "bg-primary-soft/60" : "hover:bg-accent",
                )}
              >
                <input
                  type="checkbox"
                  checked={watchingAll}
                  onChange={(event) => watchEvery(event.target.checked)}
                  className="mt-0.5 size-3.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-[12.5px] font-medium">Every mailbox</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    Including addresses added later, without coming back here.
                  </span>
                </span>
              </label>

              <div className="my-1 h-px bg-border" />

              {mailboxes.map((mailbox) => {
                const chosen = watchingAll || picked.has(mailbox.id);
                return (
                  <label
                    key={mailbox.id}
                    className={cx(
                      "flex cursor-pointer items-center gap-2.5 rounded-[9px] px-2 py-1.5 transition",
                      chosen ? "bg-primary-soft/60" : "hover:bg-accent",
                      watchingAll && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={chosen}
                      onChange={(event) => watchOne(mailbox.id, event.target.checked)}
                      className="size-3.5 accent-[var(--primary)]"
                    />
                    <span className="font-mono text-[12.5px]">{mailbox.address}</span>
                    {mailbox.is_default ? (
                      <span className="pill border-border text-muted-foreground">default</span>
                    ) : null}
                  </label>
                );
              })}
            </div>

            {/* Both of these states are allowed. Neither is obvious from six
                ticked or six empty boxes, so each one says what it means. */}
            {!watchingAll && picked.size === 0 ? (
              <p className="mt-3 flex items-start gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3 py-2 text-[12px]">
                <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" />
                Nothing is picked, so the popup will be empty and no mail will be announced.
              </p>
            ) : null}

            {!watchingAll && picked.size === mailboxes.length && mailboxes.length > 0 ? (
              <p className="mt-3 text-[12px] text-muted-foreground">
                That is every address there is today. An address added later will not appear unless{" "}
                <strong className="font-medium">Every mailbox</strong> is on.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ------------------------------------------------------ preferences */}
        <section className="rounded-[14px] border border-border bg-card p-5 shadow-raise">
          <h2 className="mb-2 text-[14px] font-semibold">Notifications</h2>

          <div className="divide-y divide-border">
            <Switch
              label="Tell me about new mail"
              hint="A notification for anything unread that arrived since the last check."
              checked={settings.notifications}
              onChange={(value) => void update({ notifications: value })}
            />
            <Switch
              label="Count on the toolbar icon"
              hint="The number of unread conversations."
              checked={settings.badge}
              onChange={(value) => void update({ badge: value })}
            />
          </div>

          <div className="mt-4 space-y-4">
            <Field label="Check for new mail every" hint="Minutes between checks.">
              <Choice
                label="Check for new mail every"
                value={settings.pollMinutes}
                onChange={(minutes) => void update({ pollMinutes: minutes })}
                options={[1, 2, 5, 10, 15, 30, 60].map((minutes) => ({
                  value: minutes,
                  label: minutes === 60 ? "1 hr" : `${minutes} min`,
                }))}
              />
            </Field>

            <Field label="Appearance" hint="The popup follows this.">
              <Choice
                label="Appearance"
                value={settings.theme}
                onChange={(theme) => void update({ theme })}
                options={[
                  { value: "system" as const, label: "System" },
                  { value: "light" as const, label: "Light" },
                  { value: "dark" as const, label: "Dark" },
                ]}
              />
            </Field>
          </div>
        </section>

        <p className="pb-8 text-center text-[11.5px] text-muted-foreground">
          Mail is read straight from your instance. Nothing passes through anybody else.
        </p>
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.state === "ok") {
    const { identity } = status;
    return (
      <div className="flex items-start gap-2 rounded-[10px] border border-ok/30 bg-ok-soft px-3 py-2 text-[12.5px]">
        <ShieldCheck className="mt-px size-4 shrink-0 text-ok" />
        <div className="min-w-0">
          <div className="font-medium">
            Connected as “{identity.name}”
            {identity.organization ? ` · ${identity.organization.name}` : ""}
          </div>
          <div className="text-muted-foreground">
            {identity.mode === "test" ? "Test key — it will not show live mail. " : ""}
            {identity.reachable_mailboxes}{" "}
            {identity.reachable_mailboxes === 1 ? "mailbox" : "mailboxes"} in reach ·{" "}
            {identity.scopes.join(", ") || "no scopes"}
          </div>
          {!identity.scopes.some((scope) => scope.startsWith("mail")) ? (
            <div className="mt-1 flex items-center gap-1 text-warn">
              <TriangleAlert className="size-3.5" />
              This key has no mail scope, so there will be nothing to read.
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="flex items-start gap-2 rounded-[10px] border border-destructive/30 bg-danger-soft px-3 py-2 text-[12.5px]">
        <TriangleAlert className="mt-px size-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <div className="font-medium">{status.message}</div>
          {status.hint ? <div className="text-muted-foreground">{status.hint}</div> : null}
        </div>
      </div>
    );
  }

  if (status.state === "checking") {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Spinner />
        Asking the instance who this key is…
      </div>
    );
  }

  return <div className="text-[12.5px] text-muted-foreground">Not connected yet.</div>;
}
