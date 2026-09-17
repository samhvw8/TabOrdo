export interface PinnedTabEntry {
  id: string;
  url: string;
  title?: string;
  tabId?: number;
  groupName: string;
  position: number;
}

const STORAGE_KEY = "pinnedTabs";
const GROUP_STORAGE_KEY = "pinnedGroups";

// Both lock lists sit on the service worker's hottest paths: syncPinUrl runs on every url, title
// and status event of every tab, and organizeWindow on every tab that finishes loading — each
// one a storage round-trip for a list that almost never changes. Same cache as getConfig in
// rules.ts, with the same rules, for the same bugs:
//  - armed only once storage.onChanged is subscribed, so a context without it (the test stub
//    at import time) keeps reading straight through;
//  - dropped by any change to its key, from any context;
//  - primed by a read, and by a write only once the write has landed — a rejected set must not
//    leave behind a list that was never stored and that no onChanged will ever invalidate;
//  - handed out as copies, because callers edit what they get.
// Read-modify-write paths bypass it (`fresh`). The worker, the popup and the side panel each
// hold their own cache, and a write built on a copy whose invalidation had not arrived yet
// would silently revert the other context's change.
let cachedPins: PinnedTabEntry[] | null = null;
let cachedGroupPins: PinnedGroupEntry[] | null = null;
let cacheArmed = false;

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) cachedPins = null;
    if (changes[GROUP_STORAGE_KEY]) cachedGroupPins = null;
  });
  cacheArmed = true;
} catch {}

/** Prefix the injected title badge adds (see lib/tabs/lock.ts). Lives here so the sync paths
 *  can strip it before storing a title — otherwise the onUpdated echo of applying the badge
 *  writes "📌 Title" into the pin entry itself. */
export const PIN_BADGE = "📌 ";

export function stripPinBadge(title?: string): string | undefined {
  return title?.startsWith(PIN_BADGE) ? title.slice(PIN_BADGE.length) : title;
}

/** Pass `fresh` when the result feeds a write — see the cache comment above. */
export async function getPinnedTabs(fresh = false): Promise<PinnedTabEntry[]> {
  if (!fresh && cacheArmed && cachedPins) return structuredClone(cachedPins);
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const pins: PinnedTabEntry[] = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  cachedPins = pins;
  return structuredClone(pins);
}

export async function savePinnedTabs(pins: PinnedTabEntry[]): Promise<void> {
  const plain = JSON.parse(JSON.stringify(pins));
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: plain });
    cachedPins = plain;
  } catch (e) {
    cachedPins = null;
    throw e;
  }
}

export async function pinTab(url: string, groupName: string, position: number, title?: string, tabId?: number): Promise<PinnedTabEntry> {
  const pins = await getPinnedTabs(true);
  const existing = pins.find((p) =>
    p.groupName === groupName && (p.url === url || (tabId && p.tabId === tabId))
  );
  if (existing) {
    existing.position = position;
    existing.url = url;
    if (title) existing.title = title;
    if (tabId) existing.tabId = tabId;
    await savePinnedTabs(pins);
    return existing;
  }
  for (const p of pins) {
    if (p.groupName === groupName && p.position >= position) p.position++;
  }
  const entry: PinnedTabEntry = { id: crypto.randomUUID(), url, title, tabId, groupName, position };
  pins.push(entry);
  await savePinnedTabs(pins);
  return entry;
}

/**
 * Resolve by tabId first, then URL — the same order pinTab and getPinForTab use. Matching on
 * URL alone made the button lie: getPinForTab would light up "Unlock" off a tabId match while
 * this failed to find the entry and reported "Tab was not pinned".
 */
export async function unpinTab(url: string, groupName: string, tabId?: number): Promise<boolean> {
  const pins = await getPinnedTabs(true);
  let idx = tabId
    ? pins.findIndex((p) => p.tabId === tabId && p.groupName === groupName)
    : -1;
  if (idx === -1) idx = pins.findIndex((p) => p.url === url && p.groupName === groupName);
  if (idx === -1) return false;
  pins.splice(idx, 1);
  await savePinnedTabs(pins);
  return true;
}

export async function reorderPins(groupName: string, orderedUrls: string[]): Promise<void> {
  const pins = await getPinnedTabs(true);
  for (let i = 0; i < orderedUrls.length; i++) {
    const pin = pins.find((p) => p.url === orderedUrls[i] && p.groupName === groupName);
    if (pin) pin.position = i;
  }
  await savePinnedTabs(pins);
}

