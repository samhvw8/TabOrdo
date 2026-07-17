import { describe, it, expect } from "vitest";
import { search, rankedSearch } from "./search.ts";

const haystack = [
  "Alpha Docs https://a.com", // recency 100
  "Beta Docs https://b.com", // recency 400 (most recent)
  "Gamma News https://c.com", // recency 300
  "Delta Docs https://d.com", // recency 200
];
const recency = [100, 400, 300, 200];

describe("empty query", () => {
  it("returns MRU order when recency provided", () => {
    expect(search(haystack, "", "fuzzy", 50, recency)).toEqual([1, 2, 3, 0]);
  });

  it("respects limit", () => {
    expect(search(haystack, "", "fuzzy", 2, recency)).toEqual([1, 2]);
  });

  it("falls back to positional order without recency", () => {
    expect(search(haystack, "")).toEqual([0, 1, 2, 3]);
  });
});

describe("recency ordering for score-less modes", () => {
  it("orders exact matches by recency", () => {
    expect(search(haystack, "docs", "exact", 50, recency)).toEqual([1, 3, 0]);
  });

  it("orders prefix matches by recency", () => {
    expect(search(haystack, "do", "prefix", 50, recency)).toEqual([1, 3, 0]);
  });

  it("orders regex matches by recency", () => {
    expect(search(haystack, "docs", "regex", 50, recency)).toEqual([1, 3, 0]);
  });

  it("surfaces a recent match that sits beyond the limit window", () => {
    const big = Array.from({ length: 10 }, (_, i) => `Docs page ${i}`);
    const rec = big.map((_, i) => (i === 9 ? 999 : i));
    expect(search(big, "docs", "exact", 3, rec)[0]).toBe(9);
  });

  it("keeps positional order without recency (legacy behavior)", () => {
    expect(search(haystack, "docs", "exact")).toEqual([0, 1, 3]);
  });

  it("fuzzy keeps uFuzzy relevance order over recency", () => {
    const res = search(haystack, "docs", "fuzzy", 50, recency);
    expect([...res].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });
});

describe("rankedSearch", () => {
  const hay = [
    "GitHub home https://github.com", // "git" word-start -> prefix tier
    "Digital garden https://d.com", // "git" inside "digital" -> substring tier
    "Git tips https://t.com", // "git" word-start -> prefix tier
    "Nothing here https://n.com", // no match
  ];
  const rec = [100, 999, 300, 500];

  it("ranks prefix matches above substring matches, recency within tier", () => {
    const res = rankedSearch(hay, "git", 50, rec);
    // prefix tier by recency: 2 (300) > 0 (100); then substring tier: 1 (999) — tier beats recency
    expect(res).toEqual([2, 0, 1]);
  });

  it("does not duplicate an item across tiers", () => {
    const res = rankedSearch(hay, "git", 50, rec);
    expect(new Set(res).size).toBe(res.length);
  });

  it("fuzzy tier catches typos the other tiers miss", () => {
    expect(rankedSearch(hay, "githb", 50, rec)).toEqual([0]);
  });

  it("empty query returns MRU order", () => {
    expect(rankedSearch(hay, "", 3, rec)).toEqual([1, 3, 2]);
  });

  it("respects the limit across tiers", () => {
    expect(rankedSearch(hay, "git", 2, rec)).toEqual([2, 0]);
  });

  it("uses substring matching for CJK needles", () => {
    const cjk = ["知乎 - 首页", "GitHub", "知乎专栏"];
    const res = rankedSearch(cjk, "知乎", 50, [10, 20, 30]);
    expect(res).toEqual([2, 0]);
  });

  it("works without recency (positional within tier)", () => {
    expect(rankedSearch(hay, "git")).toEqual([0, 2, 1]);
  });
});

describe("rankedSearch with a title haystack", () => {
  // "com" appears in every URL but only in one title — the URL-only hits are noise.
  const full = [
    "Company Handbook https://a.com/handbook", // "com" in title AND url -> title-prefix tier
    "Product Roadmap https://comfy.io/roadmap", // "com" only in url -> full-prefix tier
    "Weekly Sync https://example.com/sync", // "com" only in url (substring) -> full-exact tier
  ];
  const titleOnly = ["Company Handbook", "Product Roadmap", "Weekly Sync"];
  const rec = [100, 999, 999];

  it("ranks a title hit above a URL-only hit even when the URL match is more recent", () => {
    const res = rankedSearch(full, "com", 50, rec, titleOnly);
    expect(res[0]).toBe(0);
  });

  it("still surfaces URL-only matches, just lower", () => {
    const res = rankedSearch(full, "com", 50, rec, titleOnly);
    expect(res).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(res.indexOf(0)).toBeLessThan(res.indexOf(1));
  });

  it("does not duplicate a title hit when it also matches the full haystack", () => {
    const res = rankedSearch(full, "com", 50, rec, titleOnly);
    expect(new Set(res).size).toBe(res.length);
  });

  it("without a title haystack, falls back to prior (unweighted) behavior", () => {
    const res = rankedSearch(full, "com", 50, rec);
    // "comfy" (999) now outranks "company" (100) since nothing favors title matches
    expect(res[0]).toBe(1);
  });
});
