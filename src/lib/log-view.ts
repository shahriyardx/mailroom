/**
 * The parts of the email log both sides need.
 *
 * Kept out of `server/logs.ts` because the filter bar and the table are
 * client components, and that module is server-only — importing a value
 * from it drags the database driver into the browser bundle.
 */

export type Direction = "sending" | "receiving";

export interface LogRow {
  id: string;
  threadId: string;
  subject: string;
  fromAddress: string;
  fromName: string | null;
  to: { name: string | null; address: string }[];
  deliveryStatus: string | null;
  deliveryError: string | null;
  isTest: boolean;
  openCount: number;
  at: Date;
  mailbox: string;
  mailboxColor: string;
}

export const DAY_RANGES = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "15", label: "Last 15 days" },
  { value: "30", label: "Last 30 days" },
  { value: "0", label: "All time" },
] as const;

export const SENDING_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "delayed",
  "bounced",
  "complained",
  "rejected",
  "failed",
  "canceled",
] as const;
