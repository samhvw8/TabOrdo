import { describe, it, expect } from "vitest";
import { hasChinese, pinyinVariants } from "./pinyin.ts";
import { buildSearchHaystack, search } from "./search.ts";

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
  const items = [
    { title: "知乎 - 首页", url: "https://zhihu.com" },
    { title: "GitHub", url: "https://github.com" },
    { title: "百度一下", url: "https://baidu.com" },
  ];
  const haystack = buildSearchHaystack(items);

  it("fuzzy matches full pinyin typed without spaces", () => {
    expect(search(haystack, "zhihu", "fuzzy")).toEqual([0]);
    expect(search(haystack, "baidu", "fuzzy")).toEqual([2]);
  });

  it("prefix matches a pinyin syllable", () => {
    expect(search(haystack, "zhi", "prefix")).toContain(0);
  });

  it("exact matches the joined pinyin form", () => {
    expect(search(haystack, "baiduyixia", "exact")).toEqual([2]);
  });

  it("leaves non-Chinese items searchable as before", () => {
    expect(search(haystack, "github", "fuzzy")).toEqual([1]);
  });
});

describe("unicode (CJK) queries typed directly", () => {
  const items = [
    { title: "知乎 - 首页", url: "https://zhihu.com" },
    { title: "GitHub", url: "https://github.com" },
    { title: "Tiếng Việt - Báo mới", url: "https://baomoi.com" },
  ];
  const haystack = buildSearchHaystack(items);

  it("fuzzy matches a Chinese needle", () => {
    expect(search(haystack, "知乎", "fuzzy")).toEqual([0]);
  });

  it("exact matches a Chinese needle", () => {
    expect(search(haystack, "首页", "exact")).toEqual([0]);
  });

  it("prefix matches a Chinese word", () => {
    expect(search(haystack, "知", "prefix")).toContain(0);
  });

  it("matches Vietnamese with and without diacritics", () => {
    expect(search(haystack, "tiếng", "exact")).toEqual([2]);
    expect(search(haystack, "tieng viet", "fuzzy")).toEqual([2]);
  });
});
