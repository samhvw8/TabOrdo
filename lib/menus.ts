// The two entry points on the action icon that the service worker serves itself: the
// right-click menu, and the open-dashboard shortcut.

import { groupTabsByDomain, removeDuplicates, sortTabsInWindow } from "./tabs/index.ts";
import { addToReadingList } from "./readinglist.ts";
import { withBulkLock } from "./bulklock.ts";

/** Built from runtime.onInstalled. removeAll first, because an update re-runs it. */
export function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "tabOrdo-group-domain", title: "Group tabs by domain", contexts: ["action"] });
    chrome.contextMenus.create({ id: "tabOrdo-dedup", title: "Remove duplicate tabs", contexts: ["action"] });
    chrome.contextMenus.create({ id: "tabOrdo-sort", title: "Sort tabs by domain", contexts: ["action"] });
    chrome.contextMenus.create({ type: "separator", id: "tabOrdo-sep1", contexts: ["action"] });
    chrome.contextMenus.create({ id: "tabOrdo-readlater", title: "Save to Reading List", contexts: ["action"] });
    chrome.contextMenus.create({ id: "tabOrdo-discard", title: "Discard inactive tabs", contexts: ["action"] });
    chrome.contextMenus.create({ type: "separator", id: "tabOrdo-sep2", contexts: ["action"] });
    chrome.contextMenus.create({ id: "tabOrdo-sidepanel", title: "Open in Side Panel", contexts: ["action"] });
  });
}

export async function runMenuItem(menuItemId: string | number): Promise<void> {
  try {
    switch (menuItemId) {
      // These three do the same bulk rearranging the palette does, so they need the same
      // suppression — without it the auto-group/sort/ungroup listeners react to the very
      // mutations these are making. The palette wrapped them; this path never did.
      case "tabOrdo-group-domain":
        await withBulkLock(() => groupTabsByDomain("additive"));
        break;
      case "tabOrdo-dedup":
        await withBulkLock(() => removeDuplicates());
        break;
      case "tabOrdo-sort": {
        const win = await chrome.windows.getCurrent();
        await withBulkLock(() => sortTabsInWindow(win.id!));
        break;
      }
      case "tabOrdo-readlater": {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && tab.title) await addToReadingList(tab.url, tab.title);
        break;
      }
      case "tabOrdo-discard": {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (!tab.active && !tab.pinned && !tab.audible && !tab.discarded) {
            await chrome.tabs.discard(tab.id!).catch(() => {});
          }
        }
        break;
      }
      case "tabOrdo-sidepanel":
        await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id! });
        break;
    }
  } catch (e) {
    console.error("[TabOrdo] context menu error:", e);
  }
}

export async function openDashboard(): Promise<void> {
  // The flag is consumed by the popup on mount. If openPopup fails (it rejects when no window
  // is focused) a stale flag would sit in session storage and silently steal search autofocus
  // from the *next* ordinary Cmd+E open.
  await chrome.storage.session.set({ openMode: "dashboard" });
  try {
    await chrome.action.openPopup();
  } catch (e) {
    console.warn("[TabOrdo] openPopup failed:", e);
    await chrome.storage.session.remove("openMode").catch(() => {});
  }
}
