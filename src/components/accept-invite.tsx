"use client";

import { Button, Field, Input, Logo } from "@/components/kit";
import { acceptInvitationAction } from "@/server/accept";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  token: string;
  email: string;
  role: string;
  company: string;
}

export function AcceptInvite({ token, email, role, company }: Props) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    start(async () => {
      const result = await acceptInvitationAction({ token, name, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/mail/all/inbox");
      router.refresh();
    });
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <Logo size="lg" className="mb-6" />

        <h1 className="font-display text-[22px] font-semibold leading-snug tracking-[-0.02em]">
          Join {company}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          You were invited as <span className="font-medium text-foreground">{role}</span>. Choose a
          password and your mail is ready.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="Email">
            <Input value={email} readOnly mono className="opacity-70" />
          </Field>

          <Field label="Your name" htmlFor="invite-name">
            <Input
              id="invite-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
            />
          </Field>

          <Field
            label="Password"
            htmlFor="invite-password"
            hint="At least 10 characters."
            error={error ?? undefined}
          >
            <Input
              id="invite-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name && password) accept();
              }}
              placeholder="••••••••••"
            />
          </Field>

          <Button
            variant="solid"
            size="lg"
            pill
            block
            loading={busy}
            disabled={!name.trim() || password.length < 10}
            onClick={accept}
          >
            Accept and sign in
          </Button>
        </div>

        <p className="mt-6 text-center text-[12px] text-muted-foreground">
          This link works once. If you were not expecting it, close this page.
        </p>
      </div>
    </main>
  );
}
