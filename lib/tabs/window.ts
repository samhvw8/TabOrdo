// Moving tabs between windows without losing their groups, and arranging windows.

import { getDomainMapper } from "../url.ts";
import type { MoveGroupsResult } from "./types.ts";
import { getAllGroups } from "./query.ts";

interface CarriedGroup {
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
  collapsed?: boolean;
  tabIds: number[];
}

// Chrome ungroups a tab the moment it crosses into another window, so a plain move loses
// every group from the windows being merged. Record what each tab belonged to first, then
// rebuild those groups on the far side.
function carryGroups(tabs: chrome.tabs.Tab[], groups: chrome.tabGroups.TabGroup[]): CarriedGroup[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const carried = new Map<string, CarriedGroup>();

  // Sort by (windowId, index), not index alone: tab.index restarts at 0 in every window, so
  // a flat numeric sort round-robins across windows and interleaves the tabs of two
  // same-titled groups that are about to fold into one.
  const ordered = [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  for (const tab of ordered) {
    if (tab.groupId === -1 || tab.id === undefined) continue;
    const group = groupById.get(tab.groupId);
    if (!group) continue;
    // Same-titled groups from different windows fold into one; untitled groups can't be
    // matched by name, so they stay distinct.
    const key = group.title ? `title:${group.title}\u0000${group.color}` : `id:${group.id}`;
    let entry = carried.get(key);
    if (!entry) {
      entry = { title: group.title, color: group.color, collapsed: group.collapsed, tabIds: [] };
      carried.set(key, entry);
    }
    entry.tabIds.push(tab.id);
  }
  return [...carried.values()];
}

async function restoreGroup(
  entry: CarriedGroup,
  windowId: number,
  existing: chrome.tabGroups.TabGroup[],
  mergeByTitle: boolean
): Promise<boolean> {
  if (entry.tabIds.length === 0) return true;
  // Re-join a matching group already in the target window, so merging twice doesn't leave
  // two "Work" groups sitting next to each other.
  const match = mergeByTitle && entry.title
    ? existing.find((g) => g.title === entry.title && g.color === entry.color)
    : undefined;
  try {
    if (match) {
      await chrome.tabs.group({ tabIds: entry.tabIds, groupId: match.id });
      return true;
    }
    const groupId = await chrome.tabs.group({ tabIds: entry.tabIds, createProperties: { windowId } });
    const props: chrome.tabGroups.UpdateProperties = { collapsed: entry.collapsed };
    if (entry.title !== undefined) props.title = entry.title;
    if (entry.color !== undefined) props.color = entry.color;
    await chrome.tabGroups.update(groupId, props);
    return true;
  } catch (e) {
    console.warn("[TabOrdo] could not restore group", entry.title, e);
    return false;
  }
}

async function restoreCarried(
  carried: CarriedGroup[],
  windowId: number,
  mergeByTitle: boolean
): Promise<number> {
  const existing = mergeByTitle ? await chrome.tabGroups.query({ windowId }) : [];
  let failed = 0;
  for (const entry of carried) {
    if (!(await restoreGroup(entry, windowId, existing, mergeByTitle))) failed++;
  }
  return failed;
}

/**
 * Move tabs into an existing window without losing their groups. Chrome silently ungroups
 * a tab the moment it crosses a window boundary, so every caller that moves tabs between
 * windows has to capture group membership first and rebuild it afterwards.
 */
export async function moveTabsPreservingGroups(
  tabs: chrome.tabs.Tab[],
  targetWindowId: number,
  opts: { index?: number; mergeByTitle?: boolean } = {}
): Promise<MoveGroupsResult> {
  const { index = -1, mergeByTitle = true } = opts;
  const ids = tabs.map((t) => t.id).filter((id): id is number => id !== undefined);
  if (ids.length === 0) return { moved: 0, groupsFailed: 0 };

  const carried = carryGroups(tabs, await getAllGroups());
  await chrome.tabs.move(ids, { windowId: targetWindowId, index });
  const groupsFailed = await restoreCarried(carried, targetWindowId, mergeByTitle);
  return { moved: ids.length, groupsFailed };
}

/**
 * Move tabs into a brand-new window without losing their groups. Split out from
 * moveTabsPreservingGroups because windows.create({tabId}) detaches that first tab too —
 * a move-only primitive would leave the first tab ungrouped.
 */
export async function moveTabsToNewWindow(
  tabs: chrome.tabs.Tab[],
  opts: { mergeByTitle?: boolean } = {}
): Promise<{ windowId: number; result: MoveGroupsResult } | null> {
  const { mergeByTitle = false } = opts;
  const withIds = tabs.filter((t) => t.id !== undefined);
  if (withIds.length === 0) return null;

  // Capture before creating the window — the first tab loses its group on create().
  const carried = carryGroups(withIds, await getAllGroups());

  const [first, ...rest] = withIds;
  const win = await chrome.windows.create({ tabId: first.id! });
  const windowId = win.id!;
  if (rest.length > 0) {
    await chrome.tabs.move(rest.map((t) => t.id!), { windowId, index: -1 });
  }
  const groupsFailed = await restoreCarried(carried, windowId, mergeByTitle);
  return { windowId, result: { moved: withIds.length, groupsFailed } };
}

export async function mergeAllWindows(): Promise<MoveGroupsResult> {
  const currentWindow = await chrome.windows.getCurrent();
  const targetWindowId = currentWindow.id!;
  const allTabs = await chrome.tabs.query({});
  const otherTabs = allTabs.filter(
    (t) => t.windowId !== targetWindowId && !t.pinned
  );
  if (otherTabs.length === 0) return { moved: 0, groupsFailed: 0 };

  return moveTabsPreservingGroups(otherTabs, targetWindowId);
}

export async function splitTabToWindow(tabId: number): Promise<void> {
  await chrome.windows.create({ tabId });
}

export async function extractGroupToWindow(groupId: number): Promise<number> {
  const tabs = await chrome.tabs.query({ groupId });
  if (tabs.length === 0) return 0;
  const groupInfo = (await chrome.tabGroups.query({})).find((g) => g.id === groupId);
  const [first, ...rest] = tabs;
  const newWindow = await chrome.windows.create({ tabId: first.id! });
  if (rest.length > 0) {
    await chrome.tabs.move(rest.map((t) => t.id!), { windowId: newWindow.id!, index: -1 });
  }
  const newGroupId = await chrome.tabs.group({
    tabIds: tabs.map((t) => t.id!),
    createProperties: { windowId: newWindow.id! },
  });
  if (groupInfo) {
    await chrome.tabGroups.update(newGroupId, { title: groupInfo.title, color: groupInfo.color });
  }
  return tabs.length;
}

export async function uniteDomain(): Promise<number> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.url) return 0;
  const domainOf = await getDomainMapper();
  const domain = domainOf(active.url);
  if (!domain) return 0;
  const currentWin = await chrome.windows.getCurrent();
  const allTabs = await chrome.tabs.query({});
  const toMove = allTabs.filter(
    (t) => !t.pinned && t.windowId !== currentWin.id && domainOf(t.url || "") === domain
  );
  const { moved } = await moveTabsPreservingGroups(toMove, currentWin.id!);
  return moved;
}

