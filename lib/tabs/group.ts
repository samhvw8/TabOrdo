// Creating, rebuilding and collapsing tab groups.

import { getConfig, isIgnoredGroupName, isIgnoredUrl, matchDomainToRule, type IgnoreRule } from "../rules.ts";
import { getDomainMapper, getFullHostname, getGroupNameMapper, hashCode, type DomainMapper } from "../url.ts";
import { applyAllGroupPins } from "../pin.ts";
import { GROUP_COLORS } from "./types.ts";
import { organizeWindow } from "./sort.ts";

export async function groupTabsByDomain(
  mode: "additive" | "rebuild" = "additive"
): Promise<void> {
  const domainOf = await getDomainMapper();
  const nameOf = await getGroupNameMapper();
  // One config read for the whole run: rules, useRules and both ignore lists come from the
  // same object, and getRules/getUseRules were two round-trips for one of its fields.
  const config = await getConfig();
  const rules = config.useRules ? config.rules : [];
  const allTabs = await chrome.tabs.query({});
  const protectedGroups = await ignoredGroupIds(config.ignoreGroupNames);

  if (mode === "rebuild") {
    const grouped = allTabs.filter(
      (t) => !t.pinned && t.groupId !== -1 && !protectedGroups.has(t.groupId)
    );
    if (grouped.length > 0) {
      await chrome.tabs.ungroup(grouped.map((t) => t.id!));
    }
  }

  // Only a rebuild changes the strip before this point. Additive mode used to fetch every tab a
  // second time here, which at 1000 tabs is a second 1000-tab payload for nothing.
  const freshTabs = mode === "rebuild" ? await chrome.tabs.query({}) : allTabs;
  const existingGroups = await chrome.tabGroups.query({});
  const groupTitleMap = new Map(existingGroups.map((g) => [g.id, g.title || ""]));

  const ruleGroupMap = new Map<string, { rule: typeof rules[0]; tabs: chrome.tabs.Tab[] }>();
  const nameMap = new Map<string, chrome.tabs.Tab[]>();
  // Groups titled before names dropped the public suffix still say "github.com". Additive mode
  // has to keep filling them, or every existing domain group stops taking new tabs.
  const legacyTitles = new Map<string, string>();
  const toUngroup: number[] = [];

  // The ignore list was only ever enforced on the background's auto-group path, so /group
  // and the Group button happily grouped the very sites the user had excluded. Membership in
  // a protected group exempts a tab too — the rule path below would otherwise pull tabs out
  // of the very groups the name list protects.
  const candidates = freshTabs.filter(
    (t) =>
      !t.pinned &&
      !protectedGroups.has(t.groupId) &&
      !isIgnoredUrl(t.url || "", config.ignorePatterns)
  );
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
      const name = nameOf(tab.url || "");
      if (!name) continue;
      legacyTitles.set(domainOf(tab.url || ""), name);
      if (!nameMap.has(name)) nameMap.set(name, []);
      nameMap.get(name)!.push(tab);
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
        await gatherIntoGroup(entry.tabs, group.windowId, { groupId: group.id });
        ruleGroupMap.delete(ruleId);
        continue;
      }

      const name = nameMap.has(group.title) ? group.title : legacyTitles.get(group.title);
      const matching = name === undefined ? undefined : nameMap.get(name);
      if (name !== undefined && matching && matching.length > 0) {
        await gatherIntoGroup(matching, group.windowId, { groupId: group.id });
        nameMap.delete(name);
      }
    }
  }

  for (const [, entry] of ruleGroupMap) {
    if (entry.tabs.length < 1) continue;
    await gatherIntoGroup(entry.tabs, pickMajorityWindow(entry.tabs), {
      title: entry.rule.name,
      color: entry.rule.color,
    });
  }

  for (const [name, nameTabs] of nameMap) {
    if (nameTabs.length < 2) continue;
    await gatherIntoGroup(nameTabs, pickMajorityWindow(nameTabs), { title: name, color: domainGroupColor(name) });
  }

  const windows = await chrome.windows.getAll();
  for (const win of windows) {
    await organizeWindow(win.id!);
  }
  await collapseAllExceptActive();
  await applyAllGroupPins();
}

export interface GroupSpec {
  /** Join this live group instead of creating one. A joined group keeps its own properties. */
  groupId?: number;
  /** Where a new group goes. Left out, Chrome creates it in the window its tabs are in. */
  windowId?: number;
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
  collapsed?: boolean;
}

/**
 * Put `tabIds` into one group: `spec.groupId` when given, otherwise a new group in
 * `spec.windowId` with the title, colour and collapsed state `spec` gives. The tabs must already
 * sit in that window, since chrome.tabs.group rejects ids that span windows. Returns the group.
 */
