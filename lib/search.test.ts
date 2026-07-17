import { describe, it, expect } from "vitest";
import { search } from "./search.ts";

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
