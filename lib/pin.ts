export interface PinnedTabEntry {
  id: string;
  url: string;
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

export async function pinTab(url: string, groupName: string, position: number): Promise<PinnedTabEntry> {
  const pins = await getPinnedTabs();
  const existing = pins.find((p) => p.url === url && p.groupName === groupName);
  if (existing) {
    existing.position = position;
    await savePinnedTabs(pins);
    return existing;
  }
  const entry: PinnedTabEntry = { id: crypto.randomUUID(), url, groupName, position };
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

export function getPinForTab(url: string, groupName: string, pins: PinnedTabEntry[]): PinnedTabEntry | undefined {
  return pins.find((p) => p.url === url && p.groupName === groupName);
}

export async function applyPinsToGroup(
  groupId: number,
  groupTitle: string
): Promise<number> {
  const pins = await getPinnedTabs();
  const groupPins = pins.filter((p) => p.groupName === groupTitle);
  if (groupPins.length === 0) return 0;

  const tabs = await chrome.tabs.query({ groupId });
  if (tabs.length === 0) return 0;
  tabs.sort((a, b) => a.index - b.index);

  const baseIndex = tabs[0].index;
  let moved = 0;

  const sorted = [...groupPins].sort((a, b) => a.position - b.position);
  for (const pin of sorted) {
    const tab = tabs.find((t) => t.url === pin.url);
    if (!tab) continue;
    const targetIndex = Math.min(baseIndex + pin.position, baseIndex + tabs.length - 1);
    if (tab.index !== targetIndex) {
      await chrome.tabs.move(tab.id!, { index: targetIndex });
      moved++;
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

export async function applyGroupPinsToWindow(windowId: number): Promise<number> {
  const pins = await getPinnedGroups();
  if (pins.length === 0) return 0;

  let tabs = await chrome.tabs.query({ windowId });
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  let moved = 0;

  const sortedPins = [...pins].sort((a, b) => a.position - b.position);

  for (const pin of sortedPins) {
    const allGroups = await chrome.tabGroups.query({ windowId });
    const group = allGroups.find((g) => g.title === pin.groupTitle);
    if (!group) continue;

    const groupTabIds = tabs.filter((t) => t.groupId === group.id).sort((a, b) => a.index - b.index).map((t) => t.id!);
    if (groupTabIds.length === 0) continue;

    const nonPinnedTabs = tabs.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
    const seenGroupIds = new Set<number>();
    const groupOrder: number[] = [];
    for (const t of nonPinnedTabs) {
      if (t.groupId !== -1 && !seenGroupIds.has(t.groupId)) {
        seenGroupIds.add(t.groupId);
        groupOrder.push(t.groupId);
      }
    }

    const currentPos = groupOrder.indexOf(group.id);
    const targetPos = Math.min(pin.position, groupOrder.length - 1);
    if (currentPos === targetPos) continue;

    let targetIndex: number;
    if (targetPos === 0) {
      targetIndex = pinnedCount;
    } else {
      let gIdx = 0;
      let lastSeenGroupId = -1;
      targetIndex = pinnedCount;
      for (const t of nonPinnedTabs) {
        if (t.groupId !== -1 && t.groupId !== lastSeenGroupId && t.groupId !== group.id) {
          gIdx++;
          if (gIdx > targetPos) break;
          lastSeenGroupId = t.groupId;
        } else if (t.groupId === -1) {
          lastSeenGroupId = -1;
        }
        if (t.groupId !== group.id) targetIndex = t.index + 1;
      }
    }

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
