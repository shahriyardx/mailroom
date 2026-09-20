import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/session";
import { registrationOpen } from "@/server/registration";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session?.user) redirect("/mail/all/inbox");

  const { error } = await searchParams;

  return (
    <AuthForm
      registrationOpen={await registrationOpen()}
      initialError={
        error ? "That GitHub account cannot sign in here. This dashboard has one owner." : undefined
      }
    />
  );
}
