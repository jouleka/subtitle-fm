import { describe, expect, test } from "bun:test";
import { applyMediaTemplate, slugify, resolveShowFromMal, type FetchJson } from "./resolve";

describe("applyMediaTemplate", () => {
  const vars = { number: 1, slug: "show-x", malId: "42" };

  test("substitutes {number}, {slug}, {malId}", () => {
    expect(applyMediaTemplate("https://cdn/{slug}/{malId}/ep{number}.mkv", vars)).toBe(
      "https://cdn/show-x/42/ep1.mkv",
    );
  });

  test("zero-pads {number:02} / {number:03}", () => {
    expect(applyMediaTemplate("ep{number:02}.mkv", { ...vars, number: 1 })).toBe("ep01.mkv");
    expect(applyMediaTemplate("ep{number:03}.mkv", { ...vars, number: 7 })).toBe("ep007.mkv");
    expect(applyMediaTemplate("ep{number:02}.mkv", { ...vars, number: 10 })).toBe("ep10.mkv");
  });

  test("throws when the template has no {number} (intent: every episode needs a distinct URL)", () => {
    expect(() => applyMediaTemplate("https://cdn/{slug}.mkv", vars)).toThrow();
  });
});

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Cowboy Bebop")).toBe("cowboy-bebop");
  });
  test("strips punctuation and collapses separators", () => {
    expect(slugify("Fullmetal Alchemist: Brotherhood!!")).toBe("fullmetal-alchemist-brotherhood");
  });
  test("returns empty string for non-latin input (caller supplies a fallback)", () => {
    expect(slugify("進撃の巨人")).toBe("");
  });
});

// Fake Jikan matching the real v4 shape (verified live):
//   /anime/{id}            -> { data: { mal_id, title, title_english, episodes } }
//   /anime/{id}/episodes   -> { data: [{ mal_id, title }], pagination: { has_next_page } }
function fakeJikan(opts: {
  title?: string;
  titleEnglish?: string | null;
  episodesCount?: number | null;
  pages?: Array<Array<{ mal_id: number; title: string }>>;
}): FetchJson {
  const pages = opts.pages ?? [];
  return async (url: string) => {
    if (url.includes("/episodes")) {
      const m = url.match(/[?&]page=(\d+)/);
      const page = m ? Number(m[1]) : 1;
      const data = pages[page - 1] ?? [];
      return { data, pagination: { has_next_page: page < pages.length, last_visible_page: pages.length } };
    }
    return {
      data: {
        mal_id: 1,
        title: opts.title ?? "Cowboy Bebop",
        title_english: opts.titleEnglish === undefined ? "Cowboy Bebop" : opts.titleEnglish,
        episodes: opts.episodesCount === undefined ? 26 : opts.episodesCount,
      },
    };
  };
}

describe("resolveShowFromMal", () => {
  const tmpl = "https://cdn.example.com/{slug}/ep{number:02}.mkv";

  test("builds a CatalogShow from the episode list with templated media URLs", async () => {
    const fetchJson = fakeJikan({
      pages: [[{ mal_id: 1, title: "Asteroid Blues" }, { mal_id: 2, title: "Stray Dog Strut" }]],
    });
    const show = await resolveShowFromMal(1, tmpl, { fetchJson });
    expect(show.id).toBe("mal-1");
    expect(show.title).toBe("Cowboy Bebop");
    expect(show.slug).toBe("cowboy-bebop");
    expect(show.malId).toBe("1");
    expect(show.episodes.length).toBe(2);
    expect(show.episodes[0]).toMatchObject({
      number: 1,
      title: "Asteroid Blues",
      sourceUrl: "https://cdn.example.com/cowboy-bebop/ep01.mkv",
    });
    expect(show.episodes[1]!.sourceUrl).toBe("https://cdn.example.com/cowboy-bebop/ep02.mkv");
  });

  test("follows pagination across pages", async () => {
    const fetchJson = fakeJikan({
      pages: [
        [{ mal_id: 1, title: "A" }, { mal_id: 2, title: "B" }],
        [{ mal_id: 3, title: "C" }],
      ],
    });
    const show = await resolveShowFromMal(1, tmpl, { fetchJson });
    expect(show.episodes.map((e) => e.number)).toEqual([1, 2, 3]);
  });

  test("falls back to numbered 1..N when the episode list is empty but the count is known", async () => {
    const fetchJson = fakeJikan({ episodesCount: 3, pages: [[]] });
    const show = await resolveShowFromMal(1, tmpl, { fetchJson });
    expect(show.episodes.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(show.episodes[0]!.title).toBeUndefined();
    expect(show.episodes[2]!.sourceUrl).toBe("https://cdn.example.com/cowboy-bebop/ep03.mkv");
  });

  test("throws when neither an episode list nor a count is available (intent: nothing to ingest)", async () => {
    const fetchJson = fakeJikan({ episodesCount: null, pages: [[]] });
    await expect(resolveShowFromMal(1, tmpl, { fetchJson })).rejects.toThrow();
  });

  test("prefers an explicit id/slug override", async () => {
    const fetchJson = fakeJikan({ pages: [[{ mal_id: 1, title: "A" }]] });
    const show = await resolveShowFromMal(1, tmpl, { fetchJson, id: "custom-id", slug: "custom-slug" });
    expect(show.id).toBe("custom-id");
    expect(show.slug).toBe("custom-slug");
    expect(show.episodes[0]!.sourceUrl).toBe("https://cdn.example.com/custom-slug/ep01.mkv");
  });

  test("falls back to a mal-derived slug when the title has no latin characters", async () => {
    const fetchJson = fakeJikan({ title: "進撃の巨人", titleEnglish: null, pages: [[{ mal_id: 1, title: "A" }]] });
    const show = await resolveShowFromMal(7, tmpl, { fetchJson });
    expect(show.slug).toBe("mal-7");
  });

  test("rejects an invalid --slug override (intent: fail at resolve time, not silently at the DB)", async () => {
    const fetchJson = fakeJikan({ pages: [[{ mal_id: 1, title: "A" }]] });
    await expect(resolveShowFromMal(1, tmpl, { fetchJson, slug: "" })).rejects.toThrow();
    await expect(resolveShowFromMal(1, tmpl, { fetchJson, slug: "Has Spaces!" })).rejects.toThrow();
  });

  test("rejects a template that yields a non-URL sourceUrl (intent: fail loud at resolve, not later)", async () => {
    const fetchJson = fakeJikan({ pages: [[{ mal_id: 1, title: "A" }]] });
    await expect(
      resolveShowFromMal(1, "cdn/{slug}/ep{number}.mkv", { fetchJson }),
    ).rejects.toThrow();
  });
});
