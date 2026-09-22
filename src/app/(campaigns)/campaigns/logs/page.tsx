import Screen, { dynamic as inherited } from "@/app/(mail)/settings/logs/page";
import { PageHeader } from "@/components/mail/page-frame";

/* The email log inside the campaigns shell. Filters live in the query string. */
export const dynamic = inherited;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <PageHeader title="Logs" />
      <Screen searchParams={searchParams} />
    </>
  );
}