export function getPinForTab(url: string, groupName: string, pins: PinnedTabEntry[], tabId?: number): PinnedTabEntry | undefined {
  if (tabId) {
    const byTabId = pins.find((p) => p.tabId === tabId && p.groupName === groupName);
    if (byTabId) return byTabId;
  }
  return pins.find((p) => p.url === url && p.groupName === groupName);
}

/** Returns the pin tracking `tabId` (updated in place), or null if the tab isn't pinned —
 *  the caller uses that to know whether to re-apply the title badge after a navigation.
 *
 *  Almost every event this sees is for a tab no lock tracks, or for a locked tab whose url and
 *  title have not changed, so a warm cache answers both without touching storage. Only a real
 *  change pays for a fresh read-modify-write. The price is a lock made in another context in
 *  the moment before its onChanged arrives here: that one event is missed, and the next url,
 *  title or status event of the tab catches up. */
export async function syncPinUrl(tabId: number, newUrl: string, newTitle?: string): Promise<PinnedTabEntry | null> {
  const cleanTitle = stripPinBadge(newTitle);
  const outdated = (pin: PinnedTabEntry) =>
    (!!newUrl && pin.url !== newUrl) || (!!cleanTitle && pin.title !== cleanTitle);

  if (cacheArmed && cachedPins) {
    const known = cachedPins.find((p) => p.tabId === tabId);
    if (!known) return null;
    if (!outdated(known)) return structuredClone(known);
  }

  const pins = await getPinnedTabs(true);
  const pin = pins.find((p) => p.tabId === tabId);
  if (!pin) return null;
  if (!outdated(pin)) return pin;
  if (newUrl) pin.url = newUrl;
  if (cleanTitle) pin.title = cleanTitle;
  await savePinnedTabs(pins);
  return pin;
}

/**
 * Called from runtime.onStartup. Tab ids do not survive a browser restart, and Chrome hands
 * the new session's ids out from the same small range — so a stale pin.tabId will collide
 * with an unrelated tab, and syncPinUrl (which matches by tabId alone) would then rewrite
 * the pin to wherever that tab navigates. URL matching backfills fresh ids afterwards.
 */
export async function clearPinTabIds(): Promise<void> {
  const pins = await getPinnedTabs(true);
  let changed = false;
  for (const p of pins) {
    if (p.tabId !== undefined) {
      delete p.tabId;
      changed = true;
    }
  }
  if (changed) await savePinnedTabs(pins);
}

export async function applyPinsToGroup(
  groupId: number,
  groupTitle: string
): Promise<number> {
  const pins = await getPinnedTabs();
  const groupPins = pins.filter((p) => p.groupName === groupTitle);
  if (groupPins.length === 0) return 0;

  let tabs = (await chrome.tabs.query({ groupId })).sort((a, b) => a.index - b.index);
  if (tabs.length === 0) return 0;

  let moved = 0;

  const sorted = [...groupPins].sort((a, b) => a.position - b.position);
  for (const pin of sorted) {
    const tab = (pin.tabId && tabs.find((t) => t.id === pin.tabId)) || tabs.find((t) => t.url === pin.url);
    if (!tab) continue;
    const baseIndex = tabs[0].index;
    const targetIndex = Math.min(baseIndex + pin.position, baseIndex + tabs.length - 1);
    if (tab.index !== targetIndex) {
      await chrome.tabs.move(tab.id!, { index: targetIndex });
      moved++;
      // Moving a tab shifts every index after it. Re-read before placing the next pin,
      // otherwise pins 2..n are positioned against indices that no longer exist.
      tabs = (await chrome.tabs.query({ groupId })).sort((a, b) => a.index - b.index);
    }
  }

  if (moved > 0) {
    const freshTabs = await chrome.tabs.query({ groupId });
    await chrome.tabs.group({ tabIds: freshTabs.map((t) => t.id!), groupId });
  }

  return moved;
}

export interface PinnedGroupEntry {
  id: string;
  groupTitle: string;
  position: number;
}

