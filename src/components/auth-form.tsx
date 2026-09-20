"use client";

import { authClient } from "@/lib/auth-client";
import { ArrowRight, Github, Loader2, Lock } from "lucide-react";
import { useState } from "react";

interface Props {
  /** False once an owner exists, which closes account creation for good. */
  registrationOpen: boolean;
  /** Error handed back by an OAuth redirect. */
  initialError?: string;
}

const CAPABILITIES = [
  ["send", "Amazon SES"],
  ["receive", "Cloudflare Workers"],
  ["store", "Postgres + R2"],
] as const;

export function AuthForm({ registrationOpen, initialError }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function signInWithGithub() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: "github",
      callbackURL: "/mail/all/inbox",
      errorCallbackURL: "/sign-in",
    });
    if (result?.error) {
      setError(result.error.message ?? "GitHub sign-in failed");
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6">
      {/* A single warm wash behind the card, so the page has depth without decoration. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          background:
            "radial-gradient(70rem 40rem at 50% -10%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
      />

      <div className="relative w-full max-w-[26rem]">
        <header className="mb-8">
          <p className="eyebrow mb-3">self-hosted mail</p>
          <h1 className="font-heading text-[2rem] leading-[1.1] tracking-[-0.03em]">
            Your domains.
            <br />
            <span className="text-primary">Your inbox.</span>
          </h1>
          <p className="mt-3 max-w-[22rem] text-[13px] text-muted-foreground">
            {registrationOpen
              ? "Nobody owns this instance yet. The first GitHub account to sign in claims it, and the door closes behind you."
              : "This instance already has an owner. Only that GitHub account can sign in."}
          </p>
        </header>

        <div className="raise rounded-2xl border bg-card p-2">
          <button
            type="button"
            onClick={signInWithGithub}
            disabled={pending}
            className="group flex w-full items-center gap-3 rounded-xl bg-foreground px-4 py-3.5 text-background transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-[18px] shrink-0 animate-spin" />
            ) : (
              <Github className="size-[18px] shrink-0" />
            )}
            <span className="flex-1 text-left font-medium text-[13.5px]">
              {registrationOpen ? "Claim with GitHub" : "Continue with GitHub"}
            </span>
            <ArrowRight className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>

          {error && (
            <p className="mx-1 mt-2 mb-1 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-[12px] text-destructive">
              <Lock className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <ul className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border">
          {CAPABILITIES.map(([label, value]) => (
            <li key={label} className="bg-card px-3 py-3">
              <p className="eyebrow">{label}</p>
              <p className="mt-1 font-mono text-[11.5px] text-foreground">{value}</p>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-center text-[11.5px] text-muted-foreground">
          No passwords. GitHub is the only way in.
        </p>
      </div>
    </main>
  );
}
