CREATE TYPE "public"."subtitle_branch_status" AS ENUM('open', 'merged');--> statement-breakpoint
CREATE TABLE "subtitle_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_snapshot_id" uuid NOT NULL,
	"yjs_state" "bytea" NOT NULL,
	"status" "subtitle_branch_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"merged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "subtitle_branches" ADD CONSTRAINT "subtitle_branches_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_branches" ADD CONSTRAINT "subtitle_branches_base_snapshot_id_snapshots_id_fk" FOREIGN KEY ("base_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_branches" ADD CONSTRAINT "subtitle_branches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_branches" ADD CONSTRAINT "subtitle_branches_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subtitle_branches_episode_idx" ON "subtitle_branches" USING btree ("episode_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subtitle_branches_episode_name_idx" ON "subtitle_branches" USING btree ("episode_id","name");