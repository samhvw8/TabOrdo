// The service worker's side of position locks (lib/pin.ts): keeping a lock on its tab through
// navigation, and matching locks back to their tabs after a browser restart.

import { syncPinUrl, clearPinTabIds, getPinnedTabs, savePinnedTabs, reconcilePins } from "./pin.ts";
import { setTitleBadge } from "./tabs/index.ts";
import { createDebouncer, type Debouncer } from "./debounce.ts";

// Session restore creates a window's tabs one after another, then puts them in their groups and
// titles the groups. One pass after the burst has settled sees them all in their titled groups,
// which reconcilePins needs to prefer the copy of a URL inside the lock's group.
export const RECONCILE_SETTLE_MS = 1000;

export interface LockSyncState {
  /** The restart reset while it runs, resolved otherwise. */
  reset: Promise<void>;
  reconcile: Debouncer;
}

export function createLockSyncState(): LockSyncState {
  return { reset: Promise.resolve(), reconcile: createDebouncer(RECONCILE_SETTLE_MS) };
}

/** tabs.onUpdated: sync a locked tab's URL and title when it navigates or finishes loading. */
export async function syncLockedTab(
  state: LockSyncState,
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): Promise<void> {
  const navDone = changeInfo.status === "complete";
  if (!changeInfo.url && !changeInfo.title && !navDone) return;
  try {
    // Chrome does not await listeners, so this can run while the restart reset is still in
    // flight. A sync that read the list first would match last session's id to whatever tab has
    // it now, and its write would put the id back after the reset.
    await state.reset;
    const pin = await syncPinUrl(tabId, tab.url || "", tab.title);
    // A full navigation tears down the injected MutationObserver with the page, leaving
    // the pin live but unbadged — re-apply once the new document has settled. Idempotent
    // in-page, so the title echo this causes converges instead of looping.
    if (pin) {
      if (navDone) await setTitleBadge(tabId, true);
      return;
    }
    if (changeInfo.url || navDone) await noticeUrl(state, tab.url);
  } catch (e) {
    console.error("[TabOrdo] pin URL sync error:", e);
  }
}

/** tabs.onCreated: a restored tab can be the one a lock is waiting for. */
export async function noticeTab(state: LockSyncState, tab: chrome.tabs.Tab): Promise<void> {
  try {
    await noticeUrl(state, tab.url || tab.pendingUrl);
  } catch (e) {
    console.error("[TabOrdo] lock match check:", e);
  }
}

/** Schedule a reconcile when a lock with no tab has this URL. The lock list is cached, so the
 *  common case, no lock waiting, costs no storage read. */
async function noticeUrl(state: LockSyncState, url: string | undefined): Promise<void> {
  if (!url) return;
  const pins = await getPinnedTabs();
  if (pins.some((p) => p.tabId === undefined && p.url === url)) scheduleReconcile(state);
}

/**
 * runtime.onStartup. Tab ids are per-browser-session, and the new session reuses the same small
 * range — a stale pin.tabId therefore lands on an unrelated tab, and syncPinUrl (tabId-only
 * match) would rewrite the pin to wherever that tab goes. Shed them, then match the locks to the
 * restored tabs by URL. Deliberately not in onInstalled: an extension reload keeps the browser
 * session, so the stored ids are still the right tabs there.
 */
export function resetLocksAfterRestart(state: LockSyncState): Promise<void> {
  state.reset = clearPinTabIds().catch((e) => console.error("[TabOrdo] pin tabId reset:", e));
  scheduleReconcile(state);
  return state.reset;
}

function scheduleReconcile(state: LockSyncState): void {
  state.reconcile.schedule(async () => {
    await state.reset;
    await reconcileLocks().catch((e) => console.error("[TabOrdo] lock reconcile:", e));
  });
}

/** Match every lock to the open tabs, save what changed, and badge the tabs newly matched. */
async function reconcileLocks(): Promise<void> {
  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  const pins = await getPinnedTabs(true);
  const { changed, adopted } = reconcilePins(pins, tabs, groups);
  if (changed) await savePinnedTabs(pins);
  // A restored tab that has not loaded yet refuses the injection. It is badged when it loads,
  // by syncLockedTab, which now finds the lock by its id.
  await Promise.all(adopted.map((id) => setTitleBadge(id, true)));
}
