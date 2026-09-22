import Screen, { dynamic as inherited } from "@/app/(mail)/settings/api-keys/page";
import { PageHeader } from "@/components/mail/page-frame";

/*
 * The same screen as its settings twin, under a page heading and inside the
 * campaigns shell. Somebody sending broadcasts reaches for this constantly,
 * and being thrown into the other half of the app to look at it loses their
 * place. The screen itself is imported, not copied.
 */
export const dynamic = inherited;

export default async function Page() {
  return (
    <>
      <PageHeader title="API keys" />
      <Screen />
    </>
  );
}
