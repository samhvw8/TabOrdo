// The service worker's side of position locks (lib/pin.ts): keeping a lock on its tab through
// navigation, and letting go of last session's tab ids after a restart.

import { syncPinUrl, clearPinTabIds } from "./pin.ts";
import { setTitleBadge } from "./tabs/index.ts";

/** tabs.onUpdated: sync a locked tab's URL and title when it navigates or finishes loading. */
export async function syncLockedTab(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): Promise<void> {
  const navDone = changeInfo.status === "complete";
  if (!changeInfo.url && !changeInfo.title && !navDone) return;
  try {
    const pin = await syncPinUrl(tabId, tab.url || "", tab.title);
    // A full navigation tears down the injected MutationObserver with the page, leaving
    // the pin live but unbadged — re-apply once the new document has settled. Idempotent
    // in-page, so the title echo this causes converges instead of looping.
    if (pin && navDone) await setTitleBadge(tabId, true);
  } catch (e) {
    console.error("[TabOrdo] pin URL sync error:", e);
  }
}

/**
 * runtime.onStartup. Tab ids are per-browser-session, and the new session reuses the same small
 * range — a stale pin.tabId therefore lands on an unrelated tab, and syncPinUrl (tabId-only
 * match) would rewrite the pin to wherever that tab goes. Shed them; URL matching backfills
 * fresh ids. Deliberately not in onInstalled: an extension reload keeps the browser session, so
 * the stored ids are still the right tabs there.
 */
export async function resetLocksAfterRestart(): Promise<void> {
  await clearPinTabIds().catch((e) => console.error("[TabOrdo] pin tabId reset:", e));
}
