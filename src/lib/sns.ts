import { createVerify } from "node:crypto";

export interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
}

const NOTIFICATION_KEYS = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
const SUBSCRIPTION_KEYS = [
  "Message",
  "MessageId",
  "SubscribeURL",
  "Timestamp",
  "Token",
  "TopicArn",
  "Type",
];

const certCache = new Map<string, string>();

/** The cert must come from an AWS SNS host, or the signature proves nothing. */
function isAwsCertUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname) &&
    url.pathname.endsWith(".pem")
  );
}

async function fetchCertificate(url: string) {
  const cached = certCache.get(url);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch the SNS certificate (${response.status})`);

  const pem = await response.text();
  certCache.set(url, pem);
  return pem;
}

function stringToSign(envelope: SnsEnvelope) {
  const keys = envelope.Type === "Notification" ? NOTIFICATION_KEYS : SUBSCRIPTION_KEYS;
  let out = "";
  for (const key of keys) {
    const value = (envelope as unknown as Record<string, string | undefined>)[key];
    if (value === undefined || value === null) continue;
    out += `${key}\n${value}\n`;
  }
  return out;
}

/** Full SNS signature check, per the AWS verification procedure. */
export async function verifySnsMessage(envelope: SnsEnvelope) {
  if (!isAwsCertUrl(envelope.SigningCertURL)) return false;

  const algorithm = envelope.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  const certificate = await fetchCertificate(envelope.SigningCertURL);

  try {
    return createVerify(algorithm)
      .update(stringToSign(envelope), "utf8")
      .verify(certificate, envelope.Signature, "base64");
  } catch {
    return false;
  }
}
