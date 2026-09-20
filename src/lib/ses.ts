import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetAccountCommand,
  GetEmailIdentityCommand,
  ListEmailIdentitiesCommand,
  PutEmailIdentityDkimAttributesCommand,
  PutEmailIdentityDkimSigningAttributesCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { env } from "./env";

let client: SESv2Client | undefined;

export function ses() {
  if (!client) {
    client = new SESv2Client({
      region: env.aws.region,
      credentials: env.aws.accessKeyId
        ? {
            accessKeyId: env.aws.accessKeyId,
            secretAccessKey: env.aws.secretAccessKey,
          }
        : undefined, // fall back to the instance role or shared config
    });
  }
  return client;
}

export interface SesIdentity {
  name: string;
  type: "DOMAIN" | "EMAIL_ADDRESS" | "MANAGED_DOMAIN";
  verificationStatus: string;
  sendingEnabled: boolean;
  dkimStatus: string;
  dkimOrigin: string | null;
  dkimTokens: string[];
  mailFromDomain: string | null;
  mailFromStatus: string | null;
}

/** Every identity in the account, paged through to the end. */
export async function listIdentities(): Promise<
  { name: string; type: string; sendingEnabled: boolean; verificationStatus: string }[]
> {
  const out: { name: string; type: string; sendingEnabled: boolean; verificationStatus: string }[] =
    [];
  let token: string | undefined;

  do {
    const page = await ses().send(
      new ListEmailIdentitiesCommand({ PageSize: 100, NextToken: token }),
    );
    for (const identity of page.EmailIdentities ?? []) {
      if (!identity.IdentityName) continue;
      out.push({
        name: identity.IdentityName,
        type: identity.IdentityType ?? "DOMAIN",
        sendingEnabled: identity.SendingEnabled ?? false,
        verificationStatus: identity.VerificationStatus ?? "PENDING",
      });
    }
    token = page.NextToken;
  } while (token);

  return out;
}

export async function getIdentity(name: string): Promise<SesIdentity | null> {
  try {
    const result = await ses().send(new GetEmailIdentityCommand({ EmailIdentity: name }));
    return {
      name,
      type: (result.IdentityType as SesIdentity["type"]) ?? "DOMAIN",
      verificationStatus: result.VerificationStatus ?? "PENDING",
      sendingEnabled: result.VerifiedForSendingStatus ?? false,
      dkimStatus: result.DkimAttributes?.Status ?? "PENDING",
      dkimOrigin: result.DkimAttributes?.SigningAttributesOrigin ?? null,
      dkimTokens: result.DkimAttributes?.Tokens ?? [],
      mailFromDomain: result.MailFromAttributes?.MailFromDomain ?? null,
      mailFromStatus: result.MailFromAttributes?.MailFromDomainStatus ?? null,
    };
  } catch (error) {
    if ((error as { name?: string }).name === "NotFoundException") return null;
    throw error;
  }
}

/** Creates the identity with Easy DKIM and returns the CNAME tokens to publish. */
export async function createDomainIdentity(name: string) {
  const result = await ses().send(
    new CreateEmailIdentityCommand({
      EmailIdentity: name,
      DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
    }),
  );
  return {
    dkimTokens: result.DkimAttributes?.Tokens ?? [],
    dkimStatus: result.DkimAttributes?.Status ?? "PENDING",
    verifiedForSending: result.VerifiedForSendingStatus ?? false,
  };
}

export async function deleteIdentity(name: string) {
  await ses().send(new DeleteEmailIdentityCommand({ EmailIdentity: name }));
}

export async function enableDkim(name: string) {
  await ses().send(
    new PutEmailIdentityDkimAttributesCommand({ EmailIdentity: name, SigningEnabled: true }),
  );
}

/**
 * Switches an identity to a key we generated (BYODKIM).
 * SES keeps the private key; we never need it again, so the caller drops it.
 */
export async function putExternalDkim(options: {
  domain: string;
  selector: string;
  privateKey: string;
}) {
  const result = await ses().send(
    new PutEmailIdentityDkimSigningAttributesCommand({
      EmailIdentity: options.domain,
      SigningAttributesOrigin: "EXTERNAL",
      SigningAttributes: {
        DomainSigningSelector: options.selector,
        DomainSigningPrivateKey: options.privateKey,
      },
    }),
  );
  return {
    dkimStatus: result.DkimStatus ?? "PENDING",
    dkimTokens: result.DkimTokens ?? [options.selector],
  };
}

