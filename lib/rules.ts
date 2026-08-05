import { getFullHostname } from "./url.ts";

export interface GroupRule {
  id: string;
  name: string;
  color: chrome.tabGroups.ColorEnum;
  patterns: string[];
}

export interface IgnoreRule {
  pattern: string;
  enabled: boolean;
  caseSensitive?: boolean;
  isRegex?: boolean;
}

/**
 * Per-domain sort customisation. Two independent knobs, both read off the order of this list:
 *  - `rankFirst` lifts the domain ahead of every unlisted domain, in list order.
 *  - `patterns` orders tabs *inside* that domain — the first pattern a URL matches is its tier.
 *
 * This is not a position lock (lib/pin.ts). Nothing is held at an absolute index and no tab is
 * badged; the tabs just compare differently, so a sort with no matching tabs is a no-op.
 */
export interface SortRule {
  id: string;
  /** Hostname pattern, matched with domainMatches — so `example.com` covers its subdomains. */
  domain: string;
  /** Ahead of unlisted domains? Off keeps the domain in its alphabetical slot. */
  rankFirst: boolean;
  /** Ordered path globs, matched against pathname+search. */
  patterns: string[];
  enabled: boolean;
}

export interface RulesConfig {
  rules: GroupRule[];
  autoGroup: boolean;
  autoUngroup: boolean;
  useRules: boolean;
  autoSort: boolean;
  autoPinFollow: boolean;
  autoDiscard: boolean;
  switchToExisting: boolean;
  useAI: boolean;
  ignorePatterns: IgnoreRule[];
  ignoreGroupNames: IgnoreRule[];
  sortRules: SortRule[];
}

const STORAGE_KEY = "groupRules";
const CONFIG_KEY = "rulesConfig";

function normalizeIgnoreRules(raw: unknown): IgnoreRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    if (typeof item === "string") return { pattern: item, enabled: true };
    if (item && typeof item === "object" && "pattern" in item) {
      const r = item as Record<string, unknown>;
      return {
        pattern: String(r.pattern),
        enabled: r.enabled !== false,
        caseSensitive: r.caseSensitive === true ? true : undefined,
        isRegex: r.isRegex === true ? true : undefined,
      };
    }
    return null;
  }).filter((x): x is IgnoreRule => x !== null);
}

function normalizeSortRules(raw: unknown): SortRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    if (typeof r.domain !== "string" || !r.domain) return null;
    return {
      id: typeof r.id === "string" && r.id ? r.id : crypto.randomUUID(),
      domain: r.domain,
      rankFirst: r.rankFirst === true,
      patterns: Array.isArray(r.patterns)
        ? r.patterns.filter((p: unknown): p is string => typeof p === "string" && p.length > 0)
        : [],
      enabled: r.enabled !== false,
    };
  }).filter((x): x is SortRule => x !== null);
}

// The service worker wakes for every tab event and several listeners each need the config,
// so an uncached read costs 3+ storage round-trips per keystroke-speed event. The cache is
// only armed once we've subscribed to invalidations — a context without storage.onChanged
// (e.g. the test stub) keeps reading straight through.
let cachedConfig: RulesConfig | null = null;
let cacheArmed = false;

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[CONFIG_KEY]) cachedConfig = null;
  });
  cacheArmed = true;
} catch {}

export async function getConfig(fresh = false): Promise<RulesConfig> {
  if (!fresh && cacheArmed && cachedConfig) return structuredClone(cachedConfig);
  const data = await chrome.storage.local.get(CONFIG_KEY);
  if (data[CONFIG_KEY]) {
    const stored = data[CONFIG_KEY];
    const rules = Array.isArray(stored.rules) ? stored.rules : [];
    const normalized: RulesConfig = {
      rules: rules.map((r: any) => ({
        ...r,
        patterns: Array.isArray(r.patterns) ? r.patterns : [],
      })),
      autoGroup: stored.autoGroup ?? false,
      autoUngroup: stored.autoUngroup ?? false,
      useRules: stored.useRules ?? false,
      autoSort: stored.autoSort ?? false,
      autoPinFollow: stored.autoPinFollow ?? false,
      autoDiscard: stored.autoDiscard ?? false,
      switchToExisting: stored.switchToExisting ?? false,
      useAI: stored.useAI ?? false,
      ignorePatterns: normalizeIgnoreRules(stored.ignorePatterns),
      ignoreGroupNames: normalizeIgnoreRules(stored.ignoreGroupNames),
      sortRules: normalizeSortRules(stored.sortRules),
    };
    cachedConfig = normalized;
    return structuredClone(normalized);
  }
  const config: RulesConfig = { rules: [], autoGroup: false, autoUngroup: false, useRules: false, autoSort: false, autoPinFollow: false, autoDiscard: false, switchToExisting: false, useAI: false, ignorePatterns: [], ignoreGroupNames: [], sortRules: [] };
  await saveConfig(config);
  return structuredClone(config);
}