export async function isolateDomain(): Promise<number> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.url) return 0;
  const domainOf = await getDomainMapper();
  const domain = domainOf(active.url);
  if (!domain) return 0;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const sameDomain = tabs.filter((t) => !t.pinned && domainOf(t.url || "") === domain);
  if (sameDomain.length < 1) return 0;
  const outcome = await moveTabsToNewWindow(sameDomain);
  return outcome?.result.moved ?? 0;
}

export async function splitWindow(direction: "vertical" | "horizontal"): Promise<void> {
  const win = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const unpinned = tabs.filter((t) => !t.pinned);
  const mid = Math.ceil(unpinned.length / 2);
  const rightHalf = unpinned.slice(mid);
  if (rightHalf.length === 0) return;

  const outcome = await moveTabsToNewWindow(rightHalf);
  if (!outcome) return;
  const newWin = { id: outcome.windowId };

  const w = win.width || 1280;
  const h = win.height || 800;
  const l = win.left || 0;
  const t = win.top || 0;

  if (direction === "vertical") {
    await chrome.windows.update(win.id!, { left: l, top: t, width: Math.floor(w / 2), height: h, state: "normal" });
    await chrome.windows.update(newWin.id!, { left: l + Math.floor(w / 2), top: t, width: Math.floor(w / 2), height: h, state: "normal" });
  } else {
    await chrome.windows.update(win.id!, { left: l, top: t, width: w, height: Math.floor(h / 2), state: "normal" });
    await chrome.windows.update(newWin.id!, { left: l, top: t + Math.floor(h / 2), width: w, height: Math.floor(h / 2), state: "normal" });
  }
}

export async function splitByDomain(): Promise<number> {
  const domainOf = await getDomainMapper();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const domainMap = new Map<string, chrome.tabs.Tab[]>();
  for (const tab of tabs.filter((t) => !t.pinned)) {
    const domain = domainOf(tab.url || "") || "__other__";
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain)!.push(tab);
  }

  const singles: chrome.tabs.Tab[] = [];
  const groups: chrome.tabs.Tab[][] = [];
  for (const [, domTabs] of domainMap) {
    if (domTabs.length === 1) singles.push(domTabs[0]);
    else groups.push(domTabs);
  }
  if (singles.length > 0) groups.push(singles);

  let created = 0;
  for (let i = 1; i < groups.length; i++) {
    if (await moveTabsToNewWindow(groups[i])) created++;
  }
  return created;
}

export async function stackWindows(): Promise<void> {
  const current = await chrome.windows.getCurrent();
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const screenW = (current.left || 0) + (current.width || 1280);
  const screenH = current.height || 800;
  const halfW = Math.floor(screenW / 2);
  const perH = Math.floor(screenH / Math.max(wins.length, 1));

  for (let i = 0; i < wins.length; i++) {
    await chrome.windows.update(wins[i].id!, {
      left: 0, top: i * perH, width: halfW, height: perH, state: "normal",
    });
  }
}
