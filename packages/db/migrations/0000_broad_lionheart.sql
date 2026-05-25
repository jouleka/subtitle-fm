CREATE TYPE "public"."user_role" AS ENUM('anon', 'editor', 'translator', 'reviewer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('uploaded', 'preprocessing', 'transcribing', 'translating', 'ready_for_edit', 'in_review', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."glossary_kind" AS ENUM('name', 'place', 'term', 'attack', 'honorific');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text,
	"handle" text NOT NULL,
	"email" text,
	"reputation" integer DEFAULT 0 NOT NULL,
	"role" "user_role" DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"mal_id" text,
	"anilist_id" text,
	"kitsu_id" text,
	"cover_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"source_language" text DEFAULT 'ja' NOT NULL,
	"target_language" text DEFAULT 'en' NOT NULL,
	"status" "episode_status" DEFAULT 'uploaded' NOT NULL,
	"audio_url" text,
	"peaks_url" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"raw_override_tags" text DEFAULT '' NOT NULL,
	"style_name" text DEFAULT 'Default' NOT NULL,
	"speaker_id" text,
	"confidence" double precision,
	"needs_review" boolean DEFAULT false NOT NULL,
	"last_edited_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" text NOT NULL,
	"source_text" text NOT NULL,
	"target_text" text NOT NULL,
	"kind" "glossary_kind" DEFAULT 'term' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"label" text NOT NULL,
	"yjs_state" "bytea" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cues" ADD CONSTRAINT "cues_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cues" ADD CONSTRAINT "cues_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_discord_id_idx" ON "users" USING btree ("discord_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_idx" ON "users" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "shows_slug_idx" ON "shows" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "episodes_show_number_idx" ON "episodes" USING btree ("show_id","number");--> statement-breakpoint
CREATE INDEX "episodes_status_idx" ON "episodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cues_episode_order_idx" ON "cues" USING btree ("episode_id","order_index");--> statement-breakpoint
CREATE INDEX "cues_episode_start_idx" ON "cues" USING btree ("episode_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_show_source_idx" ON "glossary_terms" USING btree ("show_id","source_text");--> statement-breakpoint
CREATE INDEX "snapshots_episode_idx" ON "snapshots" USING btree ("episode_id","created_at");