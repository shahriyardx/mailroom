import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetAccountCommand,
  GetEmailIdentityCommand,
  ListEmailIdentitiesCommand,
  PutEmailIdentityDkimAttributesCommand,
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
  name: string;
  value: string;
  purpose: string;
  required: boolean;
}

export function dnsRecordsFor(options: {
  domain: string;
  region: string;
  dkimTokens: string[];
  mailFromDomain: string | null;
}): DnsRecord[] {
  const records: DnsRecord[] = options.dkimTokens.map((token) => ({
    kind: "CNAME",
    name: `${token}._domainkey.${options.domain}`,
    value: `${token}.dkim.amazonses.com`,
    purpose: "DKIM signing",
    required: true,
  }));

  if (options.mailFromDomain) {
    records.push({
      kind: "MX",
      name: options.mailFromDomain,
      value: `10 feedback-smtp.${options.region}.amazonses.com`,
      purpose: "Bounce return path",
      required: true,
    });
    records.push({
      kind: "TXT",
      name: options.mailFromDomain,
      value: '"v=spf1 include:amazonses.com ~all"',
      purpose: "SPF for return path",
      required: true,
    });
  }

  records.push({
    kind: "TXT",
    name: options.domain,
    value: '"v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all"',
    purpose: "SPF for SES + Cloudflare",
    required: true,
  });

  records.push({
    kind: "TXT",
    name: `_dmarc.${options.domain}`,
    value: `"v=DMARC1; p=none; rua=mailto:dmarc@${options.domain}"`,
    purpose: "DMARC policy",
    required: false,
  });

  return records;
}

/** SES status strings map onto our own enum. */
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
