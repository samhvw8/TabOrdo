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
