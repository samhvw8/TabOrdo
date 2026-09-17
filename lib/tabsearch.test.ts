import { describe, it, expect } from "vitest";
import { createTabSearch } from "./tabsearch.ts";
import { buildSearchHaystack, buildTitleHaystack, rankedSearch, type SearchResult } from "./search.ts";

const row = (id: number, title: string, url: string, groupTitle?: string): SearchResult => ({
  type: "tab", id: `tab-${id}`, tabId: id, title, url, groupTitle,
});

const rows = [
  row(1, "GitHub - pull requests", "https://github.com/pulls"),
  row(2, "Hướng dẫn Svelte", "https://svelte.dev/docs", "docs"),
  row(3, "知乎 - 首页", "https://zhihu.com"),
  row(4, "Git tips", "https://t.com/git"),
  row(5, "Weekly sync", "https://meet.example.com", "work"),
  row(6, "Digital garden", "https://d.com"),
];
const recency = [500, 100, 900, 300, 700, 200];
const priority = [0, 1, 0, 0, 1, 0];

/** What the popup ran before: both haystacks built up front, then rankedSearch over them. */
function eager(q: string, items = rows, rec = recency, pri = priority) {
  return rankedSearch(buildSearchHaystack(items), q, 50, rec, buildTitleHaystack(items), pri).map((i) => items[i]);
}

describe("createTabSearch", () => {
  it("ranks exactly as rankedSearch over eagerly built haystacks", () => {
    for (const q of ["git", "gi", "g", "huong", "hướng", "zhihu", "知乎", "docs", "work", "githb", "sync meet", "zzz"]) {
      expect(createTabSearch(rows, recency, priority).rank(q)).toEqual(eager(q));
    }
  });

  it("lists the empty query by recency without building a haystack", () => {
    const s = createTabSearch(rows, recency, priority);
    expect(s.rank("").map((r) => r.tabId)).toEqual([3, 5, 1, 4, 6, 2]);
    expect(s.rank("", 2)).toEqual(eager("").slice(0, 2));
    expect(s.isBuilt()).toBe(false);
  });

  it("builds on the first real query when nothing warmed it first", () => {
    const s = createTabSearch(rows, recency, priority);
    expect(s.rank("git")).toEqual(eager("git"));
    expect(s.isBuilt()).toBe(true);
  });

  it("warms ahead of the first query and ranks the same afterwards", () => {
    const s = createTabSearch(rows, recency, priority);
    s.warm();
    expect(s.isBuilt()).toBe(true);
    expect(s.rank("docs")).toEqual(eager("docs"));
    expect(s.haystack()).toEqual(buildSearchHaystack(rows));
  });

  it("hands back the last ranking when asked for the same query again", () => {
    const s = createTabSearch(rows, recency, priority);
    const first = s.rank("git");
    expect(s.rank("git")).toBe(first);
    const other = s.rank("docs");
    expect(other).toEqual(eager("docs"));
    expect(s.rank("git")).not.toBe(first);
    expect(s.rank("git")).toEqual(first);
    expect(s.rank("git", 1)).toEqual(eager("git").slice(0, 1));
  });

  describe("rankView", () => {
    /** What every view ran before: a haystack built from its rows, on every keystroke. */
    const rebuilt = (view: SearchResult[], q: string) =>
      rankedSearch(buildSearchHaystack(view), q).map((i) => view[i]);
    const queries = ["g", "git", "docs", "hướng", "huong", "知乎", "zhihu", "githb", "zzz"];

    it("ranks a subset of the rows as a rebuilt haystack would, built or not", () => {
      for (const warm of [false, true]) {
        const s = createTabSearch(rows, recency, priority);
        if (warm) s.warm();
        for (const q of queries) {
          const view = rows.filter((r) => r.tabId! % 2 === 0);
          expect(s.rankView("even", view, q)).toEqual(rebuilt(view, q));
        }
      }
    });

    it("follows the view's own order, not the tab list's", () => {
      const s = createTabSearch(rows, recency, priority);
      s.warm();
      const reversed = [...rows].reverse();
      for (const q of queries) expect(s.rankView("rev", reversed, q)).toEqual(rebuilt(reversed, q));
    });

    it("ranks rows it doesn't hold, and rows mixed with copies", () => {
      const s = createTabSearch(rows, recency, priority);
      s.warm();
      const reading = [row(90, "Reading Hướng dẫn", "https://medium.com/p/1"), row(91, "Git internals", "https://git-scm.com")];
      const branch = [rows[0], { ...rows[3], title: "↳ Git tips" }];
      for (const q of queries) {
        expect(s.rankView("rl", reading, q)).toEqual(rebuilt(reading, q));
        expect(s.rankView("b", branch, q)).toEqual(rebuilt(branch, q));
      }
    });

    it("notices when the view's rows change under the same key", () => {
      const s = createTabSearch(rows, recency, priority);
      s.warm();
      expect(s.rankView("v", [rows[0], rows[3]], "git")).toEqual([rows[0], rows[3]]);
      // A fresh array of the same rows is the same view...
      expect(s.rankView("v", [rows[0], rows[3]], "git")).toEqual([rows[0], rows[3]]);
      // ...but a changed set, or the same set reordered, is not.
      expect(s.rankView("v", [rows[5], rows[0]], "git")).toEqual(rebuilt([rows[5], rows[0]], "git"));
      expect(s.rankView("v", [rows[3], rows[0]], "gi")).toEqual(rebuilt([rows[3], rows[0]], "gi"));
      expect(s.rankView("v", [rows[1]], "git")).toEqual([]);
    });

    it("lists the first rows as given for an empty query", () => {
      const s = createTabSearch(rows, recency, priority);
      expect(s.rankView("p", rows, "")).toEqual(rows);
      expect(s.rankView("p", rows, "", 2)).toEqual(rebuilt(rows, "").slice(0, 2));
      const many = Array.from({ length: 60 }, (_, i) => row(200 + i, `Tab ${i}`, `https://x.dev/${i}`));
      expect(s.rankView("w", many, "")).toEqual(rebuilt(many, ""));
      expect(s.isBuilt()).toBe(false);
    });
  });

  it("drops a row and keeps recency and priority aligned with the rows left", () => {
    const s = createTabSearch(rows, recency, priority);
    s.warm();
    const without = s.without("tab-3");
    expect(without.items.map((r) => r.tabId)).toEqual([1, 2, 4, 5, 6]);
    const keep = [0, 1, 3, 4, 5];
    const expected = (q: string) => eager(q, keep.map((i) => rows[i]), keep.map((i) => recency[i]), keep.map((i) => priority[i]));
    expect(without.rank("")).toEqual(expected(""));
    expect(without.rank("g")).toEqual(expected("g"));
    expect(s.items).toHaveLength(6);
  });
});