/** Pass `fresh` when the result feeds a write — see the cache comment at the top. */
export async function getPinnedGroups(fresh = false): Promise<PinnedGroupEntry[]> {
  if (!fresh && cacheArmed && cachedGroupPins) return structuredClone(cachedGroupPins);
  const data = await chrome.storage.local.get(GROUP_STORAGE_KEY);
  const pins: PinnedGroupEntry[] = Array.isArray(data[GROUP_STORAGE_KEY]) ? data[GROUP_STORAGE_KEY] : [];
  cachedGroupPins = pins;
  return structuredClone(pins);
}

export async function savePinnedGroups(pins: PinnedGroupEntry[]): Promise<void> {
  const plain = JSON.parse(JSON.stringify(pins));
  try {
    await chrome.storage.local.set({ [GROUP_STORAGE_KEY]: plain });
    cachedGroupPins = plain;
  } catch (e) {
    cachedGroupPins = null;
    throw e;
  }
}

export async function pinGroup(groupTitle: string, position: number): Promise<PinnedGroupEntry> {
  const pins = await getPinnedGroups(true);
  const existing = pins.find((p) => p.groupTitle === groupTitle);
  if (existing) {
    existing.position = position;
    await savePinnedGroups(pins);
    return existing;
  }
  for (const p of pins) {
    if (p.position >= position) p.position++;
  }
  const entry: PinnedGroupEntry = { id: crypto.randomUUID(), groupTitle, position };
  pins.push(entry);
  await savePinnedGroups(pins);
  return entry;
}

export async function unpinGroup(groupTitle: string): Promise<boolean> {
  const pins = await getPinnedGroups(true);
  const idx = pins.findIndex((p) => p.groupTitle === groupTitle);
  if (idx === -1) return false;
  pins.splice(idx, 1);
  await savePinnedGroups(pins);
  return true;
}

// Tab-strip index at which a group must start to end up at `targetPos` (0-based) among the
// window's groups. Walks the strip counting group boundaries and skipping the group being
// moved. Shared by /movegroup and the group-pin applier, which used to carry separate copies.
export function groupStartIndex(
  tabs: chrome.tabs.Tab[],
  groupId: number,
  targetPos: number,
  pinnedCount: number
): number {
  if (targetPos <= 0) return pinnedCount;
  const strip = [...tabs].filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
  let seenGroups = 0;
  let lastGroupId = -1;
  let targetIndex = pinnedCount;
  for (const t of strip) {
    if (t.groupId !== -1 && t.groupId !== lastGroupId && t.groupId !== groupId) {
      seenGroups++;
      if (seenGroups > targetPos) break;
      lastGroupId = t.groupId;
    } else if (t.groupId === -1) {
      lastGroupId = -1;
    }
    if (t.groupId !== groupId) targetIndex = t.index + 1;
  }
  return targetIndex;
}

export function buildGroupOrder(tabs: chrome.tabs.Tab[]): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  for (const t of [...tabs].filter((t) => !t.pinned).sort((a, b) => a.index - b.index)) {
    if (t.groupId !== -1 && !seen.has(t.groupId)) {
      seen.add(t.groupId);
      order.push(t.groupId);
    }
  }
  return order;
}

interface GroupPinMove {
  groupId: number;
  /** The group's tabs in strip order. */
  tabIds: number[];
  /** As passed to tabs.move. */
  index: number;
  /**
   * Whether a local copy of the strip can say where this move lands. groupStartIndex counts
   * the index with the group still in place, while tabs.move reads it with the group already
   * lifted out; the two agree when the group travels leftward (every tab of it sits at or past
   * the index) or goes to the very end. A rightward move to any other slot lands past the slot
   * it was aimed at — and Chrome, moving the ids one at a time, lands a multi-tab group
   * somewhere else again — so after one of those only a fresh query knows the strip.
   */
  predictable: boolean;
}

/** Group pins in the order the pass applies them. A copy: callers share the list. */
function byPosition(pins: PinnedGroupEntry[]): PinnedGroupEntry[] {
  return [...pins].sort((a, b) => a.position - b.position);
}

