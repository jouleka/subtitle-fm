CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"cue_id" uuid NOT NULL,
	"user_id" uuid,
	"field_changed" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_episode_ts_idx" ON "audit_log" USING btree ("episode_id","ts");--> statement-breakpoint
CREATE INDEX "audit_log_episode_cue_ts_idx" ON "audit_log" USING btree ("episode_id","cue_id","ts");