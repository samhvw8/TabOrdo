// Creating, rebuilding and collapsing tab groups.

import { getRules, getUseRules, matchDomainToRule } from "../rules.ts";
import { getDomainMapper, getFullHostname, hashCode } from "../url.ts";
import { applyAllGroupPins } from "../pin.ts";
import { GROUP_COLORS } from "./types.ts";
import { organizeWindow } from "./sort.ts";

export async function groupTabsByDomain(
  mode: "additive" | "rebuild" = "additive"
): Promise<void> {
  const domainOf = await getDomainMapper();
  const useRules = await getUseRules();
  const rules = useRules ? await getRules() : [];
  const allTabs = await chrome.tabs.query({});

  if (mode === "rebuild") {
    const grouped = allTabs.filter((t) => !t.pinned && t.groupId !== -1);
    if (grouped.length > 0) {
      await chrome.tabs.ungroup(grouped.map((t) => t.id!));
    }
  }

  const freshTabs = await chrome.tabs.query({});
  const existingGroups = await chrome.tabGroups.query({});
  const groupTitleMap = new Map(existingGroups.map((g) => [g.id, g.title || ""]));

  const ruleGroupMap = new Map<string, { rule: typeof rules[0]; tabs: chrome.tabs.Tab[] }>();
  const domainMap = new Map<string, chrome.tabs.Tab[]>();
  const toUngroup: number[] = [];

  const candidates = freshTabs.filter((t) => !t.pinned);
  for (const tab of candidates) {
    const hostname = getFullHostname(tab.url || "");
    if (!hostname) continue;

    const rule = matchDomainToRule(hostname, rules);
    if (rule) {
      const currentGroupTitle = groupTitleMap.get(tab.groupId) || "";
      if (tab.groupId !== -1 && currentGroupTitle === rule.name) continue;
      if (tab.groupId !== -1) {
        toUngroup.push(tab.id!);
      }
      if (!ruleGroupMap.has(rule.id)) ruleGroupMap.set(rule.id, { rule, tabs: [] });
      ruleGroupMap.get(rule.id)!.tabs.push(tab);
    } else if (tab.groupId === -1) {
      const domain = domainOf(tab.url || "");
      if (!domain) continue;
      if (!domainMap.has(domain)) domainMap.set(domain, []);
      domainMap.get(domain)!.push(tab);
    }
  }

  if (toUngroup.length > 0) {
    await chrome.tabs.ungroup(toUngroup);
  }

  if (mode === "additive") {
    const currentGroups = await chrome.tabGroups.query({});
    for (const group of currentGroups) {
      if (!group.title) continue;

      const ruleEntry = [...ruleGroupMap.entries()].find(([, e]) => e.rule.name === group.title);
      if (ruleEntry) {
        const [ruleId, entry] = ruleEntry;
        const moveIds = entry.tabs.filter((t) => t.windowId !== group.windowId).map((t) => t.id!);
        if (moveIds.length > 0) await chrome.tabs.move(moveIds, { windowId: group.windowId, index: -1 });
        await chrome.tabs.group({ tabIds: entry.tabs.map((t) => t.id!), groupId: group.id });
        ruleGroupMap.delete(ruleId);
        continue;
      }

      const matching = domainMap.get(group.title);
      if (matching && matching.length > 0) {
        const moveIds = matching.filter((t) => t.windowId !== group.windowId).map((t) => t.id!);
        if (moveIds.length > 0) await chrome.tabs.move(moveIds, { windowId: group.windowId, index: -1 });
        await chrome.tabs.group({ tabIds: matching.map((t) => t.id!), groupId: group.id });
        domainMap.delete(group.title);
      }
    }
  }

  for (const [, entry] of ruleGroupMap) {
    if (entry.tabs.length < 1) continue;
    const targetWindowId = pickMajorityWindow(entry.tabs);
    const moveIds = entry.tabs.filter((t) => t.windowId !== targetWindowId).map((t) => t.id!);
    if (moveIds.length > 0) await chrome.tabs.move(moveIds, { windowId: targetWindowId, index: -1 });
    const groupId = await chrome.tabs.group({
      tabIds: entry.tabs.map((t) => t.id!),
      createProperties: { windowId: targetWindowId },
    });
    await chrome.tabGroups.update(groupId, { title: entry.rule.name, color: entry.rule.color });
  }

  for (const [domain, domainTabs] of domainMap) {
    if (domainTabs.length < 2) continue;
    const targetWindowId = pickMajorityWindow(domainTabs);
    const moveIds = domainTabs.filter((t) => t.windowId !== targetWindowId).map((t) => t.id!);
    if (moveIds.length > 0) await chrome.tabs.move(moveIds, { windowId: targetWindowId, index: -1 });
    const groupId = await chrome.tabs.group({
      tabIds: domainTabs.map((t) => t.id!),
      createProperties: { windowId: targetWindowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: domain,
      color: GROUP_COLORS[Math.abs(hashCode(domain)) % GROUP_COLORS.length],
    });
  }

  const windows = await chrome.windows.getAll();
  for (const win of windows) {
    await organizeWindow(win.id!);
  }
  await collapseAllExceptActive();
  await applyAllGroupPins();
}

export function pickMajorityWindow(tabs: chrome.tabs.Tab[]): number {
  const counts = new Map<number, number>();
  for (const tab of tabs) {
    counts.set(tab.windowId, (counts.get(tab.windowId) || 0) + 1);
  }
  let best = tabs[0].windowId;
  let max = 0;
  for (const [wid, count] of counts) {
    if (count > max) { max = count; best = wid; }
  }
  return best;
}

export async function ungroupAll(): Promise<void> {
  const allTabs = await chrome.tabs.query({});
  const grouped = allTabs.filter((t) => !t.pinned && t.groupId !== -1);
  if (grouped.length > 0) {
    await chrome.tabs.ungroup(grouped.map((t) => t.id!));
  }
}

async function collapseAllExceptActive(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const allGroups = await chrome.tabGroups.query({});

  await Promise.all(allGroups.map((group) => {
    const shouldExpand = activeTab && activeTab.groupId === group.id;
    return chrome.tabGroups.update(group.id, { collapsed: !shouldExpand });
  }));
}

export async function collapseAllGroups(): Promise<number> {
  const allGroups = await chrome.tabGroups.query({});
  await Promise.all(allGroups.map((g) => chrome.tabGroups.update(g.id, { collapsed: true })));
  return allGroups.length;
}