/** What the group-pin pass does for `pin` on `tabs` (one window), or null if it leaves it. */
function planGroupPinMove(
  tabs: chrome.tabs.Tab[],
  groups: chrome.tabGroups.TabGroup[],
  pin: PinnedGroupEntry,
  pinnedCount: number
): GroupPinMove | null {
  const group = groups.find((g) => g.title === pin.groupTitle);
  if (!group) return null;

  const groupTabs = tabs.filter((t) => t.groupId === group.id).sort((a, b) => a.index - b.index);
  if (groupTabs.length === 0) return null;

  const groupOrder = buildGroupOrder(tabs);
  const currentPos = groupOrder.indexOf(group.id);
  const targetPos = Math.min(pin.position, groupOrder.length - 1);
  if (currentPos === targetPos) return null;

  const index = groupStartIndex(tabs, group.id, targetPos, pinnedCount);
  return {
    groupId: group.id,
    tabIds: groupTabs.map((t) => t.id!),
    index,
    predictable: index >= tabs.length || groupTabs.every((t) => t.index >= index),
  };
}

/** Re-index `tabs` (one window) the way a predictable GroupPinMove leaves the strip. */
function moveLocally(tabs: chrome.tabs.Tab[], move: GroupPinMove): void {
  const moving = new Set(move.tabIds);
  const strip = [...tabs].sort((a, b) => a.index - b.index);
  const rest = strip.filter((t) => !moving.has(t.id!));
  rest.splice(Math.min(move.index, rest.length), 0, ...strip.filter((t) => moving.has(t.id!)));
  rest.forEach((t, i) => { t.index = i; });
}

/**
 * Where the group-pin pass would leave a window, worked out on a copy of `tabs` without
 * touching Chrome — so organizeWindow can lay pinned groups down in their slots itself instead
 * of sorting them alphabetically and having the pass drag them back on every single sort.
 *
 * Returns the copy re-indexed, or null when there is no such layout to hand over: the pass
 * would make a move whose landing a copy cannot predict, or the strip it leaves is not one it
 * would leave alone on the next run (two pins clamped to one slot keep trading places). The
 * caller then keeps the plain alphabetical layout and lets the real pass do exactly what it
 * always did.
 */
export function settleGroupPins(
  tabs: chrome.tabs.Tab[],
  groups: chrome.tabGroups.TabGroup[],
  pins: PinnedGroupEntry[],
  pinnedCount: number
): chrome.tabs.Tab[] | null {
  const copy = tabs.map((t) => ({ ...t }));
  const ordered = byPosition(pins);
  for (const pin of ordered) {
    const move = planGroupPinMove(copy, groups, pin, pinnedCount);
    if (!move) continue;
    if (!move.predictable) return null;
    moveLocally(copy, move);
  }
  if (ordered.some((pin) => planGroupPinMove(copy, groups, pin, pinnedCount))) return null;
  return copy;
}

/**
 * `pins` lets a caller that already holds the list skip the read. sortTabsInWindow runs this
 * after organizeWindow has laid pinned groups out in their slots (see settleGroupPins), so on
 * the auto-sort path it normally finds nothing to move.
 */
export async function applyGroupPinsToWindow(windowId: number, pins?: PinnedGroupEntry[]): Promise<number> {
  const groupPins = pins ?? (await getPinnedGroups());
  if (groupPins.length === 0) return 0;

  // Copied because the pass re-indexes them in place; tabs.query's result is not ours to edit
  // (the test stub hands out its live state).
  let tabs = (await chrome.tabs.query({ windowId })).map((t) => ({ ...t }));
  const allGroups = await chrome.tabGroups.query({ windowId });
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  let moved = 0;

  for (const pin of byPosition(groupPins)) {
    const move = planGroupPinMove(tabs, allGroups, pin, pinnedCount);
    if (!move) continue;

    await chrome.tabs.move(move.tabIds, { index: move.index });
    await chrome.tabs.group({ tabIds: move.tabIds, groupId: move.groupId });
    moved++;

    // Moving a group shifts every index after it, so the next pin needs the strip as it is now.
    // That used to be a whole-window query after every pin; a copy says the same thing without
    // the round-trip, except after a move only Chrome can place.
    if (move.predictable) moveLocally(tabs, move);
    else tabs = (await chrome.tabs.query({ windowId })).map((t) => ({ ...t }));
  }

  return moved;
}

export async function applyAllGroupPins(): Promise<number> {
  const pins = await getPinnedGroups();
  if (pins.length === 0) return 0;

  const windows = await chrome.windows.getAll();
  let total = 0;
  for (const win of windows) {
    // The list is handed down rather than re-read once per window.
    if (win.id) total += await applyGroupPinsToWindow(win.id, pins);
  }
  return total;
}
