import { relations, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Postgres tsvector, generated from subject + body for full-text search. */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const folderEnum = pgEnum("folder", ["inbox", "sent", "drafts", "archive", "spam", "trash"]);

export const domainStatusEnum = pgEnum("domain_status", [
  "pending",
  "verified",
  "failed",
  "temporary_failure",
  "not_started",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "rejected",
  "delayed",
  "failed",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "send",
  "delivery",
  "bounce",
  "complaint",
  "reject",
  "open",
  "click",
  "delivery_delay",
  "rendering_failure",
  "subscription",
]);

/* -------------------------------------------------------------------------- */
/* better-auth core tables                                                    */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Which company and team this session is acting as. */
  activeOrganizationId: text("active_organization_id"),
  activeTeamId: text("active_team_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Mail                                                                       */
/* -------------------------------------------------------------------------- */

/** An SES domain identity. Rows mirror what SES reports, refreshed on demand. */
/* -------------------------------------------------------------------------- */
/* Organisation: one company per instance, teams inside it                    */
/* -------------------------------------------------------------------------- */

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** owner, admin or member. Owner is the account that created the instance. */
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_org_user_idx").on(t.organizationId, t.userId),
    index("member_user_idx").on(t.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    teamId: text("team_id"),
    /**
     * pending    invited, link not opened
     * accepting  the link was opened and an account is being made for it
     * accepted   they are in
     *
     * Only the holder of the link can move an invitation to "accepting", and
     * only an invitation in that state may create an account. Knowing that an
     * address was invited is therefore not enough to claim the seat.
     */
    status: text("status").notNull().default("pending"),
    /** sha256 of the link's secret. The secret itself is never stored. */
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitation_email_idx").on(t.email)],
);

export const team = pgTable(
  "team",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * The team created with the instance. It reaches every domain and mailbox
     * without a grant, and cannot be deleted or stripped of that reach.
     */
    isRoot: boolean("is_root").notNull().default(false),
    /** Kept by better-auth so a team can be listed without counting rows. */
    memberCount: integer("member_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("team_org_idx").on(t.organizationId)],
);

export const teamMember = pgTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** better-auth's own uniqueness key for a membership. */
    membershipKey: text("membership_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_member_idx").on(t.teamId, t.userId)],
);

/**
 * Who may reach what. A grant attaches a team or one person to a domain or a
 * single mailbox, and says what they may do with it. A grant on a domain
 * covers every mailbox on that domain, including ones made later.
 *
 * The root team needs no rows here: it reaches everything by being the root
 * team, so an instance can never be locked away from the people running it.
 */
export const accessGrant = pgTable(
  "access_grant",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    /** "team" or "member". */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),

    /** "domain" or "mailbox". */
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),

    /** See the mail in it. */
    canRead: boolean("can_read").notNull().default(true),
    /** Send as it, and reply from it. */
    canSend: boolean("can_send").notNull().default(false),
    /** Change the mailbox itself: its name, colour and signature. */
    canManage: boolean("can_manage").notNull().default(false),
    /**
     * Create new mailboxes on this domain. Only meaningful on a domain grant,
     * and the mailboxes they make are reachable by the same grant.
     */
    canCreateMailbox: boolean("can_create_mailbox").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("access_grant_idx").on(t.subjectType, t.subjectId, t.resourceType, t.resourceId),
    index("access_grant_org_idx").on(t.organizationId),
    index("access_grant_subject_idx").on(t.subjectType, t.subjectId),
  ],
);

export const domain = pgTable(
  "domain",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    region: text("region").notNull(),

    status: domainStatusEnum("status").notNull().default("pending"),
    /** SES will only send from an identity once this is true. */
    sendingEnabled: boolean("sending_enabled").notNull().default(false),

    dkimStatus: domainStatusEnum("dkim_status").notNull().default("pending"),
    /**
     * AWS_SES for Easy DKIM, EXTERNAL when the key was supplied by whoever set
     * the domain up. The two need completely different DNS records.
     */
    dkimOrigin: text("dkim_origin"),
    /** Three CNAME tokens for Easy DKIM, or the single selector for an external key. */
    dkimTokens: text("dkim_tokens").array().notNull().default(sql`'{}'::text[]`),
    /**
     * Base64 SPKI public key, set only when this app generated the DKIM key.
     * The private half goes to SES and is never stored.
     */
    dkimPublicKey: text("dkim_public_key"),

    /** Custom MAIL FROM (return-path) subdomain, e.g. mail.acme.com. */
    mailFromDomain: text("mail_from_domain"),
    mailFromStatus: domainStatusEnum("mail_from_status"),

    /** True once our own DNS probe sees the records resolve. */
    spfVerified: boolean("spf_verified").notNull().default(false),
    dmarcVerified: boolean("dmarc_verified").notNull().default(false),

    /**
     * Set to the parent domain's name when this row is a subdomain that sends
     * on that parent's SES verification. Such a row has no identity of its
     * own, so there is nothing to verify and no records to publish.
     */
    inheritedFrom: text("inherited_from"),

    /**
     * When on, mail to an address on this domain that no mailbox claims
     * creates that mailbox instead of falling through to forwarding. Off by
     * default: it turns every spammed address into a mailbox.
     */
    autoCreateMailboxes: boolean("auto_create_mailboxes").notNull().default(false),

    /** Set when the row came from SES rather than being created here. */
    importedAt: timestamp("imported_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("domain_org_name_idx").on(t.organizationId, t.name),
    index("domain_org_idx").on(t.organizationId),
  ],
);

