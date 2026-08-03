import { describe, it, expect } from "vitest";
import { domainMatches, matchDomainToRule, ruleMatches, ruleToRegex, longestCommonSubstring, generalizePatterns, isIgnoredGroupName, isCompiledPattern, MAX_PATTERN_LENGTH, pathMatches, sortPathOf, buildSortRanker, noSortRanking, UNRANKED, type IgnoreRule, type GroupRule, type SortRule } from "./rules.ts";

describe("domainMatches", () => {
  it("exact match", () => {
    expect(domainMatches("example.com", "example.com")).toBe(true);
    expect(domainMatches("example.com", "other.com")).toBe(false);
  });

  it("subdomain match", () => {
    expect(domainMatches("sub.example.com", "example.com")).toBe(true);
    expect(domainMatches("deep.sub.example.com", "example.com")).toBe(true);
    expect(domainMatches("notexample.com", "example.com")).toBe(false);
  });

  it("wildcard match", () => {
    expect(domainMatches("localhost:3000", "localhost:*")).toBe(true);
    expect(domainMatches("localhost:5763", "localhost:*")).toBe(true);
    expect(domainMatches("other:3000", "localhost:*")).toBe(false);
  });

  it("wildcard in middle", () => {
    expect(domainMatches("api.example.com", "*.example.com")).toBe(true);
    expect(domainMatches("example.com", "*.example.com")).toBe(false);
  });

  it("case insensitive by default", () => {
    expect(domainMatches("Example.COM", "example.com")).toBe(true);
    expect(domainMatches("LOCALHOST:3000", "localhost:*")).toBe(true);
  });

  it("case sensitive when flag set", () => {
    expect(domainMatches("Example.COM", "example.com", true)).toBe(false);
    expect(domainMatches("example.com", "example.com", true)).toBe(true);
    expect(domainMatches("LOCALHOST:3000", "localhost:*", true)).toBe(false);
    expect(domainMatches("localhost:3000", "localhost:*", true)).toBe(true);
  });
});

describe("ruleMatches", () => {
  const rule = (pattern: string, opts: Partial<IgnoreRule> = {}): IgnoreRule =>
    ({ pattern, enabled: true, ...opts });

  it("wildcard glob match (default)", () => {
    expect(ruleMatches("My Claude Tab", rule("*Claude*"))).toBe(true);
    expect(ruleMatches("claude", rule("*Claude*"))).toBe(true);
    expect(ruleMatches("no match", rule("*Claude*"))).toBe(false);
  });

  it("exact match without wildcards", () => {
    expect(ruleMatches("Claude", rule("Claude"))).toBe(true);
    expect(ruleMatches("claude", rule("Claude"))).toBe(true);
    expect(ruleMatches("Claude Tab", rule("Claude"))).toBe(false);
  });

  it("case sensitive wildcard", () => {
    expect(ruleMatches("My Claude Tab", rule("*Claude*", { caseSensitive: true }))).toBe(true);
    expect(ruleMatches("my claude tab", rule("*Claude*", { caseSensitive: true }))).toBe(false);
  });

  it("case sensitive exact", () => {
    expect(ruleMatches("Claude", rule("Claude", { caseSensitive: true }))).toBe(true);
    expect(ruleMatches("claude", rule("Claude", { caseSensitive: true }))).toBe(false);
  });

  it("regex mode", () => {
    expect(ruleMatches("Claude (MCP)", rule("Claude \\(MCP\\)", { isRegex: true }))).toBe(true);
    expect(ruleMatches("Claude (Other)", rule("Claude \\(MCP\\)", { isRegex: true }))).toBe(false);
  });

  it("regex case insensitive by default", () => {
    expect(ruleMatches("claude (mcp)", rule("Claude \\(MCP\\)", { isRegex: true }))).toBe(true);
  });

  it("regex case sensitive", () => {
    expect(ruleMatches("Claude (MCP)", rule("Claude \\(MCP\\)", { isRegex: true, caseSensitive: true }))).toBe(true);
    expect(ruleMatches("claude (mcp)", rule("Claude \\(MCP\\)", { isRegex: true, caseSensitive: true }))).toBe(false);
  });

  it("regex with character classes", () => {
    expect(ruleMatches("Tab-123", rule("Tab-\\d+", { isRegex: true }))).toBe(true);
    expect(ruleMatches("Tab-abc", rule("Tab-\\d+", { isRegex: true }))).toBe(false);
  });

  it("regex with alternation", () => {
    expect(ruleMatches("Claude", rule("Claude|ChatGPT|Gemini", { isRegex: true }))).toBe(true);
    expect(ruleMatches("ChatGPT", rule("Claude|ChatGPT|Gemini", { isRegex: true }))).toBe(true);
    expect(ruleMatches("Copilot", rule("Claude|ChatGPT|Gemini", { isRegex: true }))).toBe(false);
  });

  it("invalid regex returns false", () => {
    expect(ruleMatches("anything", rule("[invalid", { isRegex: true }))).toBe(false);
  });

  it("wildcard escapes regex special chars", () => {
    expect(ruleMatches("file.txt", rule("file.*"))).toBe(true);
    expect(ruleMatches("file(1)", rule("file(1)"))).toBe(true);
    expect(ruleMatches("file[1]", rule("file[1]"))).toBe(true);
  });
});

