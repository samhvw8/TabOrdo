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
