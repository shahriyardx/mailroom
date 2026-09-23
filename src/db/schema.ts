import type { EmailDesign } from "@/lib/email-blocks";
import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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
  "canceled",
]);

/**
 * Where a queued send is in its life.
 *
 * "pending" is waiting for its turn — either because SES could not take it
 * yet, or because it is not due until later. "sending" is claimed by a worker
 * and is the only state another worker must not touch.
 */
export const sendJobStatusEnum = pgEnum("send_job_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "canceled",
]);

export const listMemberStatusEnum = pgEnum("list_member_status", [
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
  /**
   * Asked to join a double opt-in list and has not clicked the link yet.
   *
   * Deliberately its own status rather than a flag beside "subscribed": every
   * query that decides who gets written to filters on this column, and a
   * boolean somewhere else is a boolean somebody forgets.
   */
  "pending",
]);

export const broadcastStatusEnum = pgEnum("broadcast_status", [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "cancelled",
]);

export const broadcastRecipientStatusEnum = pgEnum("broadcast_recipient_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

/** Whether an automation is running, and whether its author meant it to be. */
export const automationStatusEnum = pgEnum("automation_status", ["draft", "active", "paused"]);

/** Where one person is in one automation. */
export const automationRunStatusEnum = pgEnum("automation_run_status", [
  "active",
  "done",
  "stopped",
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
    /**
     * The address this person writes from unless they say otherwise. Their
     * own choice, since one default for the whole company only made sense
     * when one person owned all of it.
     */
    defaultMailboxId: text("default_mailbox_id"),
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
    /**
     * The address the invitation was sent from. Kept so that resending it
     * comes from the same place the first one did; null falls back to the
     * instance default.
     */
    fromMailboxId: text("from_mailbox_id"),
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
    /**
     * "lead" or "member", within this team only. Somebody can lead one team
     * and simply belong to another, which an organisation-wide role cannot
     * express.
     */
    role: text("role").notNull().default("member"),
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

    /**
     * When on, forwarding rules written for the whole instance skip this
     * domain. Its own rules still apply. See {@link forwardRule}.
     */
    forwardOff: boolean("forward_off").notNull().default(false),

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

    /**
     * When on, forwarding rules written for the instance or for this
     * mailbox's domain skip it. Its own rules still apply, so a mailbox can
     * be kept out of a company-wide archive copy and still forward somewhere
     * of its own. See {@link forwardRule}.
     */
    forwardOff: boolean("forward_off").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mailbox_address_idx").on(t.address),
    index("mailbox_org_idx").on(t.organizationId),
    index("mailbox_domain_idx").on(t.domain),
  ],
);

/**
 * An address inbound mail may be forwarded on to.
 *
 * Kept apart from the rules that point at it because verification belongs to
 * the address, not to any one rule: Cloudflare will not forward anywhere the
 * owner has not agreed to, it agrees once per account, and asking twice would
 * mean two emails for the same decision.
 */
export const forwardAddress = pgTable(
  "forward_address",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    /** Cloudflare's own id for the destination, needed to remove or re-ask. */
    destinationId: text("destination_id"),
    /** When Cloudflare saw the owner click the link. Null until they do. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** The last time we asked Cloudflare what it thinks of this address. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("forward_address_org_idx").on(t.organizationId, t.address),
    index("forward_address_org_only_idx").on(t.organizationId),
  ],
);

/**
 * Where a copy of inbound mail also goes.
 *
 * A rule sits at one of three widths, narrowest first: a mailbox, a domain,
 * or the whole instance, and the width is whichever of the two columns is
 * filled in. Every rule that matches a message applies, so an archive copy of
 * everything and a second copy of one mailbox can both be set up without
 * either cancelling the other. `forwardOff` on a domain or a mailbox is how
 * a narrower thing opts out of the wider ones.
 */
export const forwardRule = pgTable(
  "forward_rule",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    addressId: text("address_id")
      .notNull()
      .references(() => forwardAddress.id, { onDelete: "cascade" }),
    /** Set for a domain-wide rule. */
    domainId: text("domain_id").references(() => domain.id, { onDelete: "cascade" }),
    /** Set for a single mailbox. Neither set means the whole instance. */
    mailboxId: text("mailbox_id").references(() => mailbox.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("forward_rule_org_idx").on(t.organizationId),
    index("forward_rule_domain_idx").on(t.domainId),
    index("forward_rule_mailbox_idx").on(t.mailboxId),
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
    /**
     * Where this message sat before it was thrown away.
     *
     * Deleting overwrites `folder`, so without this there is nothing left to
     * say where a message came from — and putting a reply you wrote back into
     * the inbox is not putting it back.
     */
    previousFolder: folderEnum("previous_folder"),
    isRead: boolean("is_read").notNull().default(false),
    isStarred: boolean("is_starred").notNull().default(false),
    isDraft: boolean("is_draft").notNull().default(false),
    isOutbound: boolean("is_outbound").notNull().default(false),

    /** Inbound auth results, straight from the Cloudflare worker. */
    spf: text("spf"),
    dkim: text("dkim"),
    dmarc: text("dmarc"),
    spamScore: integer("spam_score"),

    /**
     * Who handed the message over, as against who it says it is from.
     *
     * `mailedBy` is the envelope sender's domain and `signedBy` the domain
     * that signed it with DKIM. A From header costs nothing to forge; these
     * two do not, which is why a details panel is worth showing at all.
     * `tls` records how the last hop reached us — "TLS1.3", or "none".
     */
    mailedBy: text("mailed_by"),
    signedBy: text("signed_by"),
    tls: text("tls"),

    /** Outbound tracking: the id SES returns for a sent message. */
    sesMessageId: text("ses_message_id"),
    deliveryStatus: deliveryStatusEnum("delivery_status"),
    deliveryError: text("delivery_error"),
    /**
     * When the recipient's mail client first loaded the tracking image SES
     * puts in outgoing HTML, and how many times since.
     *
     * Read it as "the message was opened, or something opened it for them":
     * Apple Mail and Gmail fetch images through their own servers, so an
     * open is evidence of delivery, not proof anybody read it.
     */
    openedAt: timestamp("opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    /** Set when the message came in through the public send API. */
    apiKeyId: text("api_key_id"),
    /**
     * When a scheduled message is due to go out. Null for anything sent, or
     * attempted, the moment it was written.
     */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    /**
     * Written by a test key, which never reaches SES. Kept out of the normal
     * lists and counts: a test send that showed up beside real mail would make
     * every number a question.
     */
    isTest: boolean("is_test").notNull().default(false),

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
    index("message_scheduled_idx").on(t.scheduledAt),
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
    /**
     * The old single lock. Kept so a row written by an earlier version still
     * means something, and still read when the two lists below are empty.
     * Nothing new is written here.
     */
    mailboxId: text("mailbox_id").references(() => mailbox.id, { onDelete: "cascade" }),
    /**
     * What the key may reach, as named addresses and whole domains.
     *
     * A domain covers every address on it, including ones made later, which
     * is what somebody means by "this key handles support mail". Naming
     * addresses instead covers exactly those. Both empty means the whole
     * account, which is what a key with nothing chosen has always meant.
     */
    scopeMailboxIds: text("scope_mailbox_ids").array().notNull().default(sql`'{}'::text[]`),
    scopeDomainIds: text("scope_domain_ids").array().notNull().default(sql`'{}'::text[]`),
    /**
     * What the key may do. A key holding "*" may do everything, which is what
     * every key made before scopes existed was already able to do.
     *
     * A lock to one mailbox narrows this further: a scope says which kinds of
     * call are allowed, the lock says which mail they may touch.
     */
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    /**
     * "live" or "test". A test key runs the whole send path — the mailbox
     * check, the blocked list, building the MIME, the webhooks — and stops
     * short of handing anything to SES, so nothing leaves the building.
     */
    mode: text("mode").notNull().default("live"),
    /** Requests per minute. Null falls back to the instance default. */
    rateLimit: integer("rate_limit"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_key_hash_idx").on(t.hash),
    index("api_key_org_idx").on(t.organizationId),
  ],
);

/**
 * Whether one reader lets one sender's remote images load.
 *
 * Per person rather than per company: fetching a remote image tells the sender
 * that somebody opened the message, and which somebody is not a colleague's to
 * decide. A row exists only once a choice has been made — no row means the
 * default, which is that images stay blocked.
 */
export const imageTrust = pgTable(
  "image_trust",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The From address, lowercased. */
    sender: text("sender").notNull(),
    allowed: boolean("allowed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("image_trust_user_sender_idx").on(t.userId, t.sender)],
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
/* Public API: webhooks and idempotency                                       */
/* -------------------------------------------------------------------------- */

/**
 * Somewhere to send what happens to mail, so an application does not have to
 * poll for it. One row is one endpoint; which events it wants is a list of
 * names rather than a column each, because the set grows.
 */
export const webhook = pgTable(
  "webhook",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    description: text("description"),
    /** Event names this endpoint wants; ["*"] means all of them. */
    events: text("events").array().notNull().default(sql`'{}'::text[]`),
    /**
     * Shared secret the signature header is computed with. Shown in full to
     * whoever made the endpoint, since they need it to verify us; it grants
     * nothing on its own.
     */
    secret: text("secret").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * What this endpoint hears about. At most one of these is set; both null
     * means the whole account.
     *
     * A domain is the useful middle: an account that sends for several
     * domains usually wants one endpoint per domain, and pinning per mailbox
     * meant making a new endpoint every time a mailbox was added.
     */
    mailboxId: text("mailbox_id").references(() => mailbox.id, { onDelete: "cascade" }),
    domainId: text("domain_id").references(() => domain.id, { onDelete: "cascade" }),
    /** Rolling health, so a broken endpoint can be spotted without reading deliveries. */
    lastStatus: integer("last_status"),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_org_idx").on(t.organizationId),
    index("webhook_domain_idx").on(t.domainId),
  ],
);

/** One attempt at calling an endpoint, kept so a failure can be read and replayed. */
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** How many times we have tried, including the one this row records. */
    attempt: integer("attempt").notNull().default(1),
    statusCode: integer("status_code"),
    /** First part of the response body, enough to see what an endpoint complained about. */
    responseBody: text("response_body"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    succeeded: boolean("succeeded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_delivery_hook_idx").on(t.webhookId, t.createdAt.desc()),
    index("webhook_delivery_org_idx").on(t.organizationId, t.createdAt.desc()),
  ],
);

/**
 * The answer a request with an Idempotency-Key already got. A network that
 * drops the reply must not turn one send into two, and the only way to know
 * a repeat from a new request is to remember what was said the first time.
 */
export const idempotencyRecord = pgTable(
  "idempotency_record",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** sha256 of the body, so the same key with different content is refused. */
    requestHash: text("request_hash").notNull(),
    endpoint: text("endpoint").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idempotency_org_key_idx").on(t.organizationId, t.key),
    index("idempotency_created_idx").on(t.createdAt),
  ],
);

/**
 * A message waiting to be handed to SES.
 *
 * Two things put a row here: a send SES could not take right now, and a send
 * that is not due until later. Both are the same problem — a message that
 * exists and has not gone out — so both are the same table, and the worker
 * cannot tell them apart.
 *
 * The built MIME is kept here rather than rebuilt on each attempt. Rebuilding
 * would mean reading the attachments back out of R2 every time, and would
 * quietly change the message if a mailbox were renamed between attempts.
 */
export const sendJob = pgTable(
  "send_job",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),

    fromAddress: text("from_address").notNull(),
    /** Every envelope recipient: to, cc and bcc together. */
    recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`),
    /** The finished message, base64 so the bytes survive the round trip. */
    rawMime: text("raw_mime").notNull(),

    status: sendJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    /** Not before this. A scheduled send starts with its own send time here. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** When a worker claimed it, so a worker that died can be noticed. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The claim query's only filter, in its own order.
    index("send_job_due_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("send_job_message_idx").on(t.messageId),
    index("send_job_org_idx").on(t.organizationId),
  ],
);

/**
 * A saved subject and body with holes in it, filled in per send.
 *
 * The point is that the wording lives here rather than inside whatever service
 * calls the API: changing a receipt should not need a deploy, and the same
 * receipt should read the same whichever service sent it.
 */
/**
 * Files an account has uploaded to use in its own mail.
 *
 * An image in an email is fetched from the open internet by whoever opens the
 * message, days later, from a machine that has never heard of this instance.
 * So these are served by id from a route that asks nobody to log in — the id
 * is the only thing standing between a file and a stranger, which is why it
 * is a random one rather than a number or a name.
 */
export const media = pgTable(
  "media",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** Object key inside the R2 bucket. */
    r2Key: text("r2_key").notNull(),
    /** Known for an image, so the builder can size it without loading it. */
    width: integer("width"),
    height: integer("height"),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_org_idx").on(t.organizationId, t.createdAt)],
);

export const template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** What a person calls it. */
    name: text("name").notNull(),
    /** What a program calls it: stable, lowercase, unique in the account. */
    slug: text("slug").notNull(),
    description: text("description"),
    subject: text("subject").notNull().default(""),
    html: text("html"),
    text: text("text"),
    /**
     * The blocks the builder edits, when the template was built rather than
     * pasted. `html` stays the source of truth for sending — it is generated
     * from this on every save — so a template written straight in HTML, or by
     * the API, needs no design at all and still works.
     */
    design: jsonb("design").$type<EmailDesign>(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_slug_idx").on(t.organizationId, t.slug),
    index("template_org_idx").on(t.organizationId),
  ],
);

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
export type Workspace = typeof workspace.$inferSelect;
export type MailingList = typeof mailingList.$inferSelect;
export type ListMember = typeof listMember.$inferSelect;
export type Broadcast = typeof broadcast.$inferSelect;
export type BroadcastRecipient = typeof broadcastRecipient.$inferSelect;
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
export type Contact = typeof contact.$inferSelect;
export type Suppression = typeof suppression.$inferSelect;
export type FilterRule = typeof filterRule.$inferSelect;
export type MessageEvent = typeof messageEvent.$inferSelect;
export type Webhook = typeof webhook.$inferSelect;
export type WebhookDelivery = typeof webhookDelivery.$inferSelect;
export type SendJob = typeof sendJob.$inferSelect;
export type SendJobStatus = (typeof sendJobStatusEnum.enumValues)[number];
export type DeliveryStatus = (typeof deliveryStatusEnum.enumValues)[number];
export type Template = typeof template.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Segment = typeof segment.$inferSelect;
export type BroadcastStatus = (typeof broadcastStatusEnum.enumValues)[number];
export type Automation = typeof automation.$inferSelect;
export type AutomationNode = typeof automationNode.$inferSelect;
export type AutomationNodeKind = (typeof automationNodeKindEnum.enumValues)[number];
export type AutomationStatus = (typeof automationStatusEnum.enumValues)[number];
/** What starts an automation: joining its list, or an event you post. */
export type AutomationTrigger = "subscribed" | "event";
export type CustomEvent = typeof customEvent.$inferSelect;
export type ListMemberStatus = (typeof listMemberStatusEnum.enumValues)[number];

/**
 * How one person likes the app to look. Kept per user rather than per member,
 * so the same choices follow them into every organisation and onto every
 * device they sign in from.
 */
/**
 * What this instance is, and what it looks like.
 *
 * One row per organisation, which for a self-hosted instance means one row.
 * It exists because two different products live in this codebase — a team's
 * mailboxes, and a marketing list — and an instance that only wants one of
 * them should not have to look at the other's navigation to find out.
 *
 * Both switches can be on. An either/or would force a company that wants team
 * mail and a newsletter to run two instances, which is a worse product and a
 * harder thing to sell.
 *
 * `setupCompletedAt` is what the first-run wizard stamps. Null means nobody
 * has finished it, which is how a fresh instance knows to ask rather than
 * dropping somebody into an empty inbox with no idea what to press.
 */
export const workspace = pgTable("workspace", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),

  /** Mailboxes, threads, filters, the extension. */
  inboxEnabled: boolean("inbox_enabled").notNull().default(true),
  /** Lists, broadcasts, unsubscribe. */
  campaignsEnabled: boolean("campaigns_enabled").notNull().default(false),

  /*
   * Branding, all optional. Empty means fall back to the organisation's own
   * name and the stock palette, so an instance that skips this step still
   * looks deliberate rather than half-filled.
   */
  brandName: text("brand_name"),
  brandLogo: text("brand_logo"),
  brandAccent: text("brand_accent"),

  /**
   * Where the company actually is, printed at the foot of every campaign.
   *
   * Not decoration and not optional in practice. US CAN-SPAM requires a valid
   * physical postal address in commercial mail, and Gmail's bulk sender rules
   * lean on the same thing. Left empty, campaigns still send — this app is not
   * the right place to block somebody's work — but every campaign screen says
   * so, because the alternative is finding out from a regulator.
   */
  postalAddress: text("postal_address"),

  /** Null until the first-run wizard is finished. */
  setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Campaigns                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * People who agreed to hear from you, grouped.
 *
 * Deliberately not the `contact` table. That one is an address book built by
 * watching mail go past — a row there means somebody wrote to you once, which
 * is not consent to be sent a newsletter. Confusing the two is how an
 * instance ends up mailing everyone who ever sent it a support request.
 */
export const mailingList = pgTable(
  "mailing_list",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),

    /**
     * Make people confirm by email before they count as subscribed.
     *
     * Off by default because turning it on halves the size of a list, and
     * that has to be somebody's decision rather than a surprise. On, it is
     * the single best protection against a rival typing a stranger's address
     * into your signup form — and against the spam complaint that follows.
     */
    doubleOptIn: boolean("double_opt_in").notNull().default(false),
    /** Whether the hosted signup page for this list answers at all. */
    publicSignup: boolean("public_signup").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mailing_list_org_idx").on(t.organizationId)],
);

/**
 * One person on one list.
 *
 * `status` is per list, not per person: unsubscribing from the newsletter must
 * not remove somebody from the release notes they also asked for.
 *
 * `consentSource` and `consentAt` are not decoration. Somebody will eventually
 * ask why they are being emailed, and an answer of "we do not record that" is
 * both a bad answer and, under GDPR, the wrong one.
 */
export const listMember = pgTable(
  "list_member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    listId: text("list_id")
      .notNull()
      .references(() => mailingList.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    name: text("name"),
    /** Whatever else you want to merge into a subject or body. */
    fields: jsonb("fields").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    /**
     * Labels on a person: "customer", "webinar-march", "vip".
     *
     * A list apart from `fields` because they answer different questions. A
     * field is a value — one plan, one city — and a tag is a set somebody is
     * either in or out of, which is what an automation adds and removes and
     * what a segment asks about.
     */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),

    status: listMemberStatusEnum("status").notNull().default("subscribed"),
    /** Free text: "imported from mailchimp", "signup form", "added by hand". */
    consentSource: text("consent_source"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    /** When they clicked the confirmation link, on a double opt-in list. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("list_member_list_address_idx").on(t.listId, t.address),
    index("list_member_org_idx").on(t.organizationId),
    // Asked by every segment rule about a tag, which is a containment test
    // over an array — the one thing a plain btree index cannot answer.
    index("list_member_tags_idx").using("gin", t.tags),
    // The send query: everyone on this list who may still be written to.
    index("list_member_sendable_idx").on(t.listId, t.status),
  ],
);

/**
 * A saved question about a list, not a copy of one.
 *
 * Rules are stored and run at send time rather than a membership table being
 * kept up to date. A segment is only ever read to decide an audience, and an
 * answer worked out at that moment is the correct one — a stored membership
 * is a thing that silently goes stale and mails the wrong people.
 *
 * The rules themselves are deliberately a small language. Everything here can
 * be answered by one SQL query over the list and its sends, which is what
 * keeps a segment of fifty thousand people from being fifty thousand round
 * trips.
 */
export const segment = pgTable(
  "segment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    listId: text("list_id")
      .notNull()
      .references(() => mailingList.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Meet every rule, or any one of them. */
    matchAll: boolean("match_all").notNull().default(true),
    rules: jsonb("rules").$type<SegmentRule[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("segment_list_idx").on(t.listId), index("segment_org_idx").on(t.organizationId)],
);

/**
 * One condition in a segment.
 *
 * `field` names either a column on the member, a merge field under
 * `fields.<name>`, or one of the engagement questions answered from the
 * broadcast tables. `value` is always text; the query casts it where it has
 * to, so a rule written by a form and a rule written by the API are the same
 * shape.
 */
export interface SegmentRule {
  field: string;
  op:
    | "is"
    | "is_not"
    | "contains"
    | "not_contains"
    | "set"
    | "not_set"
    | "before"
    | "after"
    | "opened"
    | "not_opened"
    | "clicked"
    | "not_clicked"
    /** Tags: a set somebody is in or out of, rather than a value to compare. */
    | "has"
    | "not_has";
  value: string;
}

/** One message, written once, sent to everybody on a list. */
export const broadcast = pgTable(
  "broadcast",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    listId: text("list_id")
      .notNull()
      .references(() => mailingList.id, { onDelete: "cascade" }),
    /** Which address it comes from; also what decides the sending domain. */
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),

    /** Narrows the list to part of it. Null means everybody on the list. */
    segmentId: text("segment_id").references(() => segment.id, { onDelete: "set null" }),
    /**
     * The campaign this one is a second attempt at.
     *
     * Set by "send again to the people who did not open it". The audience is
     * then taken from that campaign's own recipients rather than the list, so
     * somebody who joined in between is not included — they were never given
     * the first one, and a follow-up to a mail you never got is nonsense.
     */
    resendOfId: text("resend_of_id").references((): AnyPgColumn => broadcast.id, {
      onDelete: "set null",
    }),

    subject: text("subject").notNull(),
    /**
     * The other subject line, when this campaign is testing two.
     *
     * Null is the ordinary case. Set, the audience is split in half by a
     * stable hash of the recipient id, so the same person always lands on the
     * same side and the two halves are the same size every time.
     */
    subjectB: text("subject_b"),
    html: text("html"),
    text: text("text"),
    /** The blocks, when the body was built rather than pasted. See `template`. */
    design: jsonb("design").$type<EmailDesign>(),

    status: broadcastStatusEnum("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("broadcast_org_idx").on(t.organizationId),
    // The runner's only filter: what is due to go out.
    index("broadcast_due_idx").on(t.status, t.scheduledAt),
  ],
);

/**
 * One person's copy of one broadcast.
 *
 * The row is written before anything is sent, which is what makes a broadcast
 * resumable: a process that dies halfway leaves every unsent recipient still
 * "pending", and starting again picks up exactly those.
 *
 * It also freezes the audience. A broadcast that read the list as it went
 * would send to somebody who subscribed during the send and skip somebody who
 * left, and neither is explicable afterwards.
 */
export const broadcastRecipient = pgTable(
  "broadcast_recipient",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    broadcastId: text("broadcast_id")
      .notNull()
      .references(() => broadcast.id, { onDelete: "cascade" }),
    listMemberId: text("list_member_id")
      .notNull()
      .references(() => listMember.id, { onDelete: "cascade" }),
    /** Copied rather than joined: where it actually went, even if the row changes later. */
    address: text("address").notNull(),

    status: broadcastRecipientStatusEnum("status").notNull().default("pending"),
    /** The message row this became, for delivery events and the email log. */
    messageId: text("message_id").references(() => message.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    /** First click on anything in the message. The links are in `broadcast_click`. */
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    /** When this copy is what made them leave, which is the number that matters. */
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    /** "a" or "b" — which subject line this copy was sent under. */
    variant: text("variant").$type<"a" | "b">().notNull().default("a"),
  },
  (t) => [
    uniqueIndex("broadcast_recipient_unique_idx").on(t.broadcastId, t.listMemberId),
    // The claim query: who on this broadcast has not been sent to yet.
    index("broadcast_recipient_pending_idx").on(t.broadcastId, t.status),
    index("broadcast_recipient_org_idx").on(t.organizationId),
  ],
);

/**
 * One link, in one campaign, clicked by one person.
 *
 * A row per person per URL rather than per click. The question a report has
 * to answer is "how many people clicked this link", and a table that counts
 * every click answers a different one — a newsletter forwarded round an
 * office turns into hundreds of rows for one reader. The repeats are still
 * counted, in `clicks`, for whoever wants them.
 *
 * SES does the link rewriting, which is why nothing here is a redirect of our
 * own. A tracking redirect is a domain that has to stay up forever or every
 * link in every email ever sent breaks.
 */
export const broadcastClick = pgTable(
  "broadcast_click",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    broadcastId: text("broadcast_id")
      .notNull()
      .references(() => broadcast.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => broadcastRecipient.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    clicks: integer("clicks").notNull().default(1),
    firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("broadcast_click_unique_idx").on(t.recipientId, t.url),
    index("broadcast_click_broadcast_idx").on(t.broadcastId),
  ],
);

/**
 * A series of emails, sent on a clock rather than on a day somebody chose.
 *
 * The difference from a campaign is who decides when. A campaign goes out to
 * everybody at once; an automation starts when one person does something, so
 * the third message lands three days after *their* signup, not three days
 * after somebody pressed send.
 *
 * Deliberately narrow. One trigger, a straight line of steps, no branching.
 * A welcome series is what almost everybody actually wants, and a visual
 * flowchart builder is a product of its own.
 */
export const automation = pgTable(
  "automation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * The list this flow's people live on.
     *
     * Null until a trigger has been chosen, which is why it is nullable: an
     * automation is made empty and answers "what starts this" on the canvas,
     * the same way it answers "what happens next" there.
     */
    listId: text("list_id").references(() => mailingList.id, { onDelete: "cascade" }),
    /** One from-address for the whole series: a welcome note and its follow-up
        arriving from two different people reads as two different companies. */
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /**
     * What starts it, and null while nobody has said.
     *
     * "subscribed" is the list itself: joining is the event. "event" is one
     * your own code posts to the API, which is the difference between a
     * welcome series and everything else a product wants to say — a trial
     * ending, an order shipping, a card that failed.
     */
    trigger: text("trigger").$type<AutomationTrigger>(),
    /** Which event starts it. Only meaningful when `trigger` is "event". */
    eventName: text("event_name"),
    /**
     * Narrows who the trigger applies to, or null for everybody on the list.
     *
     * Asked at the moment somebody would be enrolled rather than stored as a
     * membership, so a flow aimed at "people on the pro plan" is right on the
     * day it runs rather than on the day the segment was written. Set null if
     * the segment is deleted: narrower-than-intended is the wrong way for
     * this to fail.
     */
    segmentId: text("segment_id").references(() => segment.id, { onDelete: "set null" }),
    status: automationStatusEnum("status").notNull().default("draft"),
    /** Where the flow starts. Null on a canvas nobody has put anything on yet. */
    entryNodeId: text("entry_node_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("automation_org_idx").on(t.organizationId),
    index("automation_list_idx").on(t.listId, t.status),
    // What an arriving event looks up, and the only query on the hot path of
    // somebody's checkout finishing.
    index("automation_event_idx").on(t.organizationId, t.eventName, t.status),
  ],
);

/**
 * An event this account's own code can post.
 *
 * A row per name rather than a free-for-all, for one reason: a typo in a
 * string sent from a server somewhere is invisible. Registered, the editor
 * can offer the name in a list, and an event that arrives under a name
 * nobody declared still lands here — marked as undeclared — so "why did my
 * flow not run" is answerable by looking rather than by guessing.
 *
 * What arrived last is kept, whole, because the first question after "did it
 * arrive" is always "with what in it".
 */
export const customEvent = pgTable(
  "custom_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Lowercase, dots and dashes. Normalised on the way in. */
    name: text("name").notNull(),
    description: text("description"),
    /** False when the name arrived from the API before anybody declared it. */
    declared: boolean("declared").notNull().default(true),
    seenCount: integer("seen_count").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** The last body posted under this name, for working out what went wrong. */
    lastPayload: jsonb("last_payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("custom_event_name_idx").on(t.organizationId, t.name)],
);

/** What one node in a flow does. */
export const automationNodeKindEnum = pgEnum("automation_node_kind", [
  "email",
  "wait",
  "condition",
  "field",
  "tag",
  "move",
  "unsubscribe",
]);

/**
 * What a condition asks, and what an operation writes.
 *
 * Kept as one loose shape rather than a column per node kind: four of the
 * five kinds use none of it, and a table with eleven mostly-null columns is
 * a table nobody can read.
 */
export interface NodeConfig {
  /** condition: what it looks at. */
  test?: "opened" | "clicked" | "field" | "tag" | "segment" | "list";
  /** condition (test "segment"): which segment they must match. */
  segmentId?: string;
  /** condition (test "field") and field: which merge field. */
  field?: string;
  /** condition (test "field"): how to compare. */
  op?: "is" | "is_not" | "contains" | "set" | "not_set";
  /** condition: what to compare against. field: what to write. */
  value?: string;
  /** tag: whether it goes on or comes off. */
  tagAction?: "add" | "remove";
  /** tag, and condition (test "tag"): which one. */
  tag?: string;
  /** move: whether they stay on this list as well. */
  listAction?: "copy" | "move";
  /** move: where they go. */
  listId?: string;
}

/**
 * One box on the canvas.
 *
 * A graph rather than a list, because the interesting half of an automation
 * is what happens differently to the people who did not open the first email.
 * `next` is the ordinary way out; `nextElse` is the second way out of a
 * condition and is null on every other kind.
 *
 * Branches never rejoin. That is a deliberate limit, not an oversight: a
 * single predecessor per node is what makes the canvas a tree, and a tree is
 * what can be laid out automatically. Nobody has to drag a box to keep the
 * picture readable, and no node can be orphaned off the side of the screen.
 */
export const automationNode = pgTable(
  "automation_node",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    kind: automationNodeKindEnum("kind").notNull(),

    /* An email's own body, in the same columns everything else here uses, so
       the builder compiles a design the same way for all three documents. */
    subject: text("subject"),
    html: text("html"),
    text: text("text"),
    design: jsonb("design").$type<EmailDesign>(),

    /** Minutes a "wait" node holds somebody for. */
    delayMinutes: integer("delay_minutes").notNull().default(0),
    /**
     * A moment to hold everybody until, instead of a length of time.
     *
     * The difference matters more than it looks. A delay is measured from
     * each person's own arrival, so a hundred people reach the next box at a
     * hundred different times. A date is the same instant for all of them,
     * which is what "announce it on Tuesday morning" means — however long ago
     * each of them joined.
     *
     * Null means the delay above is used. Both are kept rather than one being
     * overwritten, so switching between them does not lose what was set.
     */
    waitUntil: timestamp("wait_until", { withTimezone: true }),
    config: jsonb("config").$type<NodeConfig>().notNull().default(sql`'{}'::jsonb`),

    next: text("next").references((): AnyPgColumn => automationNode.id, { onDelete: "set null" }),
    /** The "no" way out of a condition. Null on everything else. */
    nextElse: text("next_else").references((): AnyPgColumn => automationNode.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("automation_node_automation_idx").on(t.automationId)],
);

/**
 * One person's journey through one automation.
 *
 * `nextAt` is the whole scheduler: the runner asks for runs that are active
 * and due, and nothing else. That means a series with a two-week gap costs
 * nothing to wait — there is no timer per person, only a row with a date.
 *
 * Unique per member per automation, so re-subscribing does not start a second
 * copy of the welcome series while the first is still running.
 */
export const automationRun = pgTable(
  "automation_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    automationId: text("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    listMemberId: text("list_member_id")
      .notNull()
      .references(() => listMember.id, { onDelete: "cascade" }),

    /**
     * The node this run is sitting on.
     *
     * A pointer rather than an index, because a branch has no index: two
     * people at the same depth in the same automation can be on completely
     * different nodes, which is the entire point of a condition.
     */
    nodeId: text("node_id"),
    status: automationRunStatusEnum("status").notNull().default("active"),
    /** When that step is due. The runner's only filter. */
    nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    stoppedReason: text("stopped_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("automation_run_unique_idx").on(t.automationId, t.listMemberId),
    index("automation_run_due_idx").on(t.status, t.nextAt),
  ],
);

export const preference = pgTable("preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** "system" follows the device; the other two override it. */
  theme: text("theme").$type<"system" | "light" | "dark">().notNull().default("dark"),
  density: text("density").$type<"comfortable" | "compact">().notNull().default("comfortable"),
  /** Side by side, or one thing at a time with a way back. */
  readingLayout: text("reading_layout").$type<"split" | "stacked">().notNull().default("split"),
  navCollapsed: boolean("nav_collapsed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One browser that has agreed to be told when mail arrives.
 *
 * A row per browser rather than per person: somebody signed in on a laptop and
 * a phone has two, and turning it off on one must leave the other alone. The
 * endpoint is the push service's own address for that browser, which is what
 * makes it the natural key — a browser that re-subscribes gets the same one
 * back, and re-registering must update a row rather than grow a second.
 *
 * The keys are the browser's half of the encryption: everything sent is
 * encrypted to them, so the push service in the middle carries a payload it
 * cannot read.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Roughly which browser, so two devices can be told apart in a list. */
    label: text("label"),
    /**
     * Consecutive failures. A push service that says the subscription is gone
     * gets the row deleted outright; this counts the softer failures, so one
     * that has stopped answering is eventually dropped rather than retried
     * forever.
     */
    failures: integer("failures").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("push_subscription_endpoint_idx").on(t.endpoint),
    index("push_subscription_user_idx").on(t.userId),
  ],
);

export type PushSubscription = typeof pushSubscription.$inferSelect;