describe("isIgnoredGroupName", () => {
  it("returns false for empty rules", () => {
    expect(isIgnoredGroupName("anything", [])).toBe(false);
  });

  it("skips disabled rules", () => {
    expect(isIgnoredGroupName("Claude", [{ pattern: "Claude", enabled: false }])).toBe(false);
  });

  it("matches enabled rules", () => {
    expect(isIgnoredGroupName("Claude", [{ pattern: "Claude", enabled: true }])).toBe(true);
  });

  it("supports regex rules", () => {
    expect(isIgnoredGroupName("Claude (MCP)", [{ pattern: "Claude \\(MCP\\)", enabled: true, isRegex: true }])).toBe(true);
  });

  it("respects case sensitivity", () => {
    expect(isIgnoredGroupName("claude", [{ pattern: "Claude", enabled: true, caseSensitive: true }])).toBe(false);
    expect(isIgnoredGroupName("Claude", [{ pattern: "Claude", enabled: true, caseSensitive: true }])).toBe(true);
  });

  it("mixed rules", () => {
    const rules: IgnoreRule[] = [
      { pattern: "exact", enabled: true },
      { pattern: "*wild*", enabled: true },
      { pattern: "disabled", enabled: false },
      { pattern: "re\\d+", enabled: true, isRegex: true },
    ];
    expect(isIgnoredGroupName("exact", rules)).toBe(true);
    expect(isIgnoredGroupName("something wild here", rules)).toBe(true);
    expect(isIgnoredGroupName("disabled", rules)).toBe(false);
    expect(isIgnoredGroupName("re42", rules)).toBe(true);
    expect(isIgnoredGroupName("nomatch", rules)).toBe(false);
  });
});

// The length cap does not help here: `(a+)+$` is six characters and never returns from the
// single re.test it triggers, which freezes the popup outright.
describe("nested-quantifier guard", () => {
  const evil = (pattern: string): IgnoreRule => ({ pattern, enabled: true, isRegex: true });

  it("refuses a quantified group that already contains a quantifier", () => {
    const bait = "a".repeat(40) + "!";
    expect(ruleMatches(bait, evil("(a+)+$"))).toBe(false);
    expect(ruleMatches(bait, evil("(a*)*$"))).toBe(false);
    expect(ruleMatches(bait, evil("(\\d+){3,}"))).toBe(false);
    expect(isIgnoredGroupName(bait, [evil("(a+)+$")])).toBe(false);
  });

  it("leaves ordinary regex rules working", () => {
    expect(ruleMatches("re42", evil("re\\d+"))).toBe(true);
    expect(ruleMatches("Claude (MCP)", evil("Claude \\(MCP\\)"))).toBe(true);
    expect(ruleMatches("abcabc", evil("(abc)+"))).toBe(true);
    expect(ruleMatches("aaa", evil("a+"))).toBe(true);
  });
});

