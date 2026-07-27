export interface PinnedTabEntry {
  id: string;
  url: string;
  title?: string;
  tabId?: number;
  groupName: string;
  position: number;
}

const STORAGE_KEY = "pinnedTabs";

export async function getPinnedTabs(): Promise<PinnedTabEntry[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

export async function savePinnedTabs(pins: PinnedTabEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: JSON.parse(JSON.stringify(pins)) });
}

export async function pinTab(url: string, groupName: string, position: number, title?: string, tabId?: number): Promise<PinnedTabEntry> {
  const pins = await getPinnedTabs();
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

export async function unpinTab(url: string, groupName: string): Promise<boolean> {
  const pins = await getPinnedTabs();
  const idx = pins.findIndex((p) => p.url === url && p.groupName === groupName);
  if (idx === -1) return false;
  pins.splice(idx, 1);
  await savePinnedTabs(pins);
  return true;
}

export async function reorderPins(groupName: string, orderedUrls: string[]): Promise<void> {
  const pins = await getPinnedTabs();
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

export async function syncPinUrl(tabId: number, newUrl: string, newTitle?: string): Promise<boolean> {
  const pins = await getPinnedTabs();
  const pin = pins.find((p) => p.tabId === tabId);
  if (!pin) return false;
  let changed = false;
  if (newUrl && pin.url !== newUrl) { pin.url = newUrl; changed = true; }
  if (newTitle && pin.title !== newTitle) { pin.title = newTitle; changed = true; }
  if (changed) await savePinnedTabs(pins);
  return changed;
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

export async function applyAllPins(): Promise<number> {
  const pins = await getPinnedTabs();
  if (pins.length === 0) return 0;

  const groupNames = [...new Set(pins.map((p) => p.groupName))];
  const allGroups = await chrome.tabGroups.query({});
  let totalMoved = 0;

  for (const name of groupNames) {
    const group = allGroups.find((g) => g.title === name);
    if (!group) continue;
    totalMoved += await applyPinsToGroup(group.id, name);
  }

  return totalMoved;
}

export interface PinnedGroupEntry {
  id: string;
  groupTitle: string;
  position: number;
}

const GROUP_STORAGE_KEY = "pinnedGroups";

export async function getPinnedGroups(): Promise<PinnedGroupEntry[]> {
  const data = await chrome.storage.local.get(GROUP_STORAGE_KEY);
  return Array.isArray(data[GROUP_STORAGE_KEY]) ? data[GROUP_STORAGE_KEY] : [];
}

export async function savePinnedGroups(pins: PinnedGroupEntry[]): Promise<void> {
  await chrome.storage.local.set({ [GROUP_STORAGE_KEY]: JSON.parse(JSON.stringify(pins)) });
}

export async function pinGroup(groupTitle: string, position: number): Promise<PinnedGroupEntry> {
  const pins = await getPinnedGroups();
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
  const pins = await getPinnedGroups();
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

export async function applyGroupPinsToWindow(windowId: number): Promise<number> {
  const pins = await getPinnedGroups();
  if (pins.length === 0) return 0;

  let tabs = await chrome.tabs.query({ windowId });
  const allGroups = await chrome.tabGroups.query({ windowId });
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  let moved = 0;

  const sortedPins = [...pins].sort((a, b) => a.position - b.position);

  for (const pin of sortedPins) {
    const group = allGroups.find((g) => g.title === pin.groupTitle);
    if (!group) continue;

    const groupTabIds = tabs.filter((t) => t.groupId === group.id).sort((a, b) => a.index - b.index).map((t) => t.id!);
    if (groupTabIds.length === 0) continue;

    const groupOrder = buildGroupOrder(tabs);

    const currentPos = groupOrder.indexOf(group.id);
    const targetPos = Math.min(pin.position, groupOrder.length - 1);
    if (currentPos === targetPos) continue;

    const targetIndex = groupStartIndex(tabs, group.id, targetPos, pinnedCount);

    await chrome.tabs.move(groupTabIds, { index: targetIndex });
    await chrome.tabs.group({ tabIds: groupTabIds, groupId: group.id });
    moved++;

    tabs = await chrome.tabs.query({ windowId });
  }

  return moved;
}

export async function applyAllGroupPins(): Promise<number> {
  const pins = await getPinnedGroups();
  if (pins.length === 0) return 0;

  const windows = await chrome.windows.getAll();
  let total = 0;
  for (const win of windows) {
    if (win.id) total += await applyGroupPinsToWindow(win.id);
  }
  return total;
}
