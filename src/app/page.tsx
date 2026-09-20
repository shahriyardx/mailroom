import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getSession();
  redirect(session?.user ? "/mail/all/inbox" : "/sign-in");
}
