const API = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error {
  /** Cloudflare's own error codes, kept so a caller can explain the common ones. */
  codes: number[];

  constructor(message: string, codes: number[] = []) {
    super(message);
    this.codes = codes;
  }
}

interface Envelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  if (!token) throw new CloudflareError("No Cloudflare token is connected");

  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
    cache: "no-store",
  });

  const body = (await response.json()) as Envelope<T>;
  if (!response.ok || !body.success) {
    const detail = body.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new CloudflareError(detail, body.errors?.map((error) => error.code) ?? []);
  }
  return body.result;
}

/* -------------------------------------------------------------------------- */
/* Account and zones                                                          */
/* -------------------------------------------------------------------------- */

export interface Zone {
  id: string;
  name: string;
  status: string;
  account: { id: string; name: string };
}

export async function listZones(token: string) {
  return call<Zone[]>(token, "/zones?per_page=50");
}

export async function verifyToken(token: string) {
  return call<{ status: string }>(token, "/user/tokens/verify");
}

/* -------------------------------------------------------------------------- */
/* Workers                                                                    */
/* -------------------------------------------------------------------------- */

export interface WorkerBinding {
  type: "r2_bucket" | "plain_text" | "secret_text";
  name: string;
  text?: string;
  bucket_name?: string;
}

export interface WorkerInfo {
  id: string;
  created_on: string;
  modified_on: string;
}

export async function getWorker(token: string, accountId: string, scriptName: string) {
  try {
    const scripts = await call<WorkerInfo[]>(token, `/accounts/${accountId}/workers/scripts`);
    return scripts.find((script) => script.id === scriptName) ?? null;
  } catch {
    return null;
  }
}

/**
 * Uploads the script as an ES module with its bindings attached, which is the
 * same call `wrangler deploy` makes.
 */
export async function uploadWorker(options: {
  token: string;
  accountId: string;
  scriptName: string;
  script: string;
  bindings: WorkerBinding[];
  compatibilityDate: string;
  compatibilityFlags?: string[];
}) {
  const form = new FormData();

  const metadata = {
    main_module: "index.js",
    bindings: options.bindings,
    compatibility_date: options.compatibilityDate,
    compatibility_flags: options.compatibilityFlags ?? [],
  };

  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append(
    "index.js",
    new Blob([options.script], { type: "application/javascript+module" }),
    "index.js",
  );

  return call<WorkerInfo>(
    options.token,
    `/accounts/${options.accountId}/workers/scripts/${options.scriptName}`,
    { method: "PUT", body: form },
  );
}

export async function deleteWorker(token: string, accountId: string, scriptName: string) {
  await call(token, `/accounts/${accountId}/workers/scripts/${scriptName}?force=true`, {
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/* Email Routing                                                              */
/* -------------------------------------------------------------------------- */

export interface RoutingStatus {
  enabled: boolean;
  name: string;
  status: string;
}

export async function getRouting(token: string, zoneId: string) {
  try {
    return await call<RoutingStatus>(token, `/zones/${zoneId}/email/routing`);
  } catch {
    return null;
  }
}

/** Turns on Email Routing, which also publishes the MX records it needs. */
export async function enableRouting(token: string, zoneId: string) {
  return call<RoutingStatus>(token, `/zones/${zoneId}/email/routing/enable`, { method: "POST" });
}

export async function disableRouting(token: string, zoneId: string) {
  return call<RoutingStatus>(token, `/zones/${zoneId}/email/routing/disable`, { method: "POST" });
}

export interface CatchAllRule {
  enabled: boolean;
  actions: { type: string; value: string[] }[];
  matchers: { type: string }[];
}

export async function getCatchAll(token: string, zoneId: string) {
  try {
    return await call<CatchAllRule>(token, `/zones/${zoneId}/email/routing/rules/catch_all`);
  } catch {
    return null;
  }
}

/** Points every address on the zone at the worker. */
export async function setCatchAllToWorker(token: string, zoneId: string, scriptName: string) {
  return call<CatchAllRule>(token, `/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: JSON.stringify({
      name: "Send everything to the mail worker",
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [scriptName] }],
    }),
  });
}

export async function disableCatchAll(token: string, zoneId: string) {
  return call<CatchAllRule>(token, `/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: JSON.stringify({
      name: "Disabled",
      enabled: false,
      matchers: [{ type: "all" }],
      actions: [{ type: "drop" }],
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* DNS                                                                        */
/* -------------------------------------------------------------------------- */

export interface DnsRecordSummary {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
}

export async function listDnsRecords(token: string, zoneId: string, name: string, type?: string) {
  const query = new URLSearchParams({ name, per_page: "100" });
  if (type) query.set("type", type);
  return call<DnsRecordSummary[]>(token, `/zones/${zoneId}/dns_records?${query}`);
}

export async function createDnsRecord(
  token: string,
  zoneId: string,
  record: { type: string; name: string; content: string; priority?: number; comment?: string },
) {
  return call<DnsRecordSummary>(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ ttl: 1, ...record }),
  });
}

export async function deleteDnsRecord(token: string, zoneId: string, recordId: string) {
  return call<{ id: string }>(token, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
  });
}

/**
 * The hosts Cloudflare Email Routing publishes on a zone it receives for. The
 * priorities are arbitrary; all three hosts have to be present.
 */
export const EMAIL_ROUTING_MX = [
  { host: "route1.mx.cloudflare.net", priority: 91 },
  { host: "route2.mx.cloudflare.net", priority: 99 },
  { host: "route3.mx.cloudflare.net", priority: 1 },
] as const;
