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
  /**
   * Where this instance answers, for the links and callbacks it hands to
   * other machines: SES subscribes to it, Cloudflare posts to it, an
   * invitation points at it.
   *
   * APP_URL is read first and is the one to set. NEXT_PUBLIC_APP_URL is
   * still honoured for installs that already set it, but it cannot be the
   * only answer: Next replaces NEXT_PUBLIC_ values at build time, so a
   * published image would have one address baked into it for everybody.
   */
  get appUrl() {
    return (
      process.env.APP_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3000"
    );
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
    /** DKIM selector for keys this app generates: <selector>._domainkey.acme.com */
    get dkimSelector() {
      return process.env.SES_DKIM_SELECTOR ?? "mail";
    },
    /** Prefix for the custom MAIL FROM subdomain, e.g. "mail" -> mail.acme.com. */
    get mailFromPrefix() {
      return process.env.SES_MAIL_FROM_PREFIX ?? "mail";
    },
  },
  /** Optional address the worker forwards every message on to. */
  get forwardTo() {
    return process.env.FORWARD_TO ?? "";
  },
  get inboundSecret() {
    return required("INBOUND_WEBHOOK_SECRET");
  },
  /**
   * Keys for the Web Push protocol, which the browser's push service uses to
   * check that a message really came from this instance.
   *
   * Optional: without a pair, desktop notifications are simply not offered.
   * `pnpm push:keys` prints one. The public half is handed to the browser on
   * purpose — it is an identifier, not a secret — while the private half signs
   * and must never leave the server.
   */
  push: {
    get publicKey() {
      return process.env.VAPID_PUBLIC_KEY ?? "";
    },
    get privateKey() {
      return process.env.VAPID_PRIVATE_KEY ?? "";
    },
    /**
     * A way to reach whoever runs this instance, which the push services ask
     * for so they have somebody to contact about a misbehaving sender.
     */
    get subject() {
      return process.env.VAPID_SUBJECT ?? "";
    },
    get configured() {
      return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    },
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