/** One sending/receiving identity, e.g. hello@acme.com. */
export const mailbox = pgTable(
  "mailbox",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    domain: text("domain").notNull(),
    domainId: text("domain_id").references(() => domain.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    signature: text("signature"),
    /** Catch-all mailboxes receive any unmatched address on their domain. */
    isCatchAll: boolean("is_catch_all").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    color: text("color").notNull().default("#6366f1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mailbox_address_idx").on(t.address),
    index("mailbox_org_idx").on(t.organizationId),
    index("mailbox_domain_idx").on(t.domain),
  ],
);

export const thread = pgTable(
  "thread",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    /** Every folder any message of this thread currently lives in. */
    folders: folderEnum("folders").array().notNull().default(sql`'{}'::folder[]`),
    participants: jsonb("participants")
      .$type<{ name: string | null; address: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    messageCount: integer("message_count").notNull().default(0),
    unreadCount: integer("unread_count").notNull().default(0),
    isStarred: boolean("is_starred").notNull().default(false),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("thread_mailbox_last_idx").on(t.mailboxId, t.lastMessageAt.desc()),
    index("thread_folders_idx").using("gin", t.folders),
  ],
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),

    /** RFC5322 Message-ID, used for threading and dedupe. */
    rfcMessageId: text("rfc_message_id"),
    inReplyTo: text("in_reply_to"),
    references: text("references").array().notNull().default(sql`'{}'::text[]`),

    fromName: text("from_name"),
    fromAddress: text("from_address").notNull(),
    to: jsonb("to")
      .$type<{ name: string | null; address: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    cc: jsonb("cc")
      .$type<{ name: string | null; address: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    bcc: jsonb("bcc")
      .$type<{ name: string | null; address: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    replyTo: text("reply_to"),

    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    textBody: text("text_body"),
    htmlBody: text("html_body"),

    folder: folderEnum("folder").notNull().default("inbox"),
    isRead: boolean("is_read").notNull().default(false),
    isStarred: boolean("is_starred").notNull().default(false),
    isDraft: boolean("is_draft").notNull().default(false),
    isOutbound: boolean("is_outbound").notNull().default(false),

    /** Inbound auth results, straight from the Cloudflare worker. */
    spf: text("spf"),
    dkim: text("dkim"),
    dmarc: text("dmarc"),
    spamScore: integer("spam_score"),

    /** Outbound tracking: the id SES returns for a sent message. */
    sesMessageId: text("ses_message_id"),
    deliveryStatus: deliveryStatusEnum("delivery_status"),
    deliveryError: text("delivery_error"),
    /** Set when the message came in through the public send API. */
    apiKeyId: text("api_key_id"),

    sizeBytes: integer("size_bytes").notNull().default(0),
    rawKey: text("raw_key"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(subject, '')), 'A') || setweight(to_tsvector('english', coalesce(from_address, '')), 'B') || setweight(to_tsvector('english', coalesce(text_body, '')), 'C')`,
    ),
  },
  (t) => [
    index("message_thread_idx").on(t.threadId, t.receivedAt),
    index("message_mailbox_folder_idx").on(t.mailboxId, t.folder, t.receivedAt.desc()),
    uniqueIndex("message_rfc_id_idx").on(t.mailboxId, t.rfcMessageId),
    index("message_search_idx").using("gin", t.searchVector),
    index("message_ses_id_idx").on(t.sesMessageId),
  ],
);

export const attachment = pgTable(
  "attachment",
  {
    id: text("id").primaryKey(),
    /** Null while an attachment is staged by the composer, set once sent. */
    messageId: text("message_id").references(() => message.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** Object key inside the R2 bucket. */
    r2Key: text("r2_key").notNull(),
    /** Set for images referenced by cid: in the HTML body. */
    contentId: text("content_id"),
    isInline: boolean("is_inline").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attachment_message_idx").on(t.messageId),
    index("attachment_uploader_idx").on(t.uploadedBy),
  ],
);

export const label = pgTable(
  "label",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#64748b"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("label_org_name_idx").on(t.organizationId, t.name)],
);

export const threadLabel = pgTable(
  "thread_label",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.labelId] })],
);

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    name: text("name"),
    messageCount: integer("message_count").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contact_org_address_idx").on(t.organizationId, t.address)],
);

/** Delivery feedback from SES, one row per SNS event. */
export const messageEvent = pgTable(
  "message_event",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").references(() => message.id, { onDelete: "cascade" }),
    sesMessageId: text("ses_message_id"),
    type: eventTypeEnum("type").notNull(),
    recipient: text("recipient"),
    /** Bounce subtype, complaint type, or SMTP diagnostic code. */
    detail: text("detail"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("message_event_message_idx").on(t.messageId),
    index("message_event_ses_idx").on(t.sesMessageId),
  ],
);

/** Addresses we refuse to send to again, fed by bounces and complaints. */
export const suppression = pgTable(
  "suppression",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suppression_org_address_idx").on(t.organizationId, t.address)],
);

/**
 * A connected third-party account, currently only Cloudflare.
 * The token is encrypted at rest with a key derived from BETTER_AUTH_SECRET.
 */
export const integration = pgTable(
  "integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    secret: text("secret").notNull(),
    /** Last few characters, so a token can be recognised without revealing it. */
    hint: text("hint").notNull(),
    label: text("label"),
    /** Cloudflare account the token belongs to, resolved once when connecting. */
    accountId: text("account_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integration_org_provider_idx").on(t.organizationId, t.provider)],
);

/** Keys for the public send API. Only the hash is stored. */
export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Short visible fragment, shown in the UI so keys can be told apart. */
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    /** Optional lock to a single mailbox; null means any mailbox the user owns. */
    mailboxId: text("mailbox_id").references(() => mailbox.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_key_hash_idx").on(t.hash),
    index("api_key_org_idx").on(t.organizationId),
  ],
);

/** Rules applied to inbound mail, highest priority first. */
export const filterRule = pgTable("filter_rule", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  matchFrom: text("match_from"),
  matchTo: text("match_to"),
  matchSubject: text("match_subject"),
  matchBody: text("match_body"),
  actionFolder: folderEnum("action_folder"),
  actionLabelId: text("action_label_id").references(() => label.id, { onDelete: "set null" }),
  actionMarkRead: boolean("action_mark_read").notNull().default(false),
  actionStar: boolean("action_star").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const userRelations = relations(user, ({ many }) => ({
  domains: many(domain),
  apiKeys: many(apiKey),
  mailboxes: many(mailbox),
  labels: many(label),
  contacts: many(contact),
}));

export const domainRelations = relations(domain, ({ one, many }) => ({
  organization: one(organization, {
    fields: [domain.organizationId],
    references: [organization.id],
  }),
  mailboxes: many(mailbox),
}));

export const mailboxRelations = relations(mailbox, ({ one, many }) => ({
  organization: one(organization, {
    fields: [mailbox.organizationId],
    references: [organization.id],
  }),
  domainRecord: one(domain, { fields: [mailbox.domainId], references: [domain.id] }),
  threads: many(thread),
  messages: many(message),
}));

export const threadRelations = relations(thread, ({ one, many }) => ({
  mailbox: one(mailbox, { fields: [thread.mailboxId], references: [mailbox.id] }),
  messages: many(message),
  labels: many(threadLabel),
}));

export const messageRelations = relations(message, ({ one, many }) => ({
  thread: one(thread, { fields: [message.threadId], references: [thread.id] }),
  mailbox: one(mailbox, { fields: [message.mailboxId], references: [mailbox.id] }),
  attachments: many(attachment),
}));

export const attachmentRelations = relations(attachment, ({ one }) => ({
  message: one(message, { fields: [attachment.messageId], references: [message.id] }),
}));

export const threadLabelRelations = relations(threadLabel, ({ one }) => ({
  thread: one(thread, { fields: [threadLabel.threadId], references: [thread.id] }),
  label: one(label, { fields: [threadLabel.labelId], references: [label.id] }),
}));

export const labelRelations = relations(label, ({ one, many }) => ({
  organization: one(organization, {
    fields: [label.organizationId],
    references: [organization.id],
  }),
  threads: many(threadLabel),
}));

export const messageEventRelations = relations(messageEvent, ({ one }) => ({
  message: one(message, { fields: [messageEvent.messageId], references: [message.id] }),
}));

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
  organization: one(organization, {
    fields: [apiKey.organizationId],
    references: [organization.id],
  }),
  mailbox: one(mailbox, { fields: [apiKey.mailboxId], references: [mailbox.id] }),
}));

export type Folder = (typeof folderEnum.enumValues)[number];
export type Domain = typeof domain.$inferSelect;
export type Integration = typeof integration.$inferSelect;
export type ApiKey = typeof apiKey.$inferSelect;
export type Organization = typeof organization.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Team = typeof team.$inferSelect;
export type TeamMember = typeof teamMember.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type AccessGrant = typeof accessGrant.$inferSelect;
export type DomainStatus = (typeof domainStatusEnum.enumValues)[number];
export type Mailbox = typeof mailbox.$inferSelect;
export type Thread = typeof thread.$inferSelect;
export type Message = typeof message.$inferSelect;
export type Attachment = typeof attachment.$inferSelect;
export type Label = typeof label.$inferSelect;
