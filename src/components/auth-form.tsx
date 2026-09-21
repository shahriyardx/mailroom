"use client";

import { Button, Field, Input, Wordmark } from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import { ArrowRight, Github, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signInWithPassword() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    if (result?.error) {
      setError(result.error.message ?? "That email and password do not match");
      setPending(false);
      return;
    }
    router.push("/mail/all/inbox");
    router.refresh();
  }

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
          <Wordmark size="lg" className="mb-6" />
          <h1 className="font-display text-[2rem] leading-[1.1] tracking-[-0.03em]">
            Your domains.
            <br />
            <span className="text-primary">Your inbox.</span>
          </h1>
          <p className="mt-3 max-w-[22rem] text-[13px] text-muted-foreground">
            {registrationOpen
              ? "Nobody owns this instance yet. The first GitHub account to sign in becomes the owner, and public sign-up closes behind you — everyone after that joins by invitation."
              : "Sign in with the password you chose when you accepted your invitation, or with GitHub if that is the account you were invited on."}
          </p>
        </header>

        <div className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-raise">
          {/* People who were invited set a password; the owner uses GitHub. */}
          <div className="space-y-3">
            <Field label="Email" htmlFor="signin-email">
              <Input
                id="signin-email"
                type="email"
                mono
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </Field>
            <Field label="Password" htmlFor="signin-password">
              <Input
                id="signin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && email && password) void signInWithPassword();
                }}
                placeholder="••••••••••"
              />
            </Field>
            <Button
              variant="solid"
              size="lg"
              pill
              block
              loading={pending}
              disabled={!email.trim() || !password}
              onClick={signInWithPassword}
            >
              Sign in
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11.5px] text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

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
            <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-[12px] text-destructive">
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
          Accounts are created by invitation only.
        </p>
      </div>
    </main>
  );
}
