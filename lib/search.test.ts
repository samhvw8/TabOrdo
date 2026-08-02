import { describe, it, expect } from "vitest";
import { search, rankedSearch, parseCommand, buildSearchHaystack, buildTitleHaystack } from "./search.ts";

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

// /re compiles whatever the user types. The 50ms deadline in regexSearch only helps between
// tests — a single test against a nested quantifier never returns to be timed.
describe("regex mode ReDoS guard", () => {
  const bait = ["a".repeat(40) + "!"];

  it("returns nothing for a nested quantifier instead of hanging", () => {
    expect(search(bait, "(a+)+$", "regex")).toEqual([]);
    expect(search(bait, "(a*)*$", "regex")).toEqual([]);
  });

  it("still runs ordinary patterns", () => {
    expect(search(bait, "a+!", "regex")).toEqual([0]);
    expect(search(haystack, "(Alpha|Beta) Docs", "regex")).toEqual([0, 1]);
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

describe("rankedSearch with priority (pinned / current-window boost)", () => {
  const hay = ["Docs Page A https://a.com", "Docs Page B https://b.com", "Docs Page C https://c.com"];
  const rec = [500, 100, 900]; // by recency alone: 2, 0, 1
  const priority = [0, 1, 0]; // item 1 is pinned / in the current window

  it("ranks the prioritized item first even though it's the least recent", () => {
    expect(rankedSearch(hay, "docs", 50, rec, undefined, priority)).toEqual([1, 2, 0]);
  });

  it("falls back to recency ordering within the same priority tier", () => {
    // items 0 and 2 share priority 0; 2 (900) stays above 0 (500)
    const res = rankedSearch(hay, "docs", 50, rec, undefined, priority);
    expect(res.indexOf(2)).toBeLessThan(res.indexOf(0));
  });

  it("has no effect when omitted (backward compatible)", () => {
    expect(rankedSearch(hay, "docs", 50, rec)).toEqual([2, 0, 1]);
  });

  it("applies to the CJK substring path too", () => {
    const cjk = ["知乎 首页", "知乎 专栏", "知乎 视频"];
    const cjkPriority = [0, 1, 0];
    const res = rankedSearch(cjk, "知乎", 50, [500, 100, 900], undefined, cjkPriority);
    expect(res[0]).toBe(1);
  });
});

describe("parseCommand", () => {
  it("keeps multi-character @ prefixes intact", () => {
    expect(parseCommand("@shared")).toEqual({ prefix: "@shared", query: "" });
    expect(parseCommand("@shared docs")).toEqual({ prefix: "@shared", query: "docs" });
  });

  it("still parses single-character triage prefixes", () => {
    expect(parseCommand("@a")).toEqual({ prefix: "@a", query: "" });
    expect(parseCommand("@s docs")).toEqual({ prefix: "@s", query: "docs" });
  });

  // Matching @ + \w* greedily fixes @shared but breaks every one-letter view with an
  // attached query: "@afoo" becomes the unknown prefix "@afoo" with an empty query, and the
  // search silently returns garbage. Longest-known-prefix has to satisfy both directions.
  it("splits a one-letter prefix from an attached query", () => {
    expect(parseCommand("@afoo")).toEqual({ prefix: "@a", query: "foo" });
    expect(parseCommand("@d123")).toEqual({ prefix: "@d", query: "123" });
    expect(parseCommand("@rmail")).toEqual({ prefix: "@r", query: "mail" });
    expect(parseCommand("@mvideo")).toEqual({ prefix: "@m", query: "video" });
  });

  it("prefers the longest known prefix over a shorter one", () => {
    // "@shared" must not be read as "@s" + "hared"...
    expect(parseCommand("@shared")).toEqual({ prefix: "@shared", query: "" });
    // ...while a genuine "@s" query that merely starts with the same letters still splits.
    expect(parseCommand("@share")).toEqual({ prefix: "@s", query: "hare" });
  });

  it("falls back to a single character for unknown prefixes", () => {
    expect(parseCommand("@_x")).toEqual({ prefix: "@_", query: "x" });
    expect(parseCommand("@zzz")).toEqual({ prefix: "@z", query: "zz" });
  });

  it("parses a bare @ as the triage overview", () => {
    expect(parseCommand("@")).toEqual({ prefix: "@", query: "" });
  });

  it("parses slash commands", () => {
    expect(parseCommand("/sort title")).toEqual({ prefix: "sort", query: "title" });
  });

  it("treats plain text as a query", () => {
    expect(parseCommand("hello world")).toEqual({ prefix: null, query: "hello world" });
  });
});

describe("rankedSearch — abbreviation and tier budget", () => {
  const items = [
    { title: "(276) I'm begging you to manage your time - YouTube", url: "https://youtube.com/watch?v=1" },
    { title: "YouTube", url: "https://youtube.com/" },
    { title: "tiny experiments - YouTube", url: "https://youtube.com/watch?v=3" },
    { title: "Python Tutorial", url: "https://python.org/" },
    { title: "GitHub", url: "https://github.com/" },
  ];
  const hay = buildSearchHaystack(items);
  const titleHay = buildTitleHaystack(items);
  const titlesFor = (q: string) =>
    rankedSearch(hay, q, 50, undefined, titleHay, undefined).map((i) => items[i].title);

  it("matches an abbreviation to its word: yt finds YouTube", () => {
    const hits = titlesFor("yt");
    expect(hits).toContain("YouTube");
  });

  it("still ranks a contiguous match above a scattered one", () => {
    const hits = titlesFor("yt");
    // "Python" contains a literal "yt"; YouTube only matches as a subsequence.
    expect(hits.indexOf("Python Tutorial")).toBeLessThan(hits.indexOf("YouTube"));
  });

  it("matches gh to GitHub", () => {
    expect(titlesFor("gh")).toContain("GitHub");
  });

  it("ignores single-character needles in the subsequence tier", () => {
    // "z" appears in no title; without the length guard a 1-char needle would match broadly.
    expect(titlesFor("z")).toHaveLength(0);
  });

  it("reserves budget so approximate hits survive a saturated literal tier", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      title: `Yo report ${i}`,
      url: `https://example.com/${i}`,
    }));
    // Reachable only by an approximate tier: no contiguous "yo", no word starting with "yo".
    many.push({ title: "Zebra yellow octopus", url: "https://zzz.example/" });
    const h = buildSearchHaystack(many);
    const th = buildTitleHaystack(many);
    const idx = rankedSearch(h, "yo", 50, undefined, th, undefined);
    expect(idx).toHaveLength(50);
    expect(idx).toContain(many.length - 1);
  });
});
