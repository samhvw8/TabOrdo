import { getDomain as tldtsDomain } from "tldts";
import { getRules, getUseRules, matchDomainToRule } from "./rules.ts";
import { snapshotClosedTabs } from "./undo.ts";
import { pinTab, unpinTab, getPinnedTabs, applyPinsToGroup, applyAllPins, pinGroup, unpinGroup, applyGroupPinsToWindow, applyAllGroupPins, buildGroupOrder } from "./pin.ts";

export interface TabInfo {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  groupId: number;
  groupTitle?: string;
  groupColor?: string;
  audible?: boolean;
  mutedInfo?: chrome.tabs.MutedInfo;
  discarded?: boolean;
  lastAccessed?: number;
}

export const GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
  "blue",
  "cyan",
  "green",
  "yellow",
  "orange",
  "pink",
  "purple",
  "red",
  "grey",
];

export async function getAllTabs(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({});
  const groups = await getAllGroups();
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  return tabs.map((tab) => {
    const group = groupMap.get(tab.groupId);
    return {
      id: tab.id!,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      active: tab.active,
      groupId: tab.groupId,
      groupTitle: group?.title,
      groupColor: group?.color,
      audible: tab.audible,
      mutedInfo: tab.mutedInfo,
      discarded: tab.discarded,
      lastAccessed: tab.lastAccessed,
    };
  });
}

export async function getCurrentWindowTabs(): Promise<TabInfo[]> {
  const all = await getAllTabs();
  const currentWindow = await chrome.windows.getCurrent();
  return all.filter((t) => t.windowId === currentWindow.id);
}

export async function getAllGroups(): Promise<chrome.tabGroups.TabGroup[]> {
  return chrome.tabGroups.query({});
}

export async function switchToTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
}

export async function closeTabs(tabIds: number[]): Promise<void> {
  await chrome.tabs.remove(tabIds);
}

export async function sortTabsInWindow(
  windowId: number,
  by: "title" | "url" | "domain" = "domain"
): Promise<void> {
  await organizeWindow(windowId, by);
  await applyGroupPinsToWindow(windowId);
}

export async function sortTabsInGroup(
  groupId: number,
  by: "title" | "url" | "domain" = "title"
): Promise<void> {
  const tabs = await chrome.tabs.query({ groupId });
  const group = (await chrome.tabGroups.query({})).find((g) => g.id === groupId);
  const ordered = group?.title ? pinAwareSortTabs(tabs, group.title, await getPinnedTabs(), by) : tabs.sort((a, b) => compareTabs(a, b, by));
  const ids = ordered.map((t) => t.id!);
  if (ids.length > 0) {
    await chrome.tabs.move(ids, { index: -1 });
    await chrome.tabs.group({ tabIds: ids, groupId });
  }
}

async function organizeWindow(
  windowId: number,
  by: "title" | "url" | "domain" = "domain"
): Promise<void> {
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  const allPins = await getPinnedTabs();
  const pinnedCount = tabs.filter((t) => t.pinned).length;

  const groupMap = new Map<number, { group: chrome.tabGroups.TabGroup; tabs: chrome.tabs.Tab[] }>();
  const ungrouped: chrome.tabs.Tab[] = [];

  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (tab.groupId !== -1) {
      if (!groupMap.has(tab.groupId)) {
        const g = groups.find((gr) => gr.id === tab.groupId);
        if (g) groupMap.set(tab.groupId, { group: g, tabs: [] });
      }
      groupMap.get(tab.groupId)?.tabs.push(tab);
    } else {
      ungrouped.push(tab);
    }
  }

  const sortedGroups = [...groupMap.values()].sort((a, b) =>
    (a.group.title || "").localeCompare(b.group.title || "")
  );

  for (const entry of sortedGroups) {
    entry.tabs = entry.group.title
      ? pinAwareSortTabs(entry.tabs, entry.group.title, allPins, by)
      : entry.tabs.sort((a, b) => compareTabs(a, b, by));
  }
  ungrouped.sort((a, b) => compareTabs(a, b, by));

  let index = pinnedCount;

  for (const entry of sortedGroups) {
    const ids = entry.tabs.map((t) => t.id!);
    if (ids.length > 0) {
      await chrome.tabs.move(ids, { index });
      index += ids.length;
      await chrome.tabs.group({ tabIds: ids, groupId: entry.group.id });
    }
  }

  const ungroupedIds = ungrouped.map((t) => t.id!);
  if (ungroupedIds.length > 0) {
    await chrome.tabs.move(ungroupedIds, { index });
  }
}

