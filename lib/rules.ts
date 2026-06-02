import { getFullHostname } from "./tabs.ts";

export interface GroupRule {
  id: string;
  name: string;
  color: chrome.tabGroups.ColorEnum;
  patterns: string[];
}

export interface RulesConfig {
  rules: GroupRule[];
  autoGroup: boolean;
  autoUngroup: boolean;
  useRules: boolean;
  autoSort: boolean;
  autoPinFollow: boolean;
  autoDiscard: boolean;
  useAI: boolean;
}

const STORAGE_KEY = "groupRules";
const CONFIG_KEY = "rulesConfig";

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
      useAI: stored.useAI ?? false,
    };
  }
  const config: RulesConfig = { rules: [], autoGroup: false, autoUngroup: false, useRules: false, autoSort: false, autoPinFollow: false, autoDiscard: false, useAI: false };
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

export async function getUseAI(): Promise<boolean> {
  const config = await getConfig();
  return config.useAI ?? false;
}

export async function setUseAI(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.useAI = enabled;
  await saveConfig(config);
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

export function domainMatches(domain: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    let re = regexCache.get(pattern);
    if (!re) {
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      re = new RegExp(`^${escaped}$`, "i");
      regexCache.set(pattern, re);
    }
    return re.test(domain);
  }
  return domain === pattern || domain.endsWith("." + pattern);
}