/** Custom return-path domain, so bounces come back to a subdomain you control. */
export async function setMailFromDomain(name: string, mailFromDomain: string) {
  await ses().send(
    new PutEmailIdentityMailFromAttributesCommand({
      EmailIdentity: name,
      MailFromDomain: mailFromDomain,
      BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
    }),
  );
}

export interface AccountStatus {
  productionAccess: boolean;
  enforcementStatus: string;
  max24Hour: number;
  sentLast24Hours: number;
  maxSendRate: number;
}

export async function getAccountStatus(): Promise<AccountStatus | null> {
  try {
    const result = await ses().send(new GetAccountCommand({}));
    return {
      productionAccess: result.ProductionAccessEnabled ?? false,
      enforcementStatus: result.EnforcementStatus ?? "HEALTHY",
      max24Hour: result.SendQuota?.Max24HourSend ?? 0,
      sentLast24Hours: result.SendQuota?.SentLast24Hours ?? 0,
      maxSendRate: result.SendQuota?.MaxSendRate ?? 0,
    };
  } catch {
    return null;
  }
}

/** Sends a fully built MIME message so we keep control of every header. */
export async function sendRawEmail(options: {
  raw: Uint8Array;
  from: string;
  to: string[];
  configurationSet?: string;
}) {
  const result = await ses().send(
    new SendEmailCommand({
      FromEmailAddress: options.from,
      Destination: { ToAddresses: options.to },
      Content: { Raw: { Data: options.raw } },
      ConfigurationSetName: options.configurationSet || undefined,
    }),
  );
  return { messageId: result.MessageId ?? "" };
}

/** DNS records the user has to publish for a domain to work end to end. */
export interface DnsRecord {
  kind: "CNAME" | "TXT" | "MX";
  /** Fully qualified record name. */
  name: string;
  /** Record content only. MX priority is kept separate, as DNS hosts ask for it separately. */
  value: string;
  priority?: number;
  purpose: string;
  required: boolean;
  /** A record already in place that we cannot reproduce, shown for reference only. */
  informational?: boolean;
}

export function dnsRecordsFor(options: {
  domain: string;
  region: string;
  dkimTokens: string[];
  dkimOrigin?: string | null;
  /** Base64 SPKI public key, present when this app generated the DKIM key. */
  dkimPublicKey?: string | null;
  mailFromDomain: string | null;
}): DnsRecord[] {
  const external = options.dkimOrigin === "EXTERNAL";

  const records: DnsRecord[] = options.dkimTokens.map((token) =>
    external
      ? {
          kind: "TXT" as const,
          name: `${token}._domainkey.${options.domain}`,
          // Only publishable when we hold the public half. A key set up
          // elsewhere leaves us with the selector alone, so that row is a
          // reference to a record that already exists.
          value: options.dkimPublicKey
            ? `p=${options.dkimPublicKey}`
            : "already published by whoever set this domain up",
          purpose: "DKIM signing",
          required: true,
          informational: !options.dkimPublicKey,
        }
      : {
          kind: "CNAME" as const,
          name: `${token}._domainkey.${options.domain}`,
          value: `${token}.dkim.amazonses.com`,
          purpose: "DKIM signing",
          required: true,
        },
  );

  if (options.mailFromDomain) {
    records.push({
      kind: "MX",
      name: options.mailFromDomain,
      value: `feedback-smtp.${options.region}.amazonses.com`,
      priority: 10,
      purpose: "Bounce return path",
      required: true,
    });
    records.push({
      kind: "TXT",
      name: options.mailFromDomain,
      value: "v=spf1 include:amazonses.com ~all",
      purpose: "SPF for return path",
      required: true,
    });
  }

  records.push({
    kind: "TXT",
    name: options.domain,
    value: "v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all",
    purpose: "SPF for SES + Cloudflare",
    required: true,
  });

  records.push({
    kind: "TXT",
    name: `_dmarc.${options.domain}`,
    value: `v=DMARC1; p=none; rua=mailto:dmarc@${options.domain}`,
    purpose: "DMARC policy",
    required: false,
  });

  return records;
}

/** SES status strings map onto our own enum. */
/**
 * Shortens a record name against its zone, the way every DNS dashboard does:
 * mail.acme.com becomes "mail", and the apex becomes "@".
 */
export function relativeName(name: string, zone: string) {
  if (name === zone) return "@";
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name;
}

export function toDomainStatus(value: string | null | undefined) {
  switch ((value ?? "").toUpperCase()) {
    case "SUCCESS":
    case "VERIFIED":
      return "verified" as const;
    case "FAILED":
      return "failed" as const;
    case "TEMPORARY_FAILURE":
      return "temporary_failure" as const;
    case "NOT_STARTED":
      return "not_started" as const;
    default:
      return "pending" as const;
  }
}