function pinAwareSortTabs(
  tabs: chrome.tabs.Tab[],
  groupTitle: string,
  allPins: import("./pin.ts").PinnedTabEntry[],
  by: "title" | "url" | "domain"
): chrome.tabs.Tab[] {
  const groupPins = allPins.filter((p) => p.groupName === groupTitle);
  if (groupPins.length === 0) return tabs.sort((a, b) => compareTabs(a, b, by));

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

  pinned.sort((a, b) => a.pos - b.pos);
  unpinned.sort((a, b) => compareTabs(a, b, by));

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

function compareTabs(
  a: chrome.tabs.Tab,
  b: chrome.tabs.Tab,
  by: "title" | "url" | "domain"
): number {
  switch (by) {
    case "title":
      return (a.title || "").localeCompare(b.title || "");
    case "url":
      return (a.url || "").localeCompare(b.url || "");
    case "domain": {
      const domA = getDomain(a.url || "");
      const domB = getDomain(b.url || "");
      return domA.localeCompare(domB) || (a.title || "").localeCompare(b.title || "");
    }
  }
}

export async function groupTabsByDomain(
  mode: "additive" | "rebuild" = "additive"
): Promise<void> {
  const useRules = await getUseRules();
  const rules = useRules ? await getRules() : [];
  const allTabs = await chrome.tabs.query({});

  if (mode === "rebuild") {
    const grouped = allTabs.filter((t) => !t.pinned && t.groupId !== -1);
    if (grouped.length > 0) {
      await chrome.tabs.ungroup(grouped.map((t) => t.id!));
    }
  }

  const freshTabs = await chrome.tabs.query({});
  const existingGroups = await chrome.tabGroups.query({});
  const groupTitleMap = new Map(existingGroups.map((g) => [g.id, g.title || ""]));

  const ruleGroupMap = new Map<string, { rule: typeof rules[0]; tabs: chrome.tabs.Tab[] }>();
  const domainMap = new Map<string, chrome.tabs.Tab[]>();
  const toUngroup: number[] = [];

  const candidates = freshTabs.filter((t) => !t.pinned);
  for (const tab of candidates) {
    const hostname = getFullHostname(tab.url || "");
    if (!hostname) continue;

    const rule = matchDomainToRule(hostname, rules);
    if (rule) {
      const currentGroupTitle = groupTitleMap.get(tab.groupId) || "";
      if (tab.groupId !== -1 && currentGroupTitle === rule.name) continue;
      if (tab.groupId !== -1) {
        toUngroup.push(tab.id!);
      }
      if (!ruleGroupMap.has(rule.id)) ruleGroupMap.set(rule.id, { rule, tabs: [] });
      ruleGroupMap.get(rule.id)!.tabs.push(tab);
    } else if (tab.groupId === -1) {
      const domain = getDomain(tab.url || "");
      if (!domain) continue;
      if (!domainMap.has(domain)) domainMap.set(domain, []);
      domainMap.get(domain)!.push(tab);
    }
  }

  if (toUngroup.length > 0) {
    await chrome.tabs.ungroup(toUngroup);
  }

  if (mode === "additive") {
    const currentGroups = await chrome.tabGroups.query({});
    for (const group of currentGroups) {
      if (!group.title) continue;

      const ruleEntry = [...ruleGroupMap.entries()].find(([, e]) => e.rule.name === group.title);
      if (ruleEntry) {
        const [ruleId, entry] = ruleEntry;
        const moveIds = entry.tabs.filter((t) => t.windowId !== group.windowId).map((t) => t.id!);
        if (moveIds.length > 0) await chrome.tabs.move(moveIds, { windowId: group.windowId, index: -1 });
        await chrome.tabs.group({ tabIds: entry.tabs.map((t) => t.id!), groupId: group.id });
        ruleGroupMap.delete(ruleId);
        continue;
      }

      const matching = domainMap.get(group.title);
      if (matching && matching.length > 0) {
        const moveIds = matching.filter((t) => t.windowId !== group.windowId).map((t) => t.id!);
        if (moveIds.length > 0) await chrome.tabs.move(moveIds, { windowId: group.windowId, index: -1 });
        await chrome.tabs.group({ tabIds: matching.map((t) => t.id!), groupId: group.id });
        domainMap.delete(group.title);
      }
    }
  }

  for (const [, entry] of ruleGroupMap) {
    if (entry.tabs.length < 1) continue;
    const targetWindowId = pickMajorityWindow(entry.tabs);
    const moveIds = entry.tabs.filter((t) => t.windowId !== targetWindowId).map((t) => t.id!);
    if (moveIds.length > 0) await chrome.tabs.move(moveIds, { windowId: targetWindowId, index: -1 });
    const groupId = await chrome.tabs.group({
      tabIds: entry.tabs.map((t) => t.id!),
      createProperties: { windowId: targetWindowId },
    });
    await chrome.tabGroups.update(groupId, { title: entry.rule.name, color: entry.rule.color });
  }

  for (const [domain, domainTabs] of domainMap) {
    if (domainTabs.length < 2) continue;
    const targetWindowId = pickMajorityWindow(domainTabs);
    const moveIds = domainTabs.filter((t) => t.windowId !== targetWindowId).map((t) => t.id!);
    if (moveIds.length > 0) await chrome.tabs.move(moveIds, { windowId: targetWindowId, index: -1 });
    const groupId = await chrome.tabs.group({
      tabIds: domainTabs.map((t) => t.id!),
      createProperties: { windowId: targetWindowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: domain,
      color: GROUP_COLORS[Math.abs(hashCode(domain)) % GROUP_COLORS.length],
    });
  }

  const windows = await chrome.windows.getAll();
  for (const win of windows) {
    await organizeWindow(win.id!);
  }
  await collapseAllExceptActive();
  await applyAllGroupPins();
}

function pickMajorityWindow(tabs: chrome.tabs.Tab[]): number {
  const counts = new Map<number, number>();
  for (const tab of tabs) {
    counts.set(tab.windowId, (counts.get(tab.windowId) || 0) + 1);
  }
  let best = tabs[0].windowId;
  let max = 0;
  for (const [wid, count] of counts) {
    if (count > max) { max = count; best = wid; }
  }
  return best;
}

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

export async function ungroupAll(): Promise<void> {
  const allTabs = await chrome.tabs.query({});
  const grouped = allTabs.filter((t) => !t.pinned && t.groupId !== -1);
  if (grouped.length > 0) {
    await chrome.tabs.ungroup(grouped.map((t) => t.id!));
  }
}

async function collapseAllExceptActive(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const allGroups = await chrome.tabGroups.query({});

  await Promise.all(allGroups.map((group) => {
    const shouldExpand = activeTab && activeTab.groupId === group.id;
    return chrome.tabGroups.update(group.id, { collapsed: !shouldExpand });
  }));
}

export async function removeDuplicates(): Promise<number> {
  const duplicates = await findDuplicates();
  const toClose: number[] = [];

  for (const [, tabs] of duplicates) {
    const sorted = tabs.sort(
      (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
    );
    for (let i = 1; i < sorted.length; i++) {
      toClose.push(sorted[i].id);
    }
  }

  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose);
  }
  return toClose.length;
}

export async function mergeAllWindows(): Promise<void> {
  const currentWindow = await chrome.windows.getCurrent();
  const allTabs = await chrome.tabs.query({});
  const otherTabs = allTabs.filter(
    (t) => t.windowId !== currentWindow.id && !t.pinned
  );

  if (otherTabs.length > 0) {
    await chrome.tabs.move(otherTabs.map((t) => t.id!), {
      windowId: currentWindow.id!,
      index: -1,
    });
  }
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

export async function discardTabs(tabIds: number[]): Promise<void> {
  for (const id of tabIds) {
    await chrome.tabs.discard(id).catch(() => {});
  }
}

async function closeTabsRelativeTo(direction: "left" | "right"): Promise<number> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find((t) => t.active);
  if (!active) return 0;
  const toClose = tabs.filter((t) =>
    !t.pinned && (direction === "left" ? t.index < active.index : t.index > active.index)
  );
  if (toClose.length > 0) {
    snapshotClosedTabs(toClose);
    await chrome.tabs.remove(toClose.map((t) => t.id!));
  }
  return toClose.length;
}

export async function closeTabsToLeft(): Promise<number> {
  return closeTabsRelativeTo("left");
}

export async function closeTabsToRight(): Promise<number> {
  return closeTabsRelativeTo("right");
}

export async function closeTabsSameSite(): Promise<number> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.url) return 0;
  const activeDomain = getDomain(active.url);
  if (!activeDomain) return 0;
  const tabs = await chrome.tabs.query({});
  const toClose = tabs.filter(
    (t) => !t.pinned && t.id !== active.id && getDomain(t.url || "") === activeDomain
  );
  if (toClose.length > 0) {
    snapshotClosedTabs(toClose);
    await chrome.tabs.remove(toClose.map((t) => t.id!));
  }
  return toClose.length;
}

