DROP INDEX "episodes_show_number_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_show_number_idx" ON "episodes" USING btree ("show_id","number");