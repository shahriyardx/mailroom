"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { Loader2, Mails } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: String(form.get("name") || email.split("@")[0]),
          });

    if (result.error) {
      setError(result.error.message ?? "Something went wrong");
      setPending(false);
      return;
    }

    router.push("/mail/all/inbox");
    router.refresh();
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="w-full max-w-[22rem]">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-sm bg-primary text-primary-foreground">
            <Mails className="size-4" />
          </div>
          <div>
            <p className="text-[14px] font-semibold leading-tight">Mail</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {mode === "sign-in" ? "sign in" : "create account"}
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 rounded-sm border bg-card p-4">
          {mode === "sign-up" && (
            <div className="space-y-1.5">
              <Label className="eyebrow">Name</Label>
              <Input name="name" autoComplete="name" placeholder="Ada Lovelace" className="h-8" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="eyebrow">Email</Label>
            <Input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="h-8 font-mono text-[12px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="eyebrow">Password</Label>
            <Input
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              placeholder="At least 10 characters"
              className="h-8"
            />
          </div>

          {error && (
            <p className="rounded-sm bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" size="sm" className="h-8 w-full gap-2" disabled={pending}>
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>

          <p className="text-center text-[11.5px] text-muted-foreground">
            {mode === "sign-in" ? (
              <>
                No account?{" "}
                <Link href="/sign-up" className="text-primary hover:underline">
                  Sign up
                </Link>
              </>
            ) : (
              <>
                Already registered?{" "}
                <Link href="/sign-in" className="text-primary hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
