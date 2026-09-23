"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Note,
  Wordmark,
} from "@/components/kit";
import {
  addDomainAction,
  finishSetupAction,
  setWorkspaceBrandAction,
  setWorkspaceFeaturesAction,
} from "@/server/actions";
import type { SetupState } from "@/server/setup";
import { ArrowLeft, ArrowRight, Check, ExternalLink, Inbox, Megaphone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * The first thing anybody sees.
 *
 * A fresh instance is an empty inbox with no mail, no domain and no clue what
 * to press, which is where somebody decides self-hosting was a mistake. Three
 * screens fix that: what this is for, what it is called, and what is left to
 * do.
 *
 * The first two are decisions with no home anywhere else, so they are made
 * here and saved as they are answered. The third is a short live checklist,
 * and nothing on it navigates away: a row that sent somebody to Settings sent
 * them out of a layout that redirects back here, which dropped them on the
 * first question again — and even working, a wizard people leave halfway is a
 * wizard people do not come back to.
 *
 * So a domain is added from a dialog here. Adding one is a single field. The
 * long part is publishing its DNS records, and that belongs on the domains
 * screen, where somebody will be coming back to check on it anyway.
 *
 * Nothing here is a point of no return. Every answer has a settings screen
 * that can change it afterwards.
 */

type Use = "inbox" | "campaigns" | "both";

export function SetupWizard({ state }: { state: SetupState }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  /*
   * Back where they were, not back at the beginning.
   *
   * The two questions are saved as they are answered, so somebody returning
   * has already answered them — asking again reads as the wizard having lost
   * their work.
   */
  const [step, setStep] = useState(state.started ? 2 : 0);

  const [use, setUse] = useState<Use>(
    state.inboxEnabled && state.campaignsEnabled
      ? "both"
      : state.campaignsEnabled
        ? "campaigns"
        : "inbox",
  );
  const [name, setName] = useState(state.brandName ?? "");

  /* Adding the first domain, without leaving this screen. */
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState("");

  function addDomain() {
    startTransition(async () => {
      const result = await addDomainAction(domain.trim());
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAdding(false);
      setDomain("");
      toast.success(
        result.inheritedFrom
          ? `${result.name} added. It sends on ${result.inheritedFrom}'s verification, so there is nothing to publish.`
          : `${result.name} added. Its DNS records are in Settings → Domains.`,
      );
      router.refresh();
    });
  }

  function saveUse() {
    startTransition(async () => {
      const result = await setWorkspaceFeaturesAction({
        inboxEnabled: use !== "campaigns",
        campaignsEnabled: use !== "inbox",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStep(1);
      router.refresh();
    });
  }

  function saveBrand() {
    startTransition(async () => {
      const result = await setWorkspaceBrandAction({ brandName: name.trim() || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStep(2);
      router.refresh();
    });
  }

  function finish() {
    startTransition(async () => {
      const result = await finishSetupAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(state.inboxEnabled ? "/mail" : "/campaigns");
    });
  }

  return (
    <main className="min-h-dvh bg-card px-6 py-10">
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a domain</DialogTitle>
            <DialogDescription>
              The domain your mail is sent from. Just the name — no https, no slash.
            </DialogDescription>
          </DialogHeader>

          <Field label="Domain">
            <Input
              value={domain}
              mono
              autoFocus
              placeholder="yourcompany.com"
              onChange={(event) => setDomain(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && domain.trim()) addDomain();
              }}
            />
          </Field>

          <Note>
            Adding it here is the quick half. It cannot send until its DNS records are published,
            which you do in Settings → Domains — and which can take a few hours to take effect, so
            there is nothing to wait around for now.
          </Note>

          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="solid" disabled={busy || !domain.trim()} onClick={addDomain}>
              Add domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mx-auto w-full max-w-[640px]">
        <div className="mb-8 flex items-center justify-between">
          <Wordmark />
          <Progress step={step} />
        </div>

        {step === 0 ? (
          <Step
            title="What will you use this for?"
            hint="Both is a normal answer. You can change this later in Settings → Features."
          >
            <div className="space-y-2.5">
              <Choice
                icon={<Inbox />}
                title="Team email"
                detail="Mailboxes on your own domain, conversations, filters and labels."
                chosen={use === "inbox"}
                onChoose={() => setUse("inbox")}
              />
              <Choice
                icon={<Megaphone />}
                title="Marketing"
                detail="Lists and campaigns to many people, with unsubscribe handled for you."
                chosen={use === "campaigns"}
                onChoose={() => setUse("campaigns")}
              />
              <Choice
                icon={<Check />}
                title="Both"
                detail="Team mailboxes and a newsletter, on one instance."
                chosen={use === "both"}
                onChoose={() => setUse("both")}
              />
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="solid" disabled={busy} onClick={saveUse}>
                Continue
                <ArrowRight />
              </Button>
            </div>
          </Step>
        ) : null}

        {step === 1 ? (
          <Step
            title="What should we call it?"
            hint="Shown in the sidebar and on the unsubscribe page your recipients see. Leave it empty to use the stock name."
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Inc."
              className="w-full"
              autoFocus
            />

            <div className="mt-6 flex justify-between">
              <Button variant="ghost" disabled={busy} onClick={() => setStep(0)}>
                <ArrowLeft />
                Back
              </Button>
              <Button variant="solid" disabled={busy} onClick={saveBrand}>
                Continue
                <ArrowRight />
              </Button>
            </div>
          </Step>
        ) : null}

        {step === 2 ? (
          <Step
            title="What is left to do"
            hint="Two things. Everything else — receiving, mailboxes, lists — is waiting for you in Settings once you are in."
          >
            <ul className="space-y-2">
              {state.steps.map((entry) => (
                <li key={entry.key}>
                  <ChecklistRow
                    title={entry.title}
                    detail={entry.detail}
                    href={entry.href}
                    done={entry.done}
                    action={
                      entry.key === "domain" ? (
                        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                          <Plus />
                          {entry.done ? "Add another" : "Add"}
                        </Button>
                      ) : null
                    }
                  />
                </li>
              ))}
            </ul>

            <div className="mt-6 flex items-center justify-between gap-3">
              <Button variant="ghost" disabled={busy} onClick={() => setStep(1)}>
                <ArrowLeft />
                Back
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-muted-foreground">
                  {state.remaining === 0
                    ? "All done"
                    : `${state.remaining} left — you can finish anyway`}
                </span>
                <Button variant="solid" disabled={busy} onClick={finish}>
                  Finish setup
                </Button>
              </div>
            </div>
          </Step>
        ) : null}
      </div>
    </main>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of 3`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={
            index <= step ? "h-1 w-6 rounded-full bg-primary" : "h-1 w-6 rounded-full bg-muted"
          }
        />
      ))}
    </div>
  );
}

function Step({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-1.5 mb-6 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

function Choice({
  icon,
  title,
  detail,
  chosen,
  onChoose,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
        chosen ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
          {detail}
        </span>
      </span>
      {chosen ? <Check className="mt-1 size-4 shrink-0 text-primary" /> : null}
    </button>
  );
}

/**
 * One line of the checklist.
 *
 * A row is a link only when there is somewhere useful to send somebody that
 * is not inside this app — the docs, mostly. Everything else is done here or
 * is only being reported on, because a wizard whose rows navigate away is a
 * wizard people leave and do not come back to.
 */
function ChecklistRow({
  title,
  detail,
  href,
  done,
  action,
}: {
  title: string;
  detail: string;
  href?: string;
  done: boolean;
  /** Shown on the right: the way to do this one without leaving. */
  action?: React.ReactNode;
}) {
  const external = Boolean(href?.startsWith("http"));

  const body = (
    <>
      <span
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border [&_svg]:size-3 ${
          done ? "border-ok bg-ok-soft text-ok" : "border-border text-transparent"
        }`}
      >
        <Check />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
          {detail}
        </span>
      </span>
      {external ? <ExternalLink className="mt-1 size-3.5 shrink-0 text-muted-foreground" /> : null}
      {action ? <span className="mt-px shrink-0">{action}</span> : null}
    </>
  );

  const className = "flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3";

  if (external && href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${className} transition-colors hover:bg-muted/40`}
      >
        {body}
      </a>
    );
  }

  return <div className={className}>{body}</div>;
}