export async function closeOldTabs(maxAgeDays: number = 7): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const tabs = await chrome.tabs.query({});
  const toClose = tabs.filter(
    (t) => !t.pinned && !t.active && (t.lastAccessed || 0) < cutoff
  );
  if (toClose.length > 0) {
    snapshotClosedTabs(toClose);
    await chrome.tabs.remove(toClose.map((t) => t.id!));
  }
  return toClose.length;
}

export async function muteTab(tabId: number, muted: boolean): Promise<void> {
  await chrome.tabs.update(tabId, { muted });
}

export async function setTabVolume(tabId: number, volume: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (vol: number) => {
        const elements = document.querySelectorAll("audio, video");
        if (elements.length === 0) {
          console.warn("[TabOrdo] No audio/video elements found on this page");
          return;
        }
        elements.forEach((el) => {
          (el as HTMLMediaElement).volume = vol;
        });
        console.log(`[TabOrdo] Set volume to ${Math.round(vol * 100)}% on ${elements.length} element(s)`);
      },
      args: [Math.max(0, Math.min(1, volume))],
    });
  } catch (e) {
    console.error("[TabOrdo] Failed to set volume for tab", tabId, e);
  }
}

export function getDomain(url: string): string {
  try {
    return tldtsDomain(url, { allowPrivateDomains: false }) || new URL(url).hostname;
  } catch {
    return url;
  }
}