describe("ruleToRegex", () => {
  it("exact pattern becomes anchored escaped regex", () => {
    expect(ruleToRegex({ pattern: "example.com", enabled: true })).toBe("^example\\.com$");
  });

  it("wildcard pattern converts * to .*", () => {
    expect(ruleToRegex({ pattern: "localhost:*", enabled: true })).toBe("^localhost:.*$");
    expect(ruleToRegex({ pattern: "*Claude*", enabled: true })).toBe("^.*Claude.*$");
  });

  it("regex pattern passes through unchanged", () => {
    expect(ruleToRegex({ pattern: "Claude \\(MCP\\)", enabled: true, isRegex: true })).toBe("Claude \\(MCP\\)");
    expect(ruleToRegex({ pattern: "\\d+\\.\\d+", enabled: true, isRegex: true })).toBe("\\d+\\.\\d+");
  });

  it("generated regex actually matches the same inputs as ruleMatches", () => {
    const cases: [IgnoreRule, string, boolean][] = [
      [{ pattern: "localhost:*", enabled: true }, "localhost:3000", true],
      [{ pattern: "localhost:*", enabled: true }, "other:3000", false],
      [{ pattern: "*Claude*", enabled: true }, "My Claude Tab", true],
      [{ pattern: "exact", enabled: true }, "exact", true],
      [{ pattern: "exact", enabled: true }, "not exact", false],
    ];
    for (const [rule, input, expected] of cases) {
      const re = new RegExp(ruleToRegex(rule), "i");
      expect(re.test(input)).toBe(expected);
    }
  });

  it("combined regex with alternation works", () => {
    const rules: IgnoreRule[] = [
      { pattern: "localhost:*", enabled: true },
      { pattern: "example.com", enabled: true },
    ];
    const combined = `(${rules.map((r) => ruleToRegex(r)).join("|")})`;
    const re = new RegExp(combined, "i");
    expect(re.test("localhost:5000")).toBe(true);
    expect(re.test("example.com")).toBe(true);
    expect(re.test("other.com")).toBe(false);
  });
});

describe("longestCommonSubstring", () => {
  it("single string returns itself", () => {
    expect(longestCommonSubstring(["hello"])).toBe("hello");
  });

  it("empty array returns empty", () => {
    expect(longestCommonSubstring([])).toBe("");
  });

  it("finds common substring across multiple strings", () => {
    expect(longestCommonSubstring(["Claude", "Claude (MCP)", "✅Claude (MCP)"])).toBe("Claude");
  });

  it("case insensitive matching preserves first string case", () => {
    expect(longestCommonSubstring(["HELLO world", "hello World"])).toBe("HELLO world");
  });

  it("no common substring returns empty", () => {
    expect(longestCommonSubstring(["abc", "xyz"])).toBe("");
  });

  it("partial overlap", () => {
    expect(longestCommonSubstring(["localhost:3000", "localhost:5000"])).toBe("localhost:");
  });
});

describe("generalizePatterns", () => {
  it("generates generic regex from rules with common substring", () => {
    const rules: IgnoreRule[] = [
      { pattern: "Claude", enabled: true },
      { pattern: "Claude (MCP)", enabled: true },
      { pattern: "✅Claude (MCP)", enabled: true },
    ];
    const result = generalizePatterns(rules);
    expect(result).toBe(".*Claude.*");
    const re = new RegExp(result, "i");
    expect(re.test("Claude")).toBe(true);
    expect(re.test("Claude (MCP)")).toBe(true);
    expect(re.test("✅Claude (MCP)")).toBe(true);
    expect(re.test("My Claude Tab")).toBe(true);
  });

  it("strips wildcards before finding LCS", () => {
    const rules: IgnoreRule[] = [
      { pattern: "*Claude*", enabled: true },
      { pattern: "Claude (MCP)", enabled: true },
    ];
    const result = generalizePatterns(rules);
    expect(result).toBe(".*Claude.*");
  });

  it("falls back to alternation when no common substring >= 2 chars", () => {
    const rules: IgnoreRule[] = [
      { pattern: "abc", enabled: true },
      { pattern: "xyz", enabled: true },
    ];
    const result = generalizePatterns(rules);
    expect(result).toContain("|");
  });

  it("handles single rule", () => {
    const rules: IgnoreRule[] = [{ pattern: "Claude", enabled: true }];
    const result = generalizePatterns(rules);
    expect(result).toBe(".*Claude.*");
  });

  it("escapes regex special chars in LCS", () => {
    const rules: IgnoreRule[] = [
      { pattern: "file.txt", enabled: true },
      { pattern: "file.txt.bak", enabled: true },
    ];
    const result = generalizePatterns(rules);
    expect(result).toBe(".*file\\.txt.*");
  });
});

