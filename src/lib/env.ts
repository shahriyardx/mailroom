function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get authSecret() {
    return required("BETTER_AUTH_SECRET");
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
  aws: {
    get region() {
      return process.env.AWS_REGION ?? "us-east-1";
    },
    get accessKeyId() {
      return process.env.AWS_ACCESS_KEY_ID ?? "";
    },
    get secretAccessKey() {
      return process.env.AWS_SECRET_ACCESS_KEY ?? "";
    },
    /** Optional: enables SES event publishing to SNS. */
    get configurationSet() {
      return process.env.SES_CONFIGURATION_SET ?? "";
    },
    /** Prefix for the custom MAIL FROM subdomain, e.g. "mail" -> mail.acme.com. */
    get mailFromPrefix() {
      return process.env.SES_MAIL_FROM_PREFIX ?? "mail";
    },
  },
  get inboundSecret() {
    return required("INBOUND_WEBHOOK_SECRET");
  },
  r2: {
    get accountId() {
      return required("R2_ACCOUNT_ID");
    },
    get accessKeyId() {
      return required("R2_ACCESS_KEY_ID");
    },
    get secretAccessKey() {
      return required("R2_SECRET_ACCESS_KEY");
    },
    get bucket() {
      return process.env.R2_BUCKET ?? "mail-attachments";
    },
  },
};
