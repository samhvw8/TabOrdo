// Ordering tabs inside a window or a group, honouring position locks.

import { getDomainMapper, type DomainMapper } from "../url.ts";
import { getPinnedTabs, applyGroupPinsToWindow, type PinnedTabEntry } from "../pin.ts";

export async function sortTabsInWindow(
  windowId: number,
  by: "title" | "url" | "domain" = "domain"
): Promise<void> {
  await organizeWindow(windowId, by);
  await applyGroupPinsToWindow(windowId);
}

export async function sortTabsInGroup(
  groupId: number,
  by: "title" | "url" | "domain" = "title"
): Promise<void> {
  const tabs = await chrome.tabs.query({ groupId });
  const group = (await chrome.tabGroups.query({})).find((g) => g.id === groupId);
  const domainOf = await getDomainMapper();
  const ordered = group?.title
    ? pinAwareSortTabs(tabs, group.title, await getPinnedTabs(), by, domainOf)
    : tabs.sort((a, b) => compareTabs(a, b, by, domainOf));
  const ids = ordered.map((t) => t.id!);
  if (ids.length > 0) {
    await chrome.tabs.move(ids, { index: -1 });
    await chrome.tabs.group({ tabIds: ids, groupId });
  }
}

export async function organizeWindow(
  windowId: number,
  by: "title" | "url" | "domain" = "domain"
): Promise<void> {
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  const allPins = await getPinnedTabs();
  const domainOf = await getDomainMapper();
  const pinnedCount = tabs.filter((t) => t.pinned).length;

  const groupMap = new Map<number, { group: chrome.tabGroups.TabGroup; tabs: chrome.tabs.Tab[] }>();
  const ungrouped: chrome.tabs.Tab[] = [];

  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (tab.groupId !== -1) {
      if (!groupMap.has(tab.groupId)) {
        const g = groups.find((gr) => gr.id === tab.groupId);
        if (g) groupMap.set(tab.groupId, { group: g, tabs: [] });
      }
      groupMap.get(tab.groupId)?.tabs.push(tab);
    } else {
      ungrouped.push(tab);
    }
  }

  const sortedGroups = [...groupMap.values()].sort((a, b) =>
    (a.group.title || "").localeCompare(b.group.title || "")
  );

  for (const entry of sortedGroups) {
    entry.tabs = entry.group.title
      ? pinAwareSortTabs(entry.tabs, entry.group.title, allPins, by, domainOf)
      : entry.tabs.sort((a, b) => compareTabs(a, b, by, domainOf));
  }
  ungrouped.sort((a, b) => compareTabs(a, b, by, domainOf));

  let index = pinnedCount;

  for (const entry of sortedGroups) {
    const ids = entry.tabs.map((t) => t.id!);
    if (ids.length > 0) {
      await chrome.tabs.move(ids, { index });
      index += ids.length;
      await chrome.tabs.group({ tabIds: ids, groupId: entry.group.id });
    }
  }

  const ungroupedIds = ungrouped.map((t) => t.id!);
  if (ungroupedIds.length > 0) {
    await chrome.tabs.move(ungroupedIds, { index });
  }
}

function pinAwareSortTabs(
  tabs: chrome.tabs.Tab[],
  groupTitle: string,
  allPins: PinnedTabEntry[],
  by: "title" | "url" | "domain",
  domainOf: DomainMapper
): chrome.tabs.Tab[] {
  const groupPins = allPins.filter((p) => p.groupName === groupTitle);
  if (groupPins.length === 0) return tabs.sort((a, b) => compareTabs(a, b, by, domainOf));

  const tabIdMap = new Map(groupPins.filter((p) => p.tabId).map((p) => [p.tabId!, p.position]));
  const urlMap = new Map(groupPins.map((p) => [p.url, p.position]));
  const pinned: { tab: chrome.tabs.Tab; pos: number }[] = [];
  const unpinned: chrome.tabs.Tab[] = [];

  for (const tab of tabs) {
    const pos = tabIdMap.get(tab.id!) ?? urlMap.get(tab.url ?? "");
    if (pos !== undefined) {
      pinned.push({ tab, pos });
    } else {
      unpinned.push(tab);
    }
  }

  pinned.sort((a, b) => a.pos - b.pos);
  unpinned.sort((a, b) => compareTabs(a, b, by, domainOf));

  const result: chrome.tabs.Tab[] = [];
  let ui = 0;
  const pinnedByPos = new Map(pinned.map((p) => [p.pos, p.tab]));
  const totalLen = tabs.length;

  for (let i = 0; i < totalLen; i++) {
    if (pinnedByPos.has(i)) {
      result.push(pinnedByPos.get(i)!);
    } else if (ui < unpinned.length) {
      result.push(unpinned[ui++]);
    }
  }
  while (ui < unpinned.length) result.push(unpinned[ui++]);
  for (const p of pinned) {
    if (!result.includes(p.tab)) result.push(p.tab);
  }

  return result;
}

function compareTabs(
  a: chrome.tabs.Tab,
  b: chrome.tabs.Tab,
  by: "title" | "url" | "domain",
  domainOf: DomainMapper
): number {
  switch (by) {
    case "title":
      return (a.title || "").localeCompare(b.title || "");
    case "url":
      return (a.url || "").localeCompare(b.url || "");
    case "domain": {
      const domA = domainOf(a.url || "");
      const domB = domainOf(b.url || "");
      return domA.localeCompare(domB) || (a.title || "").localeCompare(b.title || "");
    }
  }
}
