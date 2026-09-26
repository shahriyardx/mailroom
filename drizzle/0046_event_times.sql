-- Opens, clicks, delays and unsubscribes were stamped with the message's send
-- time. Their own time is in the payload SES sent, so it is read back from there.
UPDATE "message_event" SET "occurred_at" = ("payload"->'open'->>'timestamp')::timestamptz
WHERE "type" = 'open' AND "payload"->'open'->>'timestamp' IS NOT NULL;
--> statement-breakpoint
UPDATE "message_event" SET "occurred_at" = ("payload"->'click'->>'timestamp')::timestamptz
WHERE "type" = 'click' AND "payload"->'click'->>'timestamp' IS NOT NULL;
--> statement-breakpoint
UPDATE "message_event" SET "occurred_at" = ("payload"->'deliveryDelay'->>'timestamp')::timestamptz
WHERE "type" = 'delivery_delay' AND "payload"->'deliveryDelay'->>'timestamp' IS NOT NULL;
--> statement-breakpoint
UPDATE "message_event" SET "occurred_at" = ("payload"->'subscription'->>'timestamp')::timestamptz
WHERE "type" = 'subscription' AND "payload"->'subscription'->>'timestamp' IS NOT NULL;
--> statement-breakpoint
-- The first open on a message had the same mistake.
UPDATE "message" AS m SET "opened_at" = e.first
FROM (
  SELECT "message_id", min("occurred_at") AS first FROM "message_event"
  WHERE "type" = 'open' AND "message_id" IS NOT NULL GROUP BY "message_id"
) AS e
WHERE m."id" = e."message_id" AND m."opened_at" IS NOT NULL;
