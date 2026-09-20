import { env } from "./env";

const API = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error {}

interface CloudflareResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = env.cloudflare.apiToken;
  if (!token) throw new CloudflareError("CLOUDFLARE_API_TOKEN is not set");

  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  const body = (await response.json()) as CloudflareResponse<T>;
  if (!response.ok || !body.success) {
    const detail = body.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new CloudflareError(detail);
  }
  return body.result;
}

export interface Zone {
  id: string;
  name: string;
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
  ttl: number;
}

/**
 * Finds the zone that owns a hostname. A record for mail.acme.com lives in the
 * acme.com zone, so labels are stripped until a zone matches.
 */
export async function findZone(hostname: string): Promise<Zone | null> {
  const labels = hostname.split(".");
  for (let i = 0; i < labels.length - 1; i += 1) {
    const candidate = labels.slice(i).join(".");
    const zones = await call<Zone[]>(`/zones?name=${encodeURIComponent(candidate)}&per_page=1`);
    if (zones.length > 0) return zones[0]!;
  }
  return null;
}

export async function listRecords(zoneId: string, type: string, name: string) {
  return call<DnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(name)}&per_page=100`,
  );
}

export async function createRecord(
  zoneId: string,
  record: { type: string; name: string; content: string; priority?: number; ttl?: number },
) {
  return call<DnsRecord>(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: record.type,
      name: record.name,
      content: record.content,
      priority: record.priority,
      ttl: record.ttl ?? 1, // 1 means "automatic"
      proxied: false,
    }),
  });
}

export async function updateRecord(
  zoneId: string,
  recordId: string,
  record: { type: string; name: string; content: string; priority?: number; ttl?: number },
) {
  return call<DnsRecord>(`/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({
      type: record.type,
      name: record.name,
      content: record.content,
      priority: record.priority,
      ttl: record.ttl ?? 1,
      proxied: false,
    }),
  });
}

export async function verifyToken() {
  try {
    await call("/user/tokens/verify");
    return true;
  } catch {
    return false;
  }
}
