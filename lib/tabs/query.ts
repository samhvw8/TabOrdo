// Reading the tab strip, and the two most primitive mutations.

import type { TabInfo } from "./types.ts";

export async function getAllTabs(): Promise<TabInfo[]> {
  // The group query does not depend on the tab query; awaiting them in turn doubled the
  // latency of the single call the popup blocks on before it can paint.
  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), getAllGroups()]);
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  return tabs.map((tab) => {
    const group = groupMap.get(tab.groupId);
    return {
      id: tab.id!,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      active: tab.active,
      groupId: tab.groupId,
      groupTitle: group?.title,
      groupColor: group?.color,
      audible: tab.audible,
      mutedInfo: tab.mutedInfo,
      discarded: tab.discarded,
      frozen: (tab as any).frozen,
      lastAccessed: tab.lastAccessed,
    };
  });
}

export async function getCurrentWindowTabs(): Promise<TabInfo[]> {
  const all = await getAllTabs();
  const currentWindow = await chrome.windows.getCurrent();
  return all.filter((t) => t.windowId === currentWindow.id);
}

export async function getAllGroups(): Promise<chrome.tabGroups.TabGroup[]> {
  return chrome.tabGroups.query({});
}

export async function switchToTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
}

/** Resolves to the number of tabs actually closed. Ids that had already gone are skipped
 *  rather than counted, so a caller can report what it delivered and not what it attempted. */
export async function closeTabs(tabIds: number[]): Promise<number> {
  // Per id, not one remove(array): Chrome rejects the whole array on the first id that has
  // already gone, so a single stale tab in the popup's list left every other tab open.
  const results = await Promise.allSettled(tabIds.map((id) => chrome.tabs.remove(id)));
  return results.filter((r) => r.status === "fulfilled").length;
}
