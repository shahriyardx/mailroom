import { authenticateApiKey } from "@/server/api-auth";
import { listDomainsForUser, recordsForDomain } from "@/server/domains";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/domains — what the account can send from, and the DNS it needs. */
export async function GET(request: NextRequest) {
  const caller = await authenticateApiKey(request);
  if (!caller) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }

  const rows = await listDomainsForUser(caller.userId);

  return NextResponse.json({
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region,
      status: row.status,
      sending_enabled: row.sendingEnabled,
      dkim_status: row.dkimStatus,
      mail_from_domain: row.mailFromDomain,
      spf_verified: row.spfVerified,
      dmarc_verified: row.dmarcVerified,
      imported: Boolean(row.importedAt),
      records: recordsForDomain(row),
    })),
  });
}