export function getFullHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:") return null;
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

export async function shuffleTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const unpinned = tabs.filter((t) => !t.pinned);
  for (let i = unpinned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unpinned[i], unpinned[j]] = [unpinned[j], unpinned[i]];
  }
  for (const tab of unpinned) {
    await chrome.tabs.move(tab.id!, { index: -1 });
  }
}

export async function uniteDomain(): Promise<number> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.url) return 0;
  const domain = getDomain(active.url);
  if (!domain) return 0;
  const currentWin = await chrome.windows.getCurrent();
  const allTabs = await chrome.tabs.query({});
  const toMove = allTabs.filter(
    (t) => !t.pinned && t.windowId !== currentWin.id && getDomain(t.url || "") === domain
  );
  for (const tab of toMove) {
    await chrome.tabs.move(tab.id!, { windowId: currentWin.id!, index: -1 });
  }
  return toMove.length;
}

export async function isolateDomain(): Promise<number> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.url) return 0;
  const domain = getDomain(active.url);
  if (!domain) return 0;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const sameDomain = tabs.filter((t) => !t.pinned && getDomain(t.url || "") === domain);
  if (sameDomain.length < 1) return 0;
  const [first, ...rest] = sameDomain;
  const win = await chrome.windows.create({ tabId: first.id! });
  if (rest.length > 0) {
    await chrome.tabs.move(rest.map((t) => t.id!), { windowId: win.id!, index: -1 });
  }
  return sameDomain.length;
}

