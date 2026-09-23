ALTER TABLE "broadcast" ALTER COLUMN "mailbox_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "mailbox_id" DROP NOT NULL;
