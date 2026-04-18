ALTER TABLE "routine_triggers" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD COLUMN "event_filters" jsonb;