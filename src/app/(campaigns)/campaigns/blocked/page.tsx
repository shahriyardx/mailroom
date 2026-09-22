import Screen, { dynamic as inherited } from "@/app/(mail)/settings/blocked/page";
import { PageHeader } from "@/components/mail/page-frame";

/*
 * The same screen as its settings twin, under a page heading and inside the
 * campaigns shell. The search and paging state lives in the query string, so
 * it is handed straight through.
 */
export const dynamic = inherited;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <PageHeader title="Blocked addresses" />
      <Screen searchParams={searchParams} />
    </>
  );
}
