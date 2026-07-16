CREATE TYPE "public"."show_role" AS ENUM('tl', 'tlc', 'ed', 'ts', 'qc');--> statement-breakpoint
ALTER TYPE "public"."subtitle_branch_status" ADD VALUE 'rejected';--> statement-breakpoint
CREATE TABLE "show_role_assignments" (
	"user_id" uuid NOT NULL,
	"show_id" text NOT NULL,
	"role" "show_role" NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "show_role_assignments_user_id_show_id_pk" PRIMARY KEY("user_id","show_id")
);
--> statement-breakpoint
ALTER TABLE "subtitle_branches" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "subtitle_branches" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "show_role_assignments" ADD CONSTRAINT "show_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_role_assignments" ADD CONSTRAINT "show_role_assignments_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_role_assignments" ADD CONSTRAINT "show_role_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "show_role_assignments_show_idx" ON "show_role_assignments" USING btree ("show_id","role");--> statement-breakpoint
ALTER TABLE "subtitle_branches" ADD CONSTRAINT "subtitle_branches_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;