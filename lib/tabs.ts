import { getDomain as tldtsDomain } from "tldts";
import { getRules, getUseRules, matchDomainToRule } from "./rules.ts";
import { snapshotClosedTabs } from "./undo.ts";

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
  await chrome.windows.update(tab.windowId!, { focused: true });
}

export async function closeTabs(tabIds: number[]): Promise<void> {
  await chrome.tabs.remove(tabIds);
}

export async function sortTabsInWindow(
  windowId: number,
  by: "title" | "url" | "domain" = "domain"
): Promise<void> {
  await organizeWindow(windowId, by);
}

export async function sortTabsInGroup(groupId: number): Promise<void> {
  const tabs = await chrome.tabs.query({ groupId });
  tabs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  for (const tab of tabs) {
    await chrome.tabs.move(tab.id!, { index: -1 });
  }
  await chrome.tabs.group({ tabIds: tabs.map((t) => t.id!), groupId });
}

async function organizeWindow(
  windowId: number,
  by: "title" | "url" | "domain" = "domain"
): Promise<void> {
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
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
    entry.tabs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }
  ungrouped.sort((a, b) => compareTabs(a, b, by));

  let index = pinnedCount;

  for (const entry of sortedGroups) {
    for (const tab of entry.tabs) {
      await chrome.tabs.move(tab.id!, { index: index++ });
    }
    await chrome.tabs.group({ tabIds: entry.tabs.map((t) => t.id!), groupId: entry.group.id });
  }

  for (const tab of ungrouped) {
    await chrome.tabs.move(tab.id!, { index: index++ });
  }
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

  const candidates = freshTabs.filter((t) => !t.pinned);
  for (const tab of candidates) {
    const hostname = getFullHostname(tab.url || "");
    if (!hostname) continue;

    const rule = matchDomainToRule(hostname, rules);
    if (rule) {
      const currentGroupTitle = groupTitleMap.get(tab.groupId) || "";
      if (tab.groupId !== -1 && currentGroupTitle === rule.name) continue;
      if (tab.groupId !== -1) {
        await chrome.tabs.ungroup(tab.id!);
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

  if (mode === "additive") {
    const currentGroups = await chrome.tabGroups.query({});
    for (const group of currentGroups) {
      if (!group.title) continue;

      const ruleEntry = [...ruleGroupMap.entries()].find(([, e]) => e.rule.name === group.title);
      if (ruleEntry) {
        const [ruleId, entry] = ruleEntry;
        for (const tab of entry.tabs) {
          if (tab.windowId !== group.windowId) {
            await chrome.tabs.move(tab.id!, { windowId: group.windowId, index: -1 });
          }
        }
        await chrome.tabs.group({ tabIds: entry.tabs.map((t) => t.id!), groupId: group.id });
        ruleGroupMap.delete(ruleId);
        continue;
      }

      const matching = domainMap.get(group.title);
      if (matching && matching.length > 0) {
        for (const tab of matching) {
          if (tab.windowId !== group.windowId) {
            await chrome.tabs.move(tab.id!, { windowId: group.windowId, index: -1 });
          }
        }
        await chrome.tabs.group({ tabIds: matching.map((t) => t.id!), groupId: group.id });
        domainMap.delete(group.title);
      }
    }
  }

  for (const [, entry] of ruleGroupMap) {
    if (entry.tabs.length < 1) continue;
    const targetWindowId = pickMajorityWindow(entry.tabs);
    for (const tab of entry.tabs.filter((t) => t.windowId !== targetWindowId)) {
      await chrome.tabs.move(tab.id!, { windowId: targetWindowId, index: -1 });
    }
    const groupId = await chrome.tabs.group({
      tabIds: entry.tabs.map((t) => t.id!),
      createProperties: { windowId: targetWindowId },
    });
    await chrome.tabGroups.update(groupId, { title: entry.rule.name, color: entry.rule.color });
  }

  for (const [domain, domainTabs] of domainMap) {
    if (domainTabs.length < 2) continue;
    const targetWindowId = pickMajorityWindow(domainTabs);
    for (const tab of domainTabs.filter((t) => t.windowId !== targetWindowId)) {
      await chrome.tabs.move(tab.id!, { windowId: targetWindowId, index: -1 });
    }
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

  for (const tab of otherTabs) {
    await chrome.tabs.move(tab.id!, {
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
  const [first, ...rest] = tabs;
  const newWindow = await chrome.windows.create({ tabId: first.id! });
  if (rest.length > 0) {
    await chrome.tabs.move(rest.map((t) => t.id!), { windowId: newWindow.id!, index: -1 });
    await chrome.tabs.group({ tabIds: tabs.map((t) => t.id!), groupId });
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

export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
