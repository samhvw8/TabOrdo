import { getFullHostname } from "./tabs.ts";

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

export async function getConfig(): Promise<RulesConfig> {
  const data = await chrome.storage.local.get(CONFIG_KEY);
  if (data[CONFIG_KEY]) {
    const stored = data[CONFIG_KEY];
    const rules = Array.isArray(stored.rules) ? stored.rules : [];
    return {
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
  }
  const config: RulesConfig = { rules: [], autoGroup: false, autoUngroup: false, useRules: false, autoSort: false, autoPinFollow: false, autoDiscard: false, switchToExisting: false, useAI: false, ignorePatterns: [], ignoreGroupNames: [] };
  await saveConfig(config);
  return config;
}

export async function saveConfig(config: RulesConfig): Promise<void> {
  const plain = JSON.parse(JSON.stringify(config));
  await chrome.storage.local.set({ [CONFIG_KEY]: plain });
}

export async function getRules(): Promise<GroupRule[]> {
  const config = await getConfig();
  return config.rules;
}

export async function saveRules(rules: GroupRule[]): Promise<void> {
  const config = await getConfig();
  config.rules = rules;
  await saveConfig(config);
}

export async function getAutoGroup(): Promise<boolean> {
  const config = await getConfig();
  return config.autoGroup;
}

export async function setAutoGroup(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.autoGroup = enabled;
  await saveConfig(config);
}

export async function getAutoUngroup(): Promise<boolean> {
  const config = await getConfig();
  return config.autoUngroup ?? false;
}

export async function setAutoUngroup(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.autoUngroup = enabled;
  await saveConfig(config);
}

export async function getUseRules(): Promise<boolean> {
  const config = await getConfig();
  return config.useRules ?? false;
}

export async function setUseRules(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.useRules = enabled;
  await saveConfig(config);
}

export async function getAutoSort(): Promise<boolean> {
  const config = await getConfig();
  return config.autoSort ?? false;
}

export async function setAutoSort(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.autoSort = enabled;
  await saveConfig(config);
}

export async function getAutoPinFollow(): Promise<boolean> {
  const config = await getConfig();
  return config.autoPinFollow ?? false;
}

export async function setAutoPinFollow(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.autoPinFollow = enabled;
  await saveConfig(config);
}

export async function getAutoDiscard(): Promise<boolean> {
  const config = await getConfig();
  return config.autoDiscard ?? false;
}

export async function setAutoDiscard(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.autoDiscard = enabled;
  await saveConfig(config);
}

export async function setSwitchToExisting(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.switchToExisting = enabled;
  await saveConfig(config);
}

export async function getIgnorePatterns(): Promise<IgnoreRule[]> {
  const config = await getConfig();
  return config.ignorePatterns ?? [];
}

export async function setIgnorePatterns(patterns: IgnoreRule[]): Promise<void> {
  const config = await getConfig();
  config.ignorePatterns = patterns;
  await saveConfig(config);
}

export async function getIgnoreGroupNames(): Promise<IgnoreRule[]> {
  const config = await getConfig();
  return config.ignoreGroupNames ?? [];
}

export async function setIgnoreGroupNames(names: IgnoreRule[]): Promise<void> {
  const config = await getConfig();
  config.ignoreGroupNames = names;
  await saveConfig(config);
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

export function ruleMatches(input: string, rule: IgnoreRule): boolean {
  const flags = rule.caseSensitive ? "" : "i";
  if (rule.isRegex) {
    try { return new RegExp(rule.pattern, flags).test(input); } catch { return false; }
  }
  const p = rule.pattern;
  if (p.includes("*")) {
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
  const rules = await getRules();
  const newRule: GroupRule = { ...rule, id: crypto.randomUUID() };
  rules.push(newRule);
  await saveRules(rules);
  return newRule;
}

export async function deleteRule(id: string): Promise<void> {
  const rules = await getRules();
  await saveRules(rules.filter((r) => r.id !== id));
}

export async function mergeRules(idA: string, idB: string): Promise<void> {
  const rules = await getRules();
  const a = rules.find((r) => r.id === idA);
  const b = rules.find((r) => r.id === idB);
  if (!a || !b) return;

  const mergedPatterns = [...new Set([...a.patterns, ...b.patterns])];
  a.patterns = mergedPatterns;
  await saveRules(rules.filter((r) => r.id !== idB));
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