describe("pattern length cap", () => {
  const long = "a".repeat(MAX_PATTERN_LENGTH + 1);

  // The cap guards against catastrophic regex backtracking. Applying it to plain literals
  // silently disabled valid rules for long URLs: the UI accepted the rule, listed it, and it
  // never fired — and for an ignore rule "no match" means the tab gets grouped anyway.
  it("still matches a literal pattern longer than the cap", () => {
    expect(ruleMatches(long, { pattern: long, enabled: true, isRegex: false })).toBe(true);
  });

  it("matches a long literal case-insensitively", () => {
    const upper = long.toUpperCase();
    expect(ruleMatches(upper, { pattern: long, enabled: true, isRegex: false })).toBe(true);
  });

  it("rejects a regex pattern longer than the cap", () => {
    expect(ruleMatches("aaa", { pattern: long, enabled: true, isRegex: true })).toBe(false);
  });

  it("rejects a wildcard pattern longer than the cap", () => {
    const wild = "a".repeat(MAX_PATTERN_LENGTH) + "*";
    expect(ruleMatches("aaa", { pattern: wild, enabled: true, isRegex: false })).toBe(false);
  });

  it("matches a long literal domain, but not a long wildcard one", () => {
    expect(domainMatches(long, long)).toBe(true);
    expect(domainMatches("x.com", "*" + "a".repeat(MAX_PATTERN_LENGTH))).toBe(false);
  });

  it("classifies which patterns are subject to the cap", () => {
    expect(isCompiledPattern({ pattern: "abc", isRegex: false })).toBe(false);
    expect(isCompiledPattern({ pattern: "a*c", isRegex: false })).toBe(true);
    expect(isCompiledPattern({ pattern: "abc", isRegex: true })).toBe(true);
  });
});

describe("matchDomainToRule", () => {
  const rule = (id: string, patterns: string[]): GroupRule =>
    ({ id, name: id, color: "blue", patterns }) as GroupRule;

  it("returns null when nothing matches", () => {
    expect(matchDomainToRule("example.com", [rule("work", ["github.com"])])).toBeNull();
  });

  it("matches a bare domain and its subdomains", () => {
    const rules = [rule("work", ["github.com"])];
    expect(matchDomainToRule("github.com", rules)?.id).toBe("work");
    expect(matchDomainToRule("gist.github.com", rules)?.id).toBe("work");
  });

  it("first rule in list order wins when several match", () => {
    const rules = [rule("first", ["github.com"]), rule("second", ["github.com"])];
    expect(matchDomainToRule("github.com", rules)?.id).toBe("first");
  });

  it("a broad earlier pattern permanently shadows a specific later one", () => {
    // What the Rules tester surfaces: "gist" can never fire behind a "*.github.com" rule.
    const rules = [rule("catchall", ["*.github.com"]), rule("gist", ["gist.github.com"])];
    expect(matchDomainToRule("gist.github.com", rules)?.id).toBe("catchall");
  });

  it("skips rules whose patterns array is missing", () => {
    const broken = { id: "x", name: "x", color: "blue" } as unknown as GroupRule;
    expect(matchDomainToRule("github.com", [broken, rule("ok", ["github.com"])])?.id).toBe("ok");
  });
});

