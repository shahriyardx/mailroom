"use client";

import { Button, Input, Wordmark } from "@/components/kit";
import {
  finishSetupAction,
  setWorkspaceBrandAction,
  setWorkspaceFeaturesAction,
} from "@/server/actions";
import type { SetupState } from "@/server/setup";
import { ArrowLeft, ArrowRight, Check, ExternalLink, Inbox, Megaphone } from "lucide-react";
import Link from "next/link";
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
 * here and saved as they are answered. The third is a live checklist that
 * links out to the real screens rather than reimplementing them — a wizard
 * with its own cut-down copy of the domains screen is a second thing to keep
 * in step and a dead end for anybody whose setup is not the simple case.
 *
 * Nothing here is a point of no return. Every answer has a settings screen
 * that can change it afterwards.
 */

type Use = "inbox" | "campaigns" | "both";

export function SetupWizard({ state }: { state: SetupState }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [step, setStep] = useState(0);

  const [use, setUse] = useState<Use>(
    state.inboxEnabled && state.campaignsEnabled
      ? "both"
      : state.campaignsEnabled
        ? "campaigns"
        : "inbox",
  );
  const [name, setName] = useState(state.brandName ?? "");

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
      router.push(state.inboxEnabled ? "/mail" : "/settings/broadcasts");
    });
  }

  return (
    <main className="min-h-dvh bg-card px-6 py-10">
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
                detail="Lists and broadcasts to many people, with unsubscribe handled for you."
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
              <Button disabled={busy} onClick={saveUse}>
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
              <Button disabled={busy} onClick={saveBrand}>
                Continue
                <ArrowRight />
              </Button>
            </div>
          </Step>
        ) : null}

        {step === 2 ? (
          <Step
            title="What is left to do"
            hint="Each one opens its own screen. Come back here whenever — nothing is lost by leaving."
          >
            <ul className="space-y-2">
              {state.steps.map((entry) => (
                <li key={entry.key}>
                  <ChecklistRow
                    title={entry.title}
                    detail={entry.detail}
                    href={entry.href}
                    done={entry.done}
                    skipped={entry.skipped === true}
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
                <Button disabled={busy} onClick={finish}>
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

function ChecklistRow({
  title,
  detail,
  href,
  done,
  skipped,
}: {
  title: string;
  detail: string;
  href: string;
  done: boolean;
  skipped: boolean;
}) {
  const external = href.startsWith("http");

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
    </>
  );

  if (skipped) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-border/60 px-3.5 py-3 opacity-45">
        {body}
      </div>
    );
  }

  const className =
    "flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-muted/40";

  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
