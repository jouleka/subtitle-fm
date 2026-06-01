CREATE UNIQUE INDEX "shows_imdb_id_idx" ON "shows" USING btree ("imdb_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shows_mal_id_idx" ON "shows" USING btree ("mal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shows_anilist_id_idx" ON "shows" USING btree ("anilist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shows_kitsu_id_idx" ON "shows" USING btree ("kitsu_id");