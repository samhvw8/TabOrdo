// Finding and closing duplicate tabs.

import type { TabInfo } from "./types.ts";
import { getAllTabs } from "./query.ts";
import { snapshotBeforeClose } from "../undo.ts";
import { getPinnedTabs, type PinnedTabEntry } from "../pin.ts";

export async function findDuplicates(): Promise<Map<string, TabInfo[]>> {
  const tabs = await getAllTabs();
  const urlMap = new Map<string, TabInfo[]>();

  for (const tab of tabs) {
    const normalized = normalizeUrl(tab.url);
    if (!normalized) continue;
    if (!urlMap.has(normalized)) urlMap.set(normalized, []);
    urlMap.get(normalized)!.push(tab);
  }

  const duplicates = new Map<string, TabInfo[]>();
  for (const [url, group] of urlMap) {
    if (group.length > 1) duplicates.set(url, group);
  }
  return duplicates;
}

/**
 * Tab ids in `tabs` that a position pin resolves to — at most ONE per pin, tabId before URL,
 * the order applyPinsToGroup and getPinForTab already use. Resolving to a set rather than a
 * predicate matters: two identical-URL copies inside one pinned group both match the same
 * entry, and treating both as pinned would leave dedup with nothing to close.
 */
function pinnedTabIds(tabs: TabInfo[], pins: PinnedTabEntry[]): Set<number> {
  const ids = new Set<number>();
  for (const pin of pins) {
    const inGroup = tabs.filter((t) => t.groupTitle === pin.groupName);
    const match = inGroup.find((t) => t.id === pin.tabId) ?? inGroup.find((t) => t.url === pin.url);
    if (match) ids.add(match.id);
  }
  return ids;
}

export async function removeDuplicates(): Promise<number> {
  const duplicates = await findDuplicates();
  // Nothing to protect, so don't pay for the pin registry read on the common no-dupes path.
  if (duplicates.size === 0) return 0;
  const pins = await getPinnedTabs();
  const toClose: number[] = [];

  for (const [, tabs] of duplicates) {
    // A pin is a deliberate keep — Chrome's own, or one of ours from /pin. Picking the
    // survivor purely by lastAccessed closed it whenever another copy had been touched more
    // recently, so the one copy the user asked to keep was the one that went. Honouring only
    // the native flag left the same hole open for position pins.
    const positionPinned = pinnedTabIds(tabs, pins);
    const kept: TabInfo[] = [];
    const closable: TabInfo[] = [];
    for (const t of tabs) (t.pinned || positionPinned.has(t.id) ? kept : closable).push(t);
    if (closable.length === 0) continue;
    closable.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    // A pinned copy is already the survivor, so every unpinned copy is a duplicate of it.
    const firstToClose = kept.length > 0 ? 0 : 1;
    for (let i = firstToClose; i < closable.length; i++) {
      toClose.push(closable[i].id);
    }
  }

  if (toClose.length > 0) {
    // Snapshot here rather than at the call sites. Both popup paths took a *group* snapshot,
    // which dedup never changes — so undo restored grouping and left the closed duplicates
    // gone — and the action-menu entry took no snapshot at all. Owning it inside the mutation
    // is the only version that can't be forgotten at a fourth call site.
    await snapshotBeforeClose(toClose);
    await chrome.tabs.remove(toClose);
  }
  return toClose.length;
}

/** Params that identify the click, not the page — two copies of one article arriving from
 *  different campaigns are still the same tab. */
const TRACKING_PARAMS = new Set(["fbclid", "gclid"]);

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:") return null;
    // The query and hash are part of the page's identity: keying on the path alone made
    // youtube.com/watch?v=A and ?v=B the same tab, and closed one of them. Tracking cruft is
    // the exception — stripping it keeps a shared link deduping against the original.
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
    }
    return `${u.protocol}//${u.host}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}