export async function splitWindow(direction: "vertical" | "horizontal"): Promise<void> {
  const win = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const unpinned = tabs.filter((t) => !t.pinned);
  const mid = Math.ceil(unpinned.length / 2);
  const rightHalf = unpinned.slice(mid);
  if (rightHalf.length === 0) return;

  const [first, ...rest] = rightHalf;
  const newWin = await chrome.windows.create({ tabId: first.id! });
  if (rest.length > 0) {
    await chrome.tabs.move(rest.map((t) => t.id!), { windowId: newWin.id!, index: -1 });
  }

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
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const domainMap = new Map<string, chrome.tabs.Tab[]>();
  for (const tab of tabs.filter((t) => !t.pinned)) {
    const domain = getDomain(tab.url || "") || "__other__";
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
    const [first, ...rest] = groups[i];
    const win = await chrome.windows.create({ tabId: first.id! });
    if (rest.length > 0) {
      await chrome.tabs.move(rest.map((t) => t.id!), { windowId: win.id!, index: -1 });
    }
    created++;
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

export async function collapseAllGroups(): Promise<number> {
  const allGroups = await chrome.tabGroups.query({});
  await Promise.all(allGroups.map((g) => chrome.tabGroups.update(g.id, { collapsed: true })));
  return allGroups.length;
}

function parsePosition(pos: string): "first" | "last" | number | null {
  const trimmed = pos.trim();
  if (trimmed === "^") return "first";
  if (trimmed === "$") return "last";
  const n = parseInt(trimmed, 10);
  if (!isNaN(n) && n >= 1) return n;
  return null;
}

export async function moveCurrentTab(posStr: string): Promise<string> {
  const position = parsePosition(posStr);
  if (position === null) return "Usage: /move ^|$|<number>";

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id) return "No active tab";

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const pinnedCount = tabs.filter((t) => t.pinned).length;

  if (active.groupId !== -1) {
    const groupTabs = tabs.filter((t) => t.groupId === active.groupId).sort((a, b) => a.index - b.index);
    if (groupTabs.length === 0) return "No group tabs found";
    const minIdx = groupTabs[0].index;
    const maxIdx = groupTabs[groupTabs.length - 1].index;
    let targetIndex: number;
    if (position === "first") targetIndex = minIdx;
    else if (position === "last") targetIndex = maxIdx;
    else targetIndex = Math.min(minIdx + position - 1, maxIdx);
    await chrome.tabs.move(active.id, { index: targetIndex });
    return `Moved to position ${position === "first" ? "first" : position === "last" ? "last" : position} in group`;
  } else {
    const ungrouped = tabs.filter((t) => !t.pinned && t.groupId === -1).sort((a, b) => a.index - b.index);
    if (ungrouped.length === 0) return "No ungrouped tabs";
    let targetIndex: number;
    if (position === "first") targetIndex = pinnedCount;
    else if (position === "last") targetIndex = -1;
    else targetIndex = Math.min(pinnedCount + position - 1, tabs.length - 1);
    await chrome.tabs.move(active.id, { index: targetIndex });
    return `Moved tab to position ${position === "first" ? "first" : position === "last" ? "last" : position}`;
  }
}

export async function moveGroup(posStr: string): Promise<string> {
  const position = parsePosition(posStr);
  if (position === null) return "Usage: /movegroup ^|$|<number>";

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || active.groupId === -1) return "Active tab is not in a group";

  const groupId = active.groupId;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  const groupTabs = tabs.filter((t) => t.groupId === groupId).sort((a, b) => a.index - b.index);
  const groupTabIds = groupTabs.map((t) => t.id!);

  let targetIndex: number;
  if (position === "first") targetIndex = pinnedCount;
  else if (position === "last") targetIndex = -1;
  else {
    const groups = await chrome.tabGroups.query({ windowId: active.windowId });
    const nonPinnedStart = pinnedCount;
    const maxGroups = groups.length;
    const groupPos = Math.min(position, maxGroups);
    const sortedTabs = tabs.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
    let currentGroupIdx = 0;
    targetIndex = nonPinnedStart;
    let lastGroupId = -1;
    for (const t of sortedTabs) {
      if (t.groupId !== -1 && t.groupId !== lastGroupId && t.groupId !== groupId) {
        currentGroupIdx++;
        if (currentGroupIdx >= groupPos) break;
        lastGroupId = t.groupId;
      } else if (t.groupId === -1 && lastGroupId !== -1) {
        lastGroupId = -1;
      }
      if (t.groupId !== groupId) targetIndex = t.index + 1;
    }
  }

  await chrome.tabs.move(groupTabIds, { index: targetIndex });
  await chrome.tabs.group({ tabIds: groupTabIds, groupId });
  return `Moved group to position ${position === "first" ? "first" : position === "last" ? "last" : position}`;
}

export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