export async function saveConfig(config: RulesConfig): Promise<void> {
  const plain = JSON.parse(JSON.stringify(config));
  // Prime the cache only once the write is durable. Priming first meant a rejected set()
  // (quota, or "Extension context invalidated") left a config that was never persisted and
  // that no storage.onChanged would ever invalidate — the next writer would then read that
  // phantom and launder it into storage.
  try {
    await chrome.storage.local.set({ [CONFIG_KEY]: plain });
    cachedConfig = plain;
  } catch (e) {
    cachedConfig = null;
    throw e;
  }
}

// Every toggle is a read-modify-write of one shared object. Serializing them keeps two
// rapid toggles in THIS context from racing, where the second read happens before the
// first write lands and silently reverts it.
let writeChain: Promise<unknown> = Promise.resolve();

async function updateConfig(mutate: (config: RulesConfig) => void): Promise<void> {
  const run = writeChain.then(async () => {
    // Read straight from storage, never the cache. writeChain only orders writers inside
    // one context, and popup + side panel are the same component in two contexts — a warm
    // cache here would let one of them mutate a copy taken before the other's write and
    // silently revert it. Toggles are rare and user-initiated, so the extra read is free.
    const config = await getConfig(true);
    mutate(config);
    await saveConfig(config);
  });
  writeChain = run.catch(() => {});
  return run;
}

export async function getRules(): Promise<GroupRule[]> {
  const config = await getConfig();
  return config.rules;
}

export async function saveRules(rules: GroupRule[]): Promise<void> {
  await updateConfig((config) => { config.rules = rules; });
}

export async function getAutoGroup(): Promise<boolean> {
  const config = await getConfig();
  return config.autoGroup;
}

export async function setAutoGroup(enabled: boolean): Promise<void> {
  await updateConfig((config) => { config.autoGroup = enabled; });
}

export async function getAutoUngroup(): Promise<boolean> {
  const config = await getConfig();
  return config.autoUngroup ?? false;
}

export async function setAutoUngroup(enabled: boolean): Promise<void> {
  await updateConfig((config) => { config.autoUngroup = enabled; });
}

export async function getUseRules(): Promise<boolean> {
  const config = await getConfig();
  return config.useRules ?? false;
}

export async function setUseRules(enabled: boolean): Promise<void> {
  await updateConfig((config) => { config.useRules = enabled; });
}

export async function getAutoSort(): Promise<boolean> {
  const config = await getConfig();
  return config.autoSort ?? false;
}

export async function setAutoSort(enabled: boolean): Promise<void> {
  await updateConfig((config) => { config.autoSort = enabled; });
}

export async function getAutoPinFollow(): Promise<boolean> {
  const config = await getConfig();
  return config.autoPinFollow ?? false;
}

export async function setAutoPinFollow(enabled: boolean): Promise<void> {
  await updateConfig((config) => { config.autoPinFollow = enabled; });
}

export async function getAutoDiscard(): Promise<boolean> {
  const config = await getConfig();
  return config.autoDiscard ?? false;
}

export async function setAutoDiscard(enabled: boolean): Promise<void> {
  await updateConfig((config) => { config.autoDiscard = enabled; });
}

export async function setSwitchToExisting(enabled: boolean): Promise<void> {
  await updateConfig((config) => { config.switchToExisting = enabled; });
}

