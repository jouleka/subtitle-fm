CREATE TYPE "public"."takedown_status" AS ENUM('submitted', 'under_review', 'removed', 'rejected', 'counter_submitted', 'court_action', 'restored');--> statement-breakpoint
ALTER TYPE "public"."episode_status" ADD VALUE 'removed' BEFORE 'failed';--> statement-breakpoint
CREATE TABLE "counter_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"takedown_notice_id" uuid NOT NULL,
	"submitter_name" text NOT NULL,
	"submitter_email" text NOT NULL,
	"submitter_address" text NOT NULL,
	"submitter_phone" text NOT NULL,
	"removed_material_url" text NOT NULL,
	"signature" text NOT NULL,
	"mistake_confirmed" boolean NOT NULL,
	"jurisdiction_confirmed" boolean NOT NULL,
	"service_confirmed" boolean NOT NULL,
	"restore_eligible_at" timestamp with time zone NOT NULL,
	"restore_deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takedown_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"status" "takedown_status" DEFAULT 'submitted' NOT NULL,
	"claimant_name" text NOT NULL,
	"claimant_email" text NOT NULL,
	"claimant_address" text NOT NULL,
	"claimant_phone" text NOT NULL,
	"copyrighted_work" text NOT NULL,
	"material_url" text NOT NULL,
	"signature" text NOT NULL,
	"good_faith_confirmed" boolean NOT NULL,
	"accuracy_confirmed" boolean NOT NULL,
	"original_episode_status" "episode_status",
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counter_notices" ADD CONSTRAINT "counter_notices_takedown_notice_id_takedown_notices_id_fk" FOREIGN KEY ("takedown_notice_id") REFERENCES "public"."takedown_notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_notices" ADD CONSTRAINT "takedown_notices_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_notices" ADD CONSTRAINT "takedown_notices_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "counter_notices_takedown_notice_id_idx" ON "counter_notices" USING btree ("takedown_notice_id");--> statement-breakpoint
CREATE INDEX "counter_notices_restore_eligible_at_idx" ON "counter_notices" USING btree ("restore_eligible_at");--> statement-breakpoint
CREATE INDEX "takedown_notices_episode_id_idx" ON "takedown_notices" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "takedown_notices_status_idx" ON "takedown_notices" USING btree ("status");