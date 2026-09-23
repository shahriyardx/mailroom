ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "segment_id" text;
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_segment_id_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "segment"("id") ON DELETE set null;
