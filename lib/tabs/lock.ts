// Position locks: hold a tab or group at an index, with the title badge that marks it.

import { pinTab, unpinTab, getPinnedTabs, applyPinsToGroup, pinGroup, unpinGroup,
         applyGroupPinsToWindow, buildGroupOrder, PIN_BADGE } from "../pin.ts";

// Injected into the page. Prepends a pin badge to document.title and keeps it
// applied across SPA title changes via a MutationObserver stored on window.
function applyTitleBadgeInPage(badge: string): void {
  const w = window as unknown as { __tabordoPinObserver?: MutationObserver };
  if (!document.title.startsWith(badge)) document.title = badge + document.title;
  if (w.__tabordoPinObserver) return;
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  const obs = new MutationObserver(() => {
    if (!document.title.startsWith(badge)) document.title = badge + document.title;
  });
  obs.observe(titleEl, { childList: true });
  w.__tabordoPinObserver = obs;
}

// Injected into the page. Removes the badge and disconnects the observer.
function removeTitleBadgeInPage(badge: string): void {
  const w = window as unknown as { __tabordoPinObserver?: MutationObserver };
  if (w.__tabordoPinObserver) {
    w.__tabordoPinObserver.disconnect();
    delete w.__tabordoPinObserver;
  }
  if (document.title.startsWith(badge)) document.title = document.title.slice(badge.length);
}

/** Exported for the background's pin URL sync listener (a navigation wipes the injected
 *  badge) and the pins panel's unpin button. Injection failures are logged, never thrown. */
export async function setTitleBadge(tabId: number, on: boolean): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: on ? applyTitleBadgeInPage : removeTitleBadgeInPage,
      args: [PIN_BADGE],
    });
  } catch (e) {
    console.warn("[TabOrdo] title badge inject failed:", e);
  }
}

export async function pinCurrentTab(posStr: string): Promise<string> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id || !active.url) return "No active tab";
  if (active.groupId === -1) return "Tab is not in a group";

  const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
  if (!group?.title) return "Group has no title";

  const groupTabs = (await chrome.tabs.query({ groupId: active.groupId })).sort((a, b) => a.index - b.index);

  const existingPins = (await getPinnedTabs()).filter((p) => p.groupName === group.title);

  let position: number;
  const trimmed = posStr.trim();
  if (!trimmed) {
    position = existingPins.length;
  } else if (trimmed === "^") {
    position = 0;
  } else if (trimmed === "$") {
    position = groupTabs.length - 1;
  } else {
    const n = parseInt(trimmed, 10);
    if (isNaN(n) || n < 1) return "Usage: /pin [^|$|number]";
    position = Math.min(n - 1, groupTabs.length - 1);
  }

  await pinTab(active.url, group.title, position, active.title, active.id);
  await applyPinsToGroup(active.groupId, group.title);
  await setTitleBadge(active.id, true);
  return `Pinned at position ${position + 1} in "${group.title}"`;
}

export async function unpinCurrentTab(): Promise<string> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id || !active.url) return "No active tab";
  if (active.groupId === -1) return "Tab is not in a group";

  const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
  if (!group?.title) return "Group has no title";

  const removed = await unpinTab(active.url, group.title, active.id);
  if (removed) await setTitleBadge(active.id, false);
  return removed ? `Unpinned from "${group.title}"` : "Tab was not pinned";
}

export async function pinCurrentGroup(posStr: string): Promise<string> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || active.groupId === -1) return "Active tab is not in a group";

  const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
  if (!group?.title) return "Group has no title";

  const tabs = await chrome.tabs.query({ windowId: active.windowId });
  const groupOrder = buildGroupOrder(tabs);

  let position: number;
  const trimmed = posStr.trim();
  if (!trimmed) {
    const idx = groupOrder.indexOf(active.groupId);
    position = idx === -1 ? 0 : idx;
  } else if (trimmed === "^") {
    position = 0;
  } else if (trimmed === "$") {
    position = Math.max(0, groupOrder.length - 1);
  } else {
    const n = parseInt(trimmed, 10);
    if (isNaN(n) || n < 1) return "Usage: /pingroup [^|$|number]";
    position = Math.min(n - 1, groupOrder.length - 1);
  }

  await pinGroup(group.title, position);
  await applyGroupPinsToWindow(active.windowId);
  return `Pinned group "${group.title}" at position ${position + 1}`;
}

export async function unpinCurrentGroup(): Promise<string> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || active.groupId === -1) return "Active tab is not in a group";

  const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
  if (!group?.title) return "Group has no title";

  const removed = await unpinGroup(group.title);
  return removed ? `Unpinned group "${group.title}"` : "Group was not pinned";
}
