"use client";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Github, Loader2, Lock, Mails } from "lucide-react";
import { useState } from "react";

interface Props {
  /** False once an owner exists, which closes account creation for good. */
  registrationOpen: boolean;
  /** Error handed back by an OAuth redirect. */
  initialError?: string;
}

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
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-xs">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-sm bg-primary text-primary-foreground">
            <Mails className="size-4" />
          </div>
          <div>
            <p className="font-medium text-[14px] leading-tight">Mail</p>
            <p className="font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.1em]">
              {registrationOpen ? "first run" : "sign in"}
            </p>
          </div>
        </div>

        <div className="rounded-sm border bg-card p-5">
          {registrationOpen ? (
            <p className="mb-4 text-[12px] text-muted-foreground">
              Nobody owns this dashboard yet. The first GitHub account to sign in becomes the owner,
              and sign-up closes behind it.
            </p>
          ) : (
            <div className="mb-4 flex items-start gap-2">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <p className="text-[12px] text-muted-foreground">
                This dashboard has an owner. Only that GitHub account can sign in.
              </p>
            </div>
          )}

          <Button
            className="h-9 w-full text-[12.5px]"
            disabled={pending}
            onClick={signInWithGithub}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Github className="size-4" />}
            {registrationOpen ? "Claim with GitHub" : "Continue with GitHub"}
          </Button>

          {error && (
            <p className="mt-3 rounded-[3px] border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11.5px] text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
