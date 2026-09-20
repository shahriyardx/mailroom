import "server-only";
import { WORKER_BYTES, WORKER_SCRIPT } from "@/generated/worker-bundle";
import {
  CloudflareError,
  type Zone,
  deleteWorker,
  disableCatchAll,
  disableRouting,
  enableRouting,
  getCatchAll,
  getRouting,
  getWorker,
  listZones,
  setCatchAllToWorker,
  uploadWorker,
} from "@/lib/cloudflare";
import { env } from "@/lib/env";
import { cloudflareCredentials } from "./integrations";

export const SCRIPT_NAME = "mail-inbound";
const COMPATIBILITY_DATE = "2024-12-01";

export interface ZoneStatus {
  id: string;
  name: string;
  routingEnabled: boolean;
  catchAllToWorker: boolean;
}

export interface InboundStatus {
  connected: boolean;
  deployed: boolean;
  scriptName: string;
  scriptBytes: number;
  modifiedOn?: string;
  zones: ZoneStatus[];
  error?: string;
}

/** Everything the inbound page needs: the worker, and where it is wired up. */
export async function inboundStatus(userId: string): Promise<InboundStatus> {
  const base = {
    connected: false,
    deployed: false,
    scriptName: SCRIPT_NAME,
    scriptBytes: WORKER_BYTES,
    zones: [] as ZoneStatus[],
  };

  const credentials = await cloudflareCredentials(userId);
  if (!credentials) return base;

  try {
    const [worker, zones] = await Promise.all([
      getWorker(credentials.token, credentials.accountId, SCRIPT_NAME),
      listZones(credentials.token),
    ]);

    const zoneStatuses = await Promise.all(
      zones.map(async (zone: Zone) => {
        const [routing, catchAll] = await Promise.all([
          getRouting(credentials.token, zone.id),
          getCatchAll(credentials.token, zone.id),
        ]);
        return {
          id: zone.id,
          name: zone.name,
          routingEnabled: routing?.enabled === true,
          catchAllToWorker:
            catchAll?.enabled === true &&
            (catchAll.actions ?? []).some(
              (action) => action.type === "worker" && action.value?.includes(SCRIPT_NAME),
            ),
        };
      }),
    );

    return {
      ...base,
      connected: true,
      deployed: Boolean(worker),
      modifiedOn: worker?.modified_on,
      zones: zoneStatuses,
    };
  } catch (error) {
    return {
      ...base,
      connected: true,
      error: error instanceof Error ? error.message : "Cloudflare could not be reached",
    };
  }
}

/**
 * Uploads the bundled worker with its R2 binding and the shared secret. The
 * same call wrangler makes, so deploying and redeploying are identical.
 */
/**
 * Cloudflare answers "Authentication error" (code 10000) for both a bad token
 * and a token missing one permission, which leaves you with nothing to act on.
 * Name the permission the call actually needed.
 */
function explain(error: unknown, needs: string) {
  if (error instanceof CloudflareError && error.codes.includes(10000)) {
    return new CloudflareError(
      `Cloudflare rejected the token. It needs ${needs}. Edit the token in Cloudflare, then reconnect it here.`,
      error.codes,
    );
  }
  return error instanceof Error ? error : new Error("Cloudflare could not be reached");
}

export async function deployWorker(userId: string) {
  const credentials = await cloudflareCredentials(userId);
  if (!credentials) throw new Error("Connect a Cloudflare token first");

  const appUrl = env.appUrl.replace(/\/+$/, "");
  if (appUrl.includes("localhost")) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL still points at localhost. Cloudflare has to be able to reach this app.",
    );
  }

  try {
    await uploadWorker({
      token: credentials.token,
      accountId: credentials.accountId,
      scriptName: SCRIPT_NAME,
      script: WORKER_SCRIPT,
      compatibilityDate: COMPATIBILITY_DATE,
      compatibilityFlags: ["nodejs_compat"],
      bindings: [
        { type: "r2_bucket", name: "ATTACHMENTS", bucket_name: env.r2.bucket },
        { type: "plain_text", name: "APP_INBOUND_URL", text: `${appUrl}/api/inbound` },
        { type: "plain_text", name: "STORE_RAW", text: "true" },
        { type: "plain_text", name: "MAX_ATTACHMENT_BYTES", text: "26214400" },
        { type: "plain_text", name: "FORWARD_TO", text: env.forwardTo },
        { type: "secret_text", name: "INBOUND_WEBHOOK_SECRET", text: env.inboundSecret },
      ],
    });
  } catch (error) {
    throw explain(error, "Workers Scripts -> Edit, and Workers R2 Storage -> Edit");
  }

  return { scriptName: SCRIPT_NAME };
}

export async function removeWorker(userId: string) {
  const credentials = await cloudflareCredentials(userId);
  if (!credentials) throw new Error("Connect a Cloudflare token first");
  try {
    await deleteWorker(credentials.token, credentials.accountId, SCRIPT_NAME);
  } catch (error) {
    throw explain(error, "Workers Scripts -> Edit");
  }
}

/** Enables Email Routing on a zone and points its catch-all at the worker. */
export async function routeZoneToWorker(userId: string, zoneId: string) {
  const credentials = await cloudflareCredentials(userId);
  if (!credentials) throw new Error("Connect a Cloudflare token first");

  try {
    const routing = await getRouting(credentials.token, zoneId);
    if (!routing?.enabled) await enableRouting(credentials.token, zoneId);

    await setCatchAllToWorker(credentials.token, zoneId, SCRIPT_NAME);
  } catch (error) {
    throw explain(
      error,
      "Zone Settings -> Edit (which is what gates turning Email Routing on), plus Email Routing Rules -> Edit and DNS -> Edit",
    );
  }
}

export async function unrouteZone(userId: string, zoneId: string, alsoDisableRouting: boolean) {
  const credentials = await cloudflareCredentials(userId);
  if (!credentials) throw new Error("Connect a Cloudflare token first");

  try {
    await disableCatchAll(credentials.token, zoneId);
    if (alsoDisableRouting) await disableRouting(credentials.token, zoneId);
  } catch (error) {
    throw explain(error, "Zone Settings -> Edit and Email Routing Rules -> Edit");
  }
}
