INSERT INTO "seasons" ("show_id", "number", "title")
SELECT DISTINCT "show_id", 1, 'Season 1'
FROM "episodes"
ON CONFLICT ("show_id", "number") DO NOTHING;--> statement-breakpoint
UPDATE "episodes" AS "episode"
SET "season_id" = "season"."id"
FROM "seasons" AS "season"
WHERE "episode"."season_id" IS NULL
  AND "season"."show_id" = "episode"."show_id"
  AND "season"."number" = 1;--> statement-breakpoint
DROP INDEX IF EXISTS "episodes_show_number_idx";--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_show_season_number_unique" UNIQUE NULLS NOT DISTINCT("show_id","season_id","number");