export async function getIgnorePatterns(): Promise<IgnoreRule[]> {
  const config = await getConfig();
  return config.ignorePatterns ?? [];
}

export async function setIgnorePatterns(patterns: IgnoreRule[]): Promise<void> {
  await updateConfig((config) => { config.ignorePatterns = patterns; });
}

export async function getIgnoreGroupNames(): Promise<IgnoreRule[]> {
  const config = await getConfig();
  return config.ignoreGroupNames ?? [];
}

export async function setIgnoreGroupNames(names: IgnoreRule[]): Promise<void> {
  await updateConfig((config) => { config.ignoreGroupNames = names; });
}

export async function getSortRules(): Promise<SortRule[]> {
  const config = await getConfig();
  return config.sortRules ?? [];
}

export async function setSortRules(rules: SortRule[]): Promise<void> {
  await updateConfig((config) => { config.sortRules = rules; });
}

export function isIgnoredUrl(url: string, ignorePatterns: IgnoreRule[]): boolean {
  if (ignorePatterns.length === 0) return false;
  const hostname = getFullHostname(url);
  if (!hostname) return false;
  for (const rule of ignorePatterns) {
    if (!rule.enabled) continue;
    if (rule.isRegex) {
      if (ruleMatches(hostname, rule)) return true;
    } else {
      if (domainMatches(hostname, rule.pattern, rule.caseSensitive)) return true;
    }
  }
  return false;
}

export function isIgnoredGroupName(title: string, ignoreGroupNames: IgnoreRule[]): boolean {
  if (ignoreGroupNames.length === 0) return false;
  for (const rule of ignoreGroupNames) {
    if (!rule.enabled) continue;
    if (ruleMatches(title, rule)) return true;
  }
  return false;
}

// Same cap the palette's /re search uses. It applies ONLY to patterns with wildcard or regex
// syntax — a plain literal is one string comparison at any length, and capping those silently
// disabled legitimate rules for long URLs.
//
// The cap is load-bearing for `isRegex` patterns, which really are compiled and really can
// backtrack. Globs no longer compile at all (see globMatches), so for them it now only bounds
// how much pattern a user can type, not a runtime hazard. Kept rather than lifted so the limit
// the Settings panel advertises stays the limit that applies.
export const MAX_PATTERN_LENGTH = 100;

/** True when this rule uses wildcard or regex syntax, and so is subject to MAX_PATTERN_LENGTH. */
export function isCompiledPattern(rule: Pick<IgnoreRule, "pattern" | "isRegex">): boolean {
  return !!rule.isRegex || rule.pattern.includes("*");
}

// The length cap alone doesn't save us: `(a+)+$` is six characters and backtracks
// exponentially inside a single re.test, freezing the popup with no way out. Reject a
// quantifier applied to a group that already contains one — the classic catastrophic shape.
// Best-effort by design: this is a heuristic, not a regex parser, so it can miss exotic
// constructions and can refuse a harmless pattern like `([ab]+)+x`.
const NESTED_QUANTIFIER = /\([^()]*(?:[*+]|\{\d+(?:,\d*)?\})[^()]*\)\s*(?:[*+]|\{\d+(?:,\d*)?\})/;

export function hasNestedQuantifier(pattern: string): boolean {
  return NESTED_QUANTIFIER.test(pattern);
}

/**
 * Glob matching without compiling a RegExp: split on the wildcard and walk the input with
 * indexOf, taking the leftmost placement of each literal run. That is optimal when the only
 * wildcard is `*` (it matches anything, so an earlier anchor never rules out a later one), and
 * it cannot backtrack.
 *
 * Compiling instead — the obvious `*` to `.*` expansion — produces the classic `.*a.*a.*a`
 * shape, which backtracks superlinearly on a near miss: at MAX_PATTERN_LENGTH/5 characters it
 * measured 8.3 seconds on a 40-character input. That runs on the auto-sort path, on the single
 * thread of an MV3 service worker, for every tab that finishes loading. hasNestedQuantifier
 * does not catch it, because a glob escapes every bracket before compiling and so never
 * contains a group for that heuristic to see.
 *
 * `anchorEnd` distinguishes the two shapes in use: ignore/domain rules match the whole string,
 * path rules match a prefix (see pathMatches).
 */
export function globMatches(
  input: string,
  pattern: string,
  anchorEnd: boolean,
  caseSensitive?: boolean
): boolean {
  const hay = caseSensitive ? input : input.toLowerCase();
  const pat = caseSensitive ? pattern : pattern.toLowerCase();
  const parts = pat.split("*");

  if (parts.length === 1) return anchorEnd ? hay === pat : hay.startsWith(pat);

  const head = parts[0];
  if (head && !hay.startsWith(head)) return false;
  let pos = head.length;

  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    const at = hay.indexOf(part, pos);
    if (at === -1) return false;
    pos = at + part.length;
  }

  const tail = parts[parts.length - 1];
  if (!tail) return true;
  // The tail has to sit at the very end and still clear everything already consumed, or
  // `ab*ba` would accept "aba" by letting the two literals overlap.
  if (anchorEnd) return hay.endsWith(tail) && hay.length - tail.length >= pos;
  return hay.indexOf(tail, pos) !== -1;
}

export function ruleMatches(input: string, rule: IgnoreRule): boolean {
  if (rule.isRegex) {
    const flags = rule.caseSensitive ? "" : "i";
    if (rule.pattern.length > MAX_PATTERN_LENGTH) return false;
    if (hasNestedQuantifier(rule.pattern)) return false;
    try { return new RegExp(rule.pattern, flags).test(input); } catch { return false; }
  }
  const p = rule.pattern;
  if (p.includes("*")) {
    if (p.length > MAX_PATTERN_LENGTH) return false;
    return globMatches(input, p, true, rule.caseSensitive);
  }
  return rule.caseSensitive ? p === input : p.toLowerCase() === input.toLowerCase();
}

export function ruleToRegex(rule: IgnoreRule): string {
  if (rule.isRegex) return rule.pattern;
  const p = rule.pattern;
  if (p.includes("*")) {
    return "^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
  }
  return "^" + p.replace(/[.+*?^${}()|[\]\\]/g, "\\$&") + "$";
}

// ponytail: O(n*m²) — fine for a handful of rules, suffix tree if perf matters
export function longestCommonSubstring(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0];
  const orig = strings[0];
  const first = orig.toLowerCase();
  const rest = strings.slice(1).map((s) => s.toLowerCase());
  let bestStart = 0, bestLen = 0;
  for (let i = 0; i < first.length; i++) {
    for (let len = first.length - i; len > bestLen; len--) {
      const candidate = first.substring(i, i + len);
      if (rest.every((s) => s.includes(candidate))) { bestStart = i; bestLen = len; break; }
    }
  }
  return orig.substring(bestStart, bestStart + bestLen);
}

export function generalizePatterns(rules: IgnoreRule[]): string {
  const texts = rules.map((r) => {
    if (r.isRegex) return r.pattern;
    return r.pattern.replace(/^\*|\*$/g, "");
  });
  const lcs = longestCommonSubstring(texts);
  if (lcs.length >= 2) {
    const escaped = lcs.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
    return `.*${escaped}.*`;
  }
  const parts = rules.map((r) => ruleToRegex(r));
  return parts.length === 1 ? parts[0] : `(${parts.join("|")})`;
}

export async function addRule(rule: Omit<GroupRule, "id">): Promise<GroupRule> {
  const newRule: GroupRule = { ...rule, id: crypto.randomUUID() };
  await updateConfig((config) => { config.rules = [...config.rules, newRule]; });
  return newRule;
}

export async function deleteRule(id: string): Promise<void> {
  await updateConfig((config) => { config.rules = config.rules.filter((r) => r.id !== id); });
}

export async function mergeRules(idA: string, idB: string): Promise<void> {
  await updateConfig((config) => {
    const a = config.rules.find((r) => r.id === idA);
    const b = config.rules.find((r) => r.id === idB);
    if (!a || !b) return;
    a.patterns = [...new Set([...a.patterns, ...b.patterns])];
    config.rules = config.rules.filter((r) => r.id !== idB);
  });
}

export async function populateFromCurrentGroups(): Promise<number> {
  const existingRules = await getRules();
  const groups = await chrome.tabGroups.query({});
  const allTabs = await chrome.tabs.query({});
  let added = 0;

  for (const group of groups) {
    if (!group.title) continue;
    if (existingRules.some((r) => r.name === group.title)) continue;

    const groupTabs = allTabs.filter((t) => t.groupId === group.id);
    const domains = new Set<string>();
    for (const tab of groupTabs) {
      const hostname = getFullHostname(tab.url || "");
      if (hostname) domains.add(hostname);
    }

    if (domains.size === 0) continue;

    await addRule({
      name: group.title,
      color: group.color,
      patterns: [...domains],
    });
    added++;
  }
  return added;
}

export function matchDomainToRule(
  domain: string,
  rules: GroupRule[]
): GroupRule | null {
  for (const rule of rules) {
    if (!Array.isArray(rule.patterns)) continue;
    for (const pattern of rule.patterns) {
      if (domainMatches(domain, pattern)) return rule;
    }
  }
  return null;
}

export function domainMatches(domain: string, pattern: string, caseSensitive?: boolean): boolean {
  if (pattern.includes("*")) {
    if (pattern.length > MAX_PATTERN_LENGTH) return false;
    // globMatches rather than a compiled `.*` expansion, for the backtracking reason spelled
    // out on globMatches. This one runs per tab event through isIgnoredUrl.
    return globMatches(domain, pattern, true, caseSensitive);
  }
  if (caseSensitive) return domain === pattern || domain.endsWith("." + pattern);
  const d = domain.toLowerCase(), p = pattern.toLowerCase();
  return d === p || d.endsWith("." + p);
}

// ---------------------------------------------------------------------------
// Sort rules: domain ranking + per-domain path ordering. Consumed by lib/tabs/sort.ts.
// ---------------------------------------------------------------------------

/** Sorts after everything ranked. A sentinel rather than Infinity so `a - b` never yields NaN. */
export const UNRANKED = Number.MAX_SAFE_INTEGER;

export interface SortRank {
  /** Position among rank-first domains, or UNRANKED when the domain isn't lifted. */
  domain: number;
  /**
   * Tier of the first path pattern the URL matched, or UNRANKED. Numbered across every rule
   * rather than within one, so two tabs ranked by different rules are still on one scale —
   * see buildSortRanker.
   */
  path: number;
}

export type SortRanker = (url: string) => SortRank;

const NO_RANK: SortRank = { domain: UNRANKED, path: UNRANKED };

/** The ranker for "no rules configured" — every URL is unranked, so sorting is unchanged. */
export const noSortRanking: SortRanker = () => NO_RANK;

// Path globs anchor at the START and stay open at the end, so `/inbox` matches `/inbox/42` —
// that is what "this section of the site comes first" means to someone typing a rule. A leading
// star matches anywhere, which is how you reach a segment in the middle of a path: the pattern
// star-slash-pulls-star catches github.com/org/repo/pulls/12.
//
// Every character other than the wildcard is literal, `?` included, since a path pattern is
// routinely pasted straight out of the address bar with a query string still attached.
//
// Line comments, not a doc block: the wildcard examples this needs to spell out contain the
// sequence that would close one early.
//
// Path patterns are segment-aware, unlike the host and title patterns globMatches serves:
//   *   one segment, never crossing a slash
//   **  any number of segments, including none
// Both ends are anchored, so `/truyen/*` is exactly one level down and `/truyen/**` is the
// whole subtree. A slash-crossing `*` could not express "exactly this deep" at all, which is
// the thing a pattern like `/truyen/*/*/a/*` is written to say.
//
// A leading slash is optional: splitting drops the empty segment it produces, so `truyen/*`
// and `/truyen/*` are the same pattern. Forgetting it used to mean the rule silently never
// fired.
function pathSegments(value: string): string[] {
  const parts = value.split("/");
  if (parts[0] === "") parts.shift();
  // A trailing slash is the same page as without one; keeping the empty segment it leaves
  // behind would make `/truyen/9/` miss a pattern that `/truyen/9` matches.
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export function pathMatches(path: string, pattern: string): boolean {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return false;
  const segs = pathSegments(path);
  const pats = pathSegments(pattern);

  // The standard two-pointer wildcard walk, one level up: `**` plays the part of the star, and
  // segments the part of characters. On a mismatch it resumes from the last `**` having let it
  // absorb one more segment, which bounds the work at segments x patterns — no recursion, and
  // none of the exponential blow-up a compiled regex would bring back.
  let si = 0, pi = 0, starPi = -1, starSi = 0;
  while (si < segs.length) {
    if (pi < pats.length && pats[pi] === "**") {
      starPi = pi;
      starSi = si;
      pi++;
    } else if (pi < pats.length && globMatches(segs[si], pats[pi], true)) {
      si++;
      pi++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      starSi++;
      si = starSi;
    } else {
      return false;
    }
  }
  // `**` matches nothing at all, so any left over at the end are still satisfied.
  while (pi < pats.length && pats[pi] === "**") pi++;
  return pi === pats.length;
}

/** The part of a URL a path pattern is tested against. Non-URLs (chrome://newtab et al) yield "". */
export function sortPathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return "";
  }
}

function pathTier(url: string, patterns: string[]): number {
  if (patterns.length === 0) return UNRANKED;
  const path = sortPathOf(url);
  for (let i = 0; i < patterns.length; i++) {
    if (pathMatches(path, patterns[i])) return i;
  }
  return UNRANKED;
}

/**
 * Rule id to its displayed rank position. Counted over rank-first rules only, so switching one
 * off closes the gap instead of leaving a hole in the numbering.
 *
 * Exported because the panel prints these positions as badges: when the sort and the panel each
 * derived them separately, the two could drift and the badge would quietly start lying about
 * the order the sort actually produces.
 */
export function rankPositionsOf(rules: SortRule[]): Map<string, number> {
  const positions = new Map<string, number>();
  let next = 0;
  for (const rule of rules) {
    if (rule.enabled && rule.domain && rule.rankFirst) positions.set(rule.id, next++);
  }
  return positions;
}

/**
 * Resolve the configured rules into a per-URL rank, once per sort. Disabled rules drop out
 * entirely, and the returned function memoises — a comparator asks about the same handful of
 * URLs O(n log n) times, same reasoning as getDomainMapper's cache.
 */
export function buildSortRanker(rules: SortRule[]): SortRanker {
  const active = rules.filter((r) => r.enabled && r.domain);
  if (active.length === 0) return noSortRanking;

  const domainRank = rankPositionsOf(rules);

  // Path tiers are numbered across ALL rules, not within each one. Two rules can match tabs
  // that share a registrable domain (`mail.google.com` and `docs.google.com` both land in the
  // google.com block), and comparing their local indices would rank a second-listed rule's
  // first pattern above a first-listed rule's second one. It would also break the comparator
  // outright: a per-rule index is not a property of the tab alone, so mixing "same rule, compare
  // tiers" with "different rule, compare titles" admits A<B<C<A cycles, which is undefined
  // behaviour inside Array.prototype.sort. One scale, ordered by rule position, avoids both.
  const tierBase = new Map<string, number>();
  let base = 0;
  for (const rule of active) {
    tierBase.set(rule.id, base);
    base += rule.patterns.length;
  }

  const memo = new Map<string, SortRank>();
  return (url: string): SortRank => {
    const hit = memo.get(url);
    if (hit) return hit;
    const hostname = getFullHostname(url);
    let rank = NO_RANK;
    if (hostname) {
      // First match wins, so a specific `mail.google.com` entry listed above a broad
      // `google.com` one takes precedence rather than being shadowed by it.
      const rule = active.find((r) => domainMatches(hostname, r.domain));
      if (rule) {
        const tier = pathTier(url, rule.patterns);
        rank = {
          domain: rule.rankFirst ? domainRank.get(rule.id)! : UNRANKED,
          path: tier === UNRANKED ? UNRANKED : tierBase.get(rule.id)! + tier,
        };
      }
    }
    memo.set(url, rank);
    return rank;
  };
}
