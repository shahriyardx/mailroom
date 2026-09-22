import Screen from "@/app/(mail)/settings/logs/[id]/page";

/*
 * One logged message. No page heading of its own: the screen opens with the
 * subject and a way back to the log, which is a better title than the word
 * "Message" would be.
 */
// Written out rather than re-exported: Next reads this at build time and
// only understands a literal here.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Screen params={params} />;
}