export async function buildGroup(tabIds: number[], spec: GroupSpec): Promise<number> {
  if (spec.groupId !== undefined) return chrome.tabs.group({ tabIds, groupId: spec.groupId });
  const groupId = await chrome.tabs.group({
    tabIds,
    ...(spec.windowId !== undefined ? { createProperties: { windowId: spec.windowId } } : {}),
  });
  const { title, color, collapsed } = spec;
  await chrome.tabGroups.update(groupId, {
    ...(title !== undefined ? { title } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(collapsed !== undefined ? { collapsed } : {}),
  });
  return groupId;
}

/** buildGroup for tabs that may sit in other windows: those are moved to the end of `windowId` first. */
export async function gatherIntoGroup(
  tabs: chrome.tabs.Tab[],
  windowId: number,
  spec: Omit<GroupSpec, "windowId"> = {}
): Promise<number> {
  const strays = tabs.filter((t) => t.windowId !== windowId).map((t) => t.id!);
  if (strays.length > 0) await chrome.tabs.move(strays, { windowId, index: -1 });
  return buildGroup(tabs.map((t) => t.id!), { ...spec, windowId });
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

/** Chrome refuses edits to a shared group, so every path that would rewrite one has to ask. */
export function isSharedGroup(group: chrome.tabGroups.TabGroup): boolean {
  return (group as any).shared === true;
}

function domainGroupColor(name: string): chrome.tabGroups.ColorEnum {
  return GROUP_COLORS[Math.abs(hashCode(name)) % GROUP_COLORS.length];
}

export interface DomainGroupPlan {
  title: string;
  color: chrome.tabGroups.ColorEnum;
  /** A group already titled for this site, to join. */
  joinGroupId?: number;
}

/**
 * Where background auto-group puts a tab that no rule claimed: the group already titled for the
 * site, if there is one, and the title and colour a new group would get. Pure, so the one-tab-
 * group guarantee can be tested without the service worker.
 *
 * The caller joins `joinGroupId` if there is one and it still exists, and otherwise creates a
 * group only from the tab plus domainGroupPartners. A failed join used to fall back to a group of
 * the tab alone, which made a group of one — and a join fails precisely when the group is gone by
 * the time we reach it, auto-ungroup dissolving it for having one tab left among the ways.
 *
 * Partners are a separate step because they need the window's tabs and a join does not. Planning
 * both at once made every URL change fetch every tab in the window, and a join — the common case
 * once a site has its group — then threw the whole list away.
 */
export function planDomainGroup(
  url: string,
  windowGroups: chrome.tabGroups.TabGroup[],
  domainOf: DomainMapper,
  nameOf: DomainMapper
): DomainGroupPlan | null {
  const name = nameOf(url);
  if (!name) return null;
  const legacyTitle = domainOf(url);
  const join = windowGroups.find(
    (g) => !isSharedGroup(g) && (g.title === name || (!!legacyTitle && g.title === legacyTitle))
  );
  return { title: name, color: domainGroupColor(name), joinGroupId: join?.id };
}

/**
 * The other loose tabs of the site named `title`, which a new domain group for `tabId` takes in.
 * A new group needs at least one, or it would hold one tab. The caller only has to pass the
 * window's loose tabs, but anything grouped is filtered out here too.
 */
export function domainGroupPartners(
  tabId: number,
  title: string,
  windowTabs: chrome.tabs.Tab[],
  nameOf: DomainMapper,
  ignorePatterns: IgnoreRule[]
): number[] {
  // Pinned tabs and ignored URLs are never auto-grouped themselves, so they don't count as the
  // second tab either — the same exclusions groupTabsByDomain already makes.
  return windowTabs
    .filter(
      (t) =>
        t.id !== undefined &&
        t.id !== tabId &&
        t.groupId === -1 &&
        !t.pinned &&
        !isIgnoredUrl(t.url || "", ignorePatterns) &&
        nameOf(t.url || "") === title
    )
    .map((t) => t.id!);
}

/**
 * Groups an explicit command must leave intact: shared ones, which Chrome will not let us
 * edit, and the ones the user's ignore list protects by name.
 *
 * "Explicit command" deliberately includes commands the user typed. ungroupAll is one and it
 * already honours the name list — the list protects *the group*, not *the automation*, so a
 * command that dissolves a protected group is /ungroup wearing a different verb.
 *
 * Unlike ignoredGroupIds this always queries: its callers are one-shot user actions, not the
 * per-tab-event path that read is tuned for.
 */
export async function untouchableGroupIds(): Promise<Set<number>> {
  const config = await getConfig();
  const groups = await chrome.tabGroups.query({});
  return new Set(
    groups
      .filter((g) => isSharedGroup(g) || isIgnoredGroupName(g.title || "", config.ignoreGroupNames))
      .map((g) => g.id)
  );
}

/** Groups the user's ignore list protects. Empty list means no query at all — this runs on
 *  every group/ungroup and most profiles have no ignored names. */
async function ignoredGroupIds(ignoreGroupNames: IgnoreRule[]): Promise<Set<number>> {
  if (ignoreGroupNames.length === 0) return new Set();
  const groups = await chrome.tabGroups.query({});
  return new Set(
    groups.filter((g) => isIgnoredGroupName(g.title || "", ignoreGroupNames)).map((g) => g.id)
  );
}

export async function ungroupAll(): Promise<void> {
  const config = await getConfig();
  const protectedGroups = await ignoredGroupIds(config.ignoreGroupNames);
  const allTabs = await chrome.tabs.query({});
  const grouped = allTabs.filter(
    (t) => !t.pinned && t.groupId !== -1 && !protectedGroups.has(t.groupId)
  );
  if (grouped.length > 0) {
    await chrome.tabs.ungroup(grouped.map((t) => t.id!));
  }
}

async function collapseAllExceptActive(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const allGroups = await chrome.tabGroups.query({});

  // Only groups whose state is wrong get an update. Group and Regroup end here, and on a strip
  // that was already grouped every group was re-sent the state it already had.
  await Promise.all(allGroups.flatMap((group) => {
    const collapsed = !(activeTab && activeTab.groupId === group.id);
    return group.collapsed === collapsed ? [] : [chrome.tabGroups.update(group.id, { collapsed })];
  }));
}

export async function collapseAllGroups(): Promise<number> {
  const allGroups = await chrome.tabGroups.query({});
  await Promise.all(
    allGroups.filter((g) => !g.collapsed).map((g) => chrome.tabGroups.update(g.id, { collapsed: true }))
  );
  return allGroups.length;
}
