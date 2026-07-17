import { describe, it, expect } from "vitest";
import { matchRanges, highlightSegments } from "./search.ts";

describe("matchRanges", () => {
  it("returns empty for an empty needle", () => {
    expect(matchRanges("GitHub", "")).toEqual([]);
    expect(matchRanges("GitHub", "   ")).toEqual([]);
  });

  it("finds a contiguous case-insensitive substring", () => {
    expect(matchRanges("GitHub Issues", "git")).toEqual([{ start: 0, end: 3 }]);
    expect(matchRanges("My GitHub Page", "github")).toEqual([{ start: 3, end: 9 }]);
  });

  it("falls back to a greedy in-order character match when there is no substring hit", () => {
    // g-i-t-h-u-b, needle "gtub" -> g, t, u+b (u and b are adjacent so they merge)
    expect(matchRanges("GitHub", "gtub")).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 4, end: 6 },
    ]);
  });

  it("returns empty when characters cannot be found in order at all", () => {
    expect(matchRanges("Foo", "xyz")).toEqual([]);
  });

  it("returns empty rather than a misleading partial highlight when only some characters match", () => {
    // "g" and "t" are findable in order in "GitHub", but "x" never appears —
    // the real match (if any) came from elsewhere (URL/pinyin), so no highlight is shown at all.
    expect(matchRanges("GitHub", "gtx")).toEqual([]);
  });

  it("matches a literal CJK substring", () => {
    expect(matchRanges("知乎 - 首页", "首页")).toEqual([{ start: 5, end: 7 }]);
  });

  it("returns empty for a pinyin match against CJK text (nothing literal to highlight)", () => {
    expect(matchRanges("知乎", "zhihu")).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("returns a single unmatched segment when there is no match", () => {
    expect(highlightSegments("Foo Bar", "xyz")).toEqual([{ text: "Foo Bar", matched: false }]);
  });

  it("splits text into unmatched/matched/unmatched around a contiguous match", () => {
    expect(highlightSegments("My GitHub Page", "github")).toEqual([
      { text: "My ", matched: false },
      { text: "GitHub", matched: true },
      { text: " Page", matched: false },
    ]);
  });

  it("handles a match at the very start with nothing trailing", () => {
    expect(highlightSegments("Git", "git")).toEqual([{ text: "Git", matched: true }]);
  });

  it("produces alternating segments for a scattered match", () => {
    expect(highlightSegments("GitHub", "gtub")).toEqual([
      { text: "G", matched: true },
      { text: "i", matched: false },
      { text: "t", matched: true },
      { text: "H", matched: false },
      { text: "ub", matched: true },
    ]);
  });
});