const PIN_BADGE = "📌 ";

// Injected into the page. Prepends a pin badge to document.title and keeps it
// applied across SPA title changes via a MutationObserver stored on window.
function applyTitleBadgeInPage(badge: string): void {
  const w = window as unknown as { __tabordoPinObserver?: MutationObserver };
  if (!document.title.startsWith(badge)) document.title = badge + document.title;
  if (w.__tabordoPinObserver) return;
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  const obs = new MutationObserver(() => {
    if (!document.title.startsWith(badge)) document.title = badge + document.title;
  });
  obs.observe(titleEl, { childList: true });
  w.__tabordoPinObserver = obs;
}

// Injected into the page. Removes the badge and disconnects the observer.
function removeTitleBadgeInPage(badge: string): void {
  const w = window as unknown as { __tabordoPinObserver?: MutationObserver };
  if (w.__tabordoPinObserver) {
    w.__tabordoPinObserver.disconnect();
    delete w.__tabordoPinObserver;
  }
  if (document.title.startsWith(badge)) document.title = document.title.slice(badge.length);
}

async function setTitleBadge(tabId: number, on: boolean): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: on ? applyTitleBadgeInPage : removeTitleBadgeInPage,
      args: [PIN_BADGE],
    });
  } catch (e) {
    console.warn("[TabOrdo] title badge inject failed:", e);
  }
}

export async function pinCurrentTab(posStr: string): Promise<string> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id || !active.url) return "No active tab";
  if (active.groupId === -1) return "Tab is not in a group";

  const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
  if (!group?.title) return "Group has no title";

  const groupTabs = (await chrome.tabs.query({ groupId: active.groupId })).sort((a, b) => a.index - b.index);
  const baseIndex = groupTabs[0]?.index ?? 0;

  const existingPins = (await getPinnedTabs()).filter((p) => p.groupName === group.title);

  let position: number;
  const trimmed = posStr.trim();
  if (!trimmed) {
    position = existingPins.length;
  } else if (trimmed === "^") {
    position = 0;
  } else if (trimmed === "$") {
    position = groupTabs.length - 1;
  } else {
    const n = parseInt(trimmed, 10);
    if (isNaN(n) || n < 1) return "Usage: /pin [^|$|number]";
    position = Math.min(n - 1, groupTabs.length - 1);
  }

  await pinTab(active.url, group.title, position, active.title, active.id);
  await applyPinsToGroup(active.groupId, group.title);
  await setTitleBadge(active.id, true);
  return `Pinned at position ${position + 1} in "${group.title}"`;
}

export async function unpinCurrentTab(): Promise<string> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id || !active.url) return "No active tab";
  if (active.groupId === -1) return "Tab is not in a group";

  const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
  if (!group?.title) return "Group has no title";

  const removed = await unpinTab(active.url, group.title);
  if (removed) await setTitleBadge(active.id, false);
  return removed ? `Unpinned from "${group.title}"` : "Tab was not pinned";
}

export async function pinCurrentGroup(posStr: string): Promise<string> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || active.groupId === -1) return "Active tab is not in a group";

  const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
  if (!group?.title) return "Group has no title";

  const tabs = await chrome.tabs.query({ windowId: active.windowId });
  const groupOrder = buildGroupOrder(tabs);

  let position: number;
  const trimmed = posStr.trim();
  if (!trimmed) {
    const idx = groupOrder.indexOf(active.groupId);
    position = idx === -1 ? 0 : idx;
  } else if (trimmed === "^") {
    position = 0;
  } else if (trimmed === "$") {
    position = Math.max(0, groupOrder.length - 1);
  } else {
    const n = parseInt(trimmed, 10);
    if (isNaN(n) || n < 1) return "Usage: /pingroup [^|$|number]";
    position = Math.min(n - 1, groupOrder.length - 1);
  }

  await pinGroup(group.title, position);
  await applyGroupPinsToWindow(active.windowId);
  return `Pinned group "${group.title}" at position ${position + 1}`;
}

export async function unpinCurrentGroup(): Promise<string> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || active.groupId === -1) return "Active tab is not in a group";

  const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
  if (!group?.title) return "Group has no title";

  const removed = await unpinGroup(group.title);
  return removed ? `Unpinned group "${group.title}"` : "Group was not pinned";
}
