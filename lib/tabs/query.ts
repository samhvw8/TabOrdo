// Reading the tab strip, and the two most primitive mutations.

import type { TabInfo } from "./types.ts";

export async function getAllTabs(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({});
  const groups = await getAllGroups();
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

export async function closeTabs(tabIds: number[]): Promise<void> {
  await chrome.tabs.remove(tabIds);
}
