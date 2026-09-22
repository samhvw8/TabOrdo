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

/** One group's `tabs` with each locked tab at its slot and the rest in `compare` order around
 *  them. A lock resolves by tabId before URL, so it follows its tab through a navigation. */
export function pinAwareSortTabs(
  tabs: chrome.tabs.Tab[],
  groupTitle: string,
  allPins: PinnedTabEntry[],
  compare: (a: chrome.tabs.Tab, b: chrome.tabs.Tab) => number
): chrome.tabs.Tab[] {
  const groupPins = allPins.filter((p) => p.groupName === groupTitle);
  if (groupPins.length === 0) return tabs.sort(compare);

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

  // Two locks on one slot: the tab id settles which holds it. Strip order did, so the pair traded
  // places on every sort.
  pinned.sort((a, b) => a.pos - b.pos || a.tab.id! - b.tab.id!);
  unpinned.sort(compare);

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

/** Puts a group's locked tabs at their slots, the rest keeping their order: the sort's own
 *  placement, in one move. Placing one lock at a time let each move shift the locks already
 *  placed, and cost a query per lock. */
export async function applyPinsToGroup(groupId: number, groupTitle: string): Promise<void> {
  const pins = await getPinnedTabs();
  if (!pins.some((p) => p.groupName === groupTitle)) return;

  const tabs = (await chrome.tabs.query({ groupId })).sort((a, b) => a.index - b.index);
  const ordered = pinAwareSortTabs([...tabs], groupTitle, pins, (a, b) => a.index - b.index);
  if (ordered.every((t, i) => t.id === tabs[i].id)) return;

  const ids = ordered.map((t) => t.id!);
  // To the group's own first index: every id sits at or right of it, so the batch lands in order.
  await chrome.tabs.move(ids, { index: tabs[0].index });
  await chrome.tabs.group({ tabIds: ids, groupId });
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
// window's groups: right before the group that will follow it, at the end when none will, and
// straight after the Chrome-pinned tabs for slot 0. Counted with the group lifted out of the
// strip, as tabGroups.move reads it; counting it in place overshot every move to the right.
export function groupStartIndex(
  tabs: chrome.tabs.Tab[],
  groupId: number,
  targetPos: number,
  pinnedCount: number
): number {
  if (targetPos <= 0) return pinnedCount;
  const rest = tabs.filter((t) => !t.pinned && t.groupId !== groupId).sort((a, b) => a.index - b.index);
  let seenGroups = 0;
  for (let i = 0; i < rest.length; i++) {
    const g = rest[i].groupId;
    if (g !== -1 && g !== rest[i - 1]?.groupId && seenGroups++ === targetPos) return pinnedCount + i;
  }
  return pinnedCount + rest.length;
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

/**
 * One window's `groups`, in the order they would otherwise take, with each locked group at
 * min(position, last slot) and the rest keeping their order around it.
 *
 * Locks asking for one slot (clamping makes that common: more locks than groups) take it in
 * turn: the lower position asked for first, then title order, then the order given. One that
 * finds its slot taken takes the next free one, and past the last slot they back up leftward.
 * The result maps to itself, so the sort and /lockgroup, each running this on the strip the
 * other left, agree and move nothing.
 */
export function lockedGroupOrder(
  groups: chrome.tabGroups.TabGroup[],
  pins: PinnedGroupEntry[]
): chrome.tabGroups.TabGroup[] {
  const last = groups.length - 1;
  const locked: { group: chrome.tabGroups.TabGroup; slot: number; position: number; at: number }[] = [];
  const free: chrome.tabGroups.TabGroup[] = [];
  groups.forEach((group, at) => {
    const pin = group.title ? pins.find((p) => p.groupTitle === group.title) : undefined;
    if (pin) locked.push({ group, slot: Math.min(pin.position, last), position: pin.position, at });
    else free.push(group);
  });
  locked.sort((a, b) =>
    a.slot - b.slot || a.position - b.position || a.group.title!.localeCompare(b.group.title!) || a.at - b.at
  );

  const order: chrome.tabGroups.TabGroup[] = [];
  let l = 0;
  let f = 0;
  while (order.length < groups.length) {
    const lockedNext = l < locked.length && (locked[l].slot <= order.length || f === free.length);
    order.push(lockedNext ? locked[l++].group : free[f++]);
  }
  return order;
}

/**
 * /lockgroup's pass. Moves each locked group to its place in lockedGroupOrder of the window's
 * groups as they stand, and nothing else. A locked group goes right after the group before it,
 * or right after the Chrome-pinned tabs when it leads: where the sort lays it too, so a sort
 * that follows finds it in place. tabGroups.move keeps a group whole in either direction; a
 * multi-tab tabs.move going right lands scattered, because Chrome places the ids one at a time.
 */
export async function applyGroupPinsToWindow(windowId: number): Promise<number> {
  const pins = await getPinnedGroups();
  if (pins.length === 0) return 0;

  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  const byId = new Map(groups.map((g) => [g.id, g]));
  const target = lockedGroupOrder(buildGroupOrder(tabs).flatMap((id) => byId.get(id) ?? []), pins);
  const lockedTitles = new Set(pins.map((p) => p.groupTitle));
  const pinnedCount = tabs.filter((t) => t.pinned).length;

  // Each tab's group id in strip order, kept in step with the moves so one query plans them all.
  let strip = [...tabs].sort((a, b) => a.index - b.index).map((t) => t.groupId);
  let moved = 0;
  // Front to back: once a group sits right after the one before it, no later move lands
  // between them, so the unlocked groups never have to move.
  for (let k = 0; k < target.length; k++) {
    const { id, title } = target[k];
    if (!title || !lockedTitles.has(title)) continue;
    const prev = target[k - 1]?.id;
    const order = strip.filter((g, i) => g !== -1 && g !== strip[i - 1]);
    if (order[order.indexOf(id) - 1] === prev) continue;

    const rest = strip.filter((g) => g !== id);
    const index = prev === undefined ? pinnedCount : rest.lastIndexOf(prev) + 1;
    await chrome.tabGroups.move(id, { index });
    rest.splice(index, 0, ...strip.filter((g) => g === id));
    strip = rest;
    moved++;
  }
  return moved;
}
