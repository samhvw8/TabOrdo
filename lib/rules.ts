export interface GroupRule {
  id: string;
  name: string;
  color: chrome.tabGroups.ColorEnum;
  patterns: string[];
}

export interface RulesConfig {
  rules: GroupRule[];
  autoGroup: boolean;
  useRules: boolean;
}

const STORAGE_KEY = "groupRules";
const CONFIG_KEY = "rulesConfig";

export async function getConfig(): Promise<RulesConfig> {
  const data = await chrome.storage.local.get(CONFIG_KEY);
  if (data[CONFIG_KEY]) return data[CONFIG_KEY];
  const config: RulesConfig = { rules: [], autoGroup: false, useRules: false };
  await saveConfig(config);
  return config;
}

export async function saveConfig(config: RulesConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
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

export async function getUseRules(): Promise<boolean> {
  const config = await getConfig();
  return config.useRules ?? false;
}

export async function setUseRules(enabled: boolean): Promise<void> {
  const config = await getConfig();
  config.useRules = enabled;
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
      try {
        const hostname = new URL(tab.url || "").hostname.replace(/^www\./, "");
        if (hostname) domains.add(hostname);
      } catch {}
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
    for (const pattern of rule.patterns) {
      if (domainMatches(domain, pattern)) return rule;
    }
  }
  return null;
}

/**
 * Pattern matching:
 *   "github.com"       — exact match or subdomain match (docs.github.com)
 *   "*.github.io"      — wildcard subdomain (user.github.io)
 *   "*google*"         — contains match (any domain containing "google")
 */
function domainMatches(domain: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${regex}$`, "i").test(domain);
  }
  return domain === pattern || domain.endsWith("." + pattern);
}
