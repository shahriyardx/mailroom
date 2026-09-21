import { AcceptInvite } from "@/components/accept-invite";
import { getSession } from "@/lib/session";
import { invitationForToken } from "@/server/invitations";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await invitationForToken(token);

  // Already signed in: there is nothing to accept.
  const session = await getSession();
  if (session?.user) redirect("/mail/all/inbox");

  if (!found) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="font-display text-[20px] font-semibold tracking-[-0.02em]">
            This link is no longer good
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            It may have been used already, withdrawn, or left to expire. Ask whoever invited you to
            send another.
          </p>
          <Link
            href="/sign-in"
            className="mt-5 inline-block text-[13px] text-primary hover:underline"
          >
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <AcceptInvite
      token={token}
      email={found.invitation.email}
      role={found.invitation.role ?? "member"}
      company={found.organization?.name ?? "Mailroom"}
    />
  );
}
