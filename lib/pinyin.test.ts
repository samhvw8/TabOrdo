import { describe, it, expect } from "vitest";
import { hasChinese, pinyinVariants } from "./pinyin.ts";
import { buildHaystacks, rankedSearch } from "./search.ts";

/** The palette's ranking: both haystacks, as TabSearch builds them. */
function ranker(items: { title: string; url: string }[]) {
  const { haystack, titleHaystack } = buildHaystacks(items);
  return (q: string) => rankedSearch(haystack, q, 50, undefined, titleHaystack);
}

describe("hasChinese", () => {
  it("detects CJK characters", () => {
    expect(hasChinese("知乎")).toBe(true);
    expect(hasChinese("知乎 Homepage")).toBe(true);
    expect(hasChinese("hello world")).toBe(false);
    expect(hasChinese("https://a.com")).toBe(false);
  });
});

describe("pinyinVariants", () => {
  it("produces spaced, joined, and initials variants", () => {
    const v = pinyinVariants("知乎");
    expect(v).toContain("zhi hu");
    expect(v).toContain("zhihu");
    expect(v).toContain("zh");
  });

  it("returns null for non-Chinese text", () => {
    expect(pinyinVariants("hello")).toBeNull();
  });

  it("converts only the Chinese characters in mixed text", () => {
    const v = pinyinVariants("百度 Search");
    expect(v).toContain("bai du");
    expect(v).toContain("baidu");
  });
});

describe("pinyin search end-to-end", () => {
  const find = ranker([
    { title: "知乎 - 首页", url: "https://zhihu.com" },
    { title: "GitHub", url: "https://github.com" },
    { title: "百度一下", url: "https://baidu.com" },
  ]);

  it("matches full pinyin typed without spaces", () => {
    expect(find("zhihu")).toEqual([0]);
    expect(find("baidu")).toEqual([2]);
  });

  it("matches a pinyin syllable", () => {
    expect(find("zhi")).toEqual([0]);
  });

  it("matches the joined pinyin form", () => {
    expect(find("baiduyixia")).toEqual([2]);
  });

  it("leaves non-Chinese items searchable as before", () => {
    expect(find("github")).toEqual([1]);
  });
});

describe("unicode (CJK) queries typed directly", () => {
  const find = ranker([
    { title: "知乎 - 首页", url: "https://zhihu.com" },
    { title: "GitHub", url: "https://github.com" },
    { title: "Tiếng Việt - Báo mới", url: "https://baomoi.com" },
  ]);

  it("matches a Chinese needle", () => {
    expect(find("知乎")).toEqual([0]);
  });

  it("matches a Chinese word that doesn't start the title", () => {
    expect(find("首页")).toEqual([0]);
  });

  it("matches a single Chinese character", () => {
    expect(find("知")).toEqual([0]);
  });

  it("matches Vietnamese with and without diacritics", () => {
    expect(find("tiếng")).toEqual([2]);
    expect(find("tieng viet")).toEqual([2]);
  });
});