describe("pathMatches", () => {
  it("anchors at the start and stays open at the end", () => {
    expect(pathMatches("/inbox/42", "/inbox")).toBe(true);
    expect(pathMatches("/inbox", "/inbox")).toBe(true);
    expect(pathMatches("/mail/inbox", "/inbox")).toBe(false);
  });

  it("matches anywhere behind a leading star", () => {
    expect(pathMatches("/org/repo/pulls/12", "*/pulls*")).toBe(true);
    expect(pathMatches("/org/repo/issues/9", "*/pulls*")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(pathMatches("/Truyen/9", "/truyen/*")).toBe(true);
  });

  // Paths get pasted straight out of the address bar, query string and all. An unescaped `?`
  // would make the preceding character optional instead of matching literally.
  it("treats a query-string ? as a literal", () => {
    expect(pathMatches("/search?q=svelte", "/search?q=*")).toBe(true);
    expect(pathMatches("/searc", "/search?q=*")).toBe(false);
  });

  it("refuses an over-long pattern rather than compiling it", () => {
    expect(pathMatches("/a", "/" + "a".repeat(MAX_PATTERN_LENGTH))).toBe(false);
  });

  it("never matches on an empty pattern", () => {
    expect(pathMatches("/anything", "")).toBe(false);
  });
});

describe("sortPathOf", () => {
  it("keeps the path and the query, drops the host and hash", () => {
    expect(sortPathOf("https://x.com/a/b?c=1#frag")).toBe("/a/b?c=1");
  });

  it("is empty for something that is not a URL", () => {
    expect(sortPathOf("not a url")).toBe("");
  });
});

describe("buildSortRanker", () => {
  const sortRule = (over: Partial<SortRule> & { domain: string }): SortRule =>
    ({ id: over.domain, rankFirst: false, patterns: [], enabled: true, ...over });

  it("returns the shared no-op ranker when nothing is configured", () => {
    expect(buildSortRanker([])).toBe(noSortRanking);
    expect(buildSortRanker([sortRule({ domain: "a.com", enabled: false })])).toBe(noSortRanking);
  });

  it("numbers rank-first domains in list order", () => {
    const rank = buildSortRanker([
      sortRule({ domain: "sangtacviet.vip", rankFirst: true }),
      sortRule({ domain: "apple.com", rankFirst: true }),
    ]);
    expect(rank("https://sangtacviet.vip/x").domain).toBe(0);
    expect(rank("https://apple.com/x").domain).toBe(1);
    expect(rank("https://zebra.com/x").domain).toBe(UNRANKED);
  });

  // The panel prints "rank #n" off this numbering, so a rule that opts out of ranking must not
  // consume a slot and leave the visible sequence with a hole in it.
  it("skips non-ranking rules when numbering", () => {
    const rank = buildSortRanker([
      sortRule({ domain: "github.com", patterns: ["*/pulls*"] }),
      sortRule({ domain: "apple.com", rankFirst: true }),
    ]);
    expect(rank("https://apple.com/x").domain).toBe(0);
    expect(rank("https://github.com/o/r/pulls/1").domain).toBe(UNRANKED);
  });

  it("ranks a path by the first pattern it matches", () => {
    const rank = buildSortRanker([
      sortRule({ domain: "github.com", patterns: ["*/pulls*", "*/issues*"] }),
    ]);
    expect(rank("https://github.com/o/r/pulls/12").path).toBe(0);
    expect(rank("https://github.com/o/r/issues/9").path).toBe(1);
    expect(rank("https://github.com/settings").path).toBe(UNRANKED);
  });

  it("applies a rule to subdomains of its domain", () => {
    const rank = buildSortRanker([sortRule({ domain: "google.com", rankFirst: true })]);
    expect(rank("https://mail.google.com/u/0").domain).toBe(0);
  });

  it("lets a specific rule listed first beat a broader one below it", () => {
    const rank = buildSortRanker([
      sortRule({ domain: "mail.google.com", rankFirst: true }),
      sortRule({ domain: "google.com", rankFirst: true }),
    ]);
    expect(rank("https://mail.google.com/u/0").domain).toBe(0);
    expect(rank("https://docs.google.com/d/1").domain).toBe(1);
  });

  it("leaves a URL with no hostname unranked", () => {
    const rank = buildSortRanker([sortRule({ domain: "a.com", rankFirst: true })]);
    expect(rank("chrome://newtab")).toEqual({ domain: UNRANKED, path: UNRANKED });
  });
});
