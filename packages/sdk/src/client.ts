import { HttpClient, type MailroomOptions, type RequestOptions } from "./http.js";
import { Attachments } from "./resources/attachments.js";
import { Contacts } from "./resources/contacts.js";
import { Domains } from "./resources/domains.js";
import { Emails } from "./resources/emails.js";
import { Labels } from "./resources/labels.js";
import { Mailboxes } from "./resources/mailboxes.js";
import { Messages } from "./resources/messages.js";
import { StatsResource } from "./resources/stats.js";
import { Suppressions } from "./resources/suppressions.js";
import { Templates } from "./resources/templates.js";
import { Threads } from "./resources/threads.js";
import { Webhooks } from "./resources/webhooks.js";
import type { ApiKeyInfo } from "./types.js";

/**
 * A Mailroom instance, as one object.
 *
 * ```ts
 * import { Mailroom } from "@shahriyardx/mailroom";
 *
 * const mail = new Mailroom({
 *   apiKey: process.env.MAILROOM_API_KEY,
 *   baseUrl: "https://mail.example.com",
 * });
 *
 * await mail.emails.send({
 *   from: "hello@example.com",
 *   to: "someone@example.net",
 *   subject: "Hello",
 *   text: "From the SDK.",
 * });
 * ```
 *
 * Both settings fall back to `MAILROOM_API_KEY` and `MAILROOM_BASE_URL`, so
 * `new Mailroom()` is enough when the environment is set.
 */
export class Mailroom {
  /** The HTTP layer, for an endpoint this package has not wrapped yet. */
  readonly http: HttpClient;

  /** Sending mail, and reading what was sent. */
  readonly emails: Emails;
  /** Conversations: reading, filing, replying. */
  readonly threads: Threads;
  /** Individual messages, inbound and outbound. */
  readonly messages: Messages;
  /** Files that came in on a message. */
  readonly attachments: Attachments;
  /** The addresses on your domains. */
  readonly mailboxes: Mailboxes;
  /** Sending domains and their DNS. */
  readonly domains: Domains;
  /** The labels threads are filed under. */
  readonly labels: Labels;
  /** Everyone this account has corresponded with. */
  readonly contacts: Contacts;
  /** Addresses that will not be sent to again. */
  readonly suppressions: Suppressions;
  /** Saved subjects and bodies, sent by name. */
  readonly templates: Templates;
  /** Where events are sent, and what happened when they were. */
  readonly webhooks: Webhooks;
  /** How much was sent and received, and how it landed. */
  readonly stats: StatsResource;

  constructor(options: MailroomOptions = {}) {
    this.http = new HttpClient(options);
    this.emails = new Emails(this.http);
    this.threads = new Threads(this.http);
    this.messages = new Messages(this.http);
    this.attachments = new Attachments(this.http);
    this.mailboxes = new Mailboxes(this.http);
    this.domains = new Domains(this.http);
    this.labels = new Labels(this.http);
    this.contacts = new Contacts(this.http);
    this.suppressions = new Suppressions(this.http);
    this.templates = new Templates(this.http);
    this.webhooks = new Webhooks(this.http);
    this.stats = new StatsResource(this.http);
  }

  /**
   * What this key is and what it may do.
   *
   * The first call to make while wiring a client up, and the fastest way to
   * tell a missing scope from a wrong URL.
   */
  me(options?: RequestOptions): Promise<ApiKeyInfo> {
    return this.http.request<ApiKeyInfo>({ method: "GET", path: "/me", options });
  }

  /** What the rate-limit headers said on the last reply, or null before one. */
  get rateLimit() {
    return this.http.rateLimit;
  }

  /** The `…/api/v1` URL every call is made against. */
  get baseUrl() {
    return this.http.baseUrl;
  }
}
