CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"episode_id" uuid,
	"stage" text,
	"status" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_events_source_received_idx" ON "webhook_events" USING btree ("source","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_episode_idx" ON "webhook_events" USING btree ("episode_id");