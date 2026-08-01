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
    };
    cachedConfig = normalized;
    return structuredClone(normalized);
  }
  const config: RulesConfig = { rules: [], autoGroup: false, autoUngroup: false, useRules: false, autoSort: false, autoPinFollow: false, autoDiscard: false, switchToExisting: false, useAI: false, ignorePatterns: [], ignoreGroupNames: [] };
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

// Same cap the palette's /re search uses: an unbounded hand-typed pattern is a backtracking
// hazard on every tab event. It applies ONLY to patterns that get compiled into a RegExp —
// a plain literal is one string comparison at any length, and capping those silently
// disabled legitimate rules for long URLs.
export const MAX_PATTERN_LENGTH = 100;

/** True when this rule compiles to a RegExp, and so is subject to MAX_PATTERN_LENGTH. */
export function isCompiledPattern(rule: Pick<IgnoreRule, "pattern" | "isRegex">): boolean {
  return !!rule.isRegex || rule.pattern.includes("*");
}

export function ruleMatches(input: string, rule: IgnoreRule): boolean {
  const flags = rule.caseSensitive ? "" : "i";
  if (rule.isRegex) {
    if (rule.pattern.length > MAX_PATTERN_LENGTH) return false;
    try { return new RegExp(rule.pattern, flags).test(input); } catch { return false; }
  }
  const p = rule.pattern;
  if (p.includes("*")) {
    if (p.length > MAX_PATTERN_LENGTH) return false;
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, flags).test(input);
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

const regexCache = new Map<string, RegExp>();

export function domainMatches(domain: string, pattern: string, caseSensitive?: boolean): boolean {
  const flags = caseSensitive ? "" : "i";
  const cacheKey = `${pattern}:${flags}`;
  if (pattern.includes("*")) {
    if (pattern.length > MAX_PATTERN_LENGTH) return false;
    let re = regexCache.get(cacheKey);
    if (!re) {
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      re = new RegExp(`^${escaped}$`, flags);
      regexCache.set(cacheKey, re);
    }
    return re.test(domain);
  }
  if (caseSensitive) return domain === pattern || domain.endsWith("." + pattern);
  const d = domain.toLowerCase(), p = pattern.toLowerCase();
  return d === p || d.endsWith("." + p);
}
