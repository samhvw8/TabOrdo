// Ordering tabs inside a window or a group, honouring position locks.

import { getDomainMapper, type DomainMapper } from "../url.ts";
import { getPinnedTabs, getPinnedGroups, lockedGroupOrder, type PinnedTabEntry } from "../pin.ts";
import { getSortRules, buildSortRanker, noSortRanking, type SortRanker } from "../rules.ts";

/**
 * Sort rules only reorder *within* a domain block and *between* domains, so they mean nothing
 * to a flat title or url sort. Skipping the build there also skips a storage read on the
 * auto-sort path, which fires on every tab that finishes loading.
 */
async function rankerFor(by: "title" | "url" | "domain"): Promise<SortRanker> {
  if (by !== "domain") return noSortRanking;
  return buildSortRanker(await getSortRules());
}

export async function sortTabsInWindow(
  windowId: number,
  by: "title" | "url" | "domain" = "domain"
): Promise<void> {
  await organizeWindow(windowId, by);
}

export async function sortTabsInGroup(
  groupId: number,
  by: "title" | "url" | "domain" = "title"
): Promise<void> {
  const tabs = await chrome.tabs.query({ groupId });
  const group = (await chrome.tabGroups.query({})).find((g) => g.id === groupId);
  const domainOf = await getDomainMapper();
  const rank = await rankerFor(by);
  const ordered = group?.title
    ? pinAwareSortTabs(tabs, group.title, await getPinnedTabs(), by, domainOf, rank)
    : tabs.sort((a, b) => compareTabs(a, b, by, domainOf, rank));
  const ids = ordered.map((t) => t.id!);
  if (ids.length > 0) {
    // Back into the group's own slot, not index -1: every id sits at or right of the group's
    // first index, so moving them there in order sorts the group in place.
    await chrome.tabs.move(ids, { index: Math.min(...tabs.map((t) => t.index)) });
    await chrome.tabs.group({ tabIds: ids, groupId });
  }
}

export async function organizeWindow(
  windowId: number,
  by: "title" | "url" | "domain" = "domain"
): Promise<void> {
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  const allPins = await getPinnedTabs();
  const groupPins = await getPinnedGroups();
  const domainOf = await getDomainMapper();
  const rank = await rankerFor(by);
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

  const byTitle = [...groupMap.values()].sort((a, b) =>
    (a.group.title || "").localeCompare(b.group.title || "")
  );
  // Group locks take their slots out of title order. Laid down directly, so a locked group
  // already in its slot costs nothing, like any other block planLayout finds in place.
  const sortedGroups = lockedGroupOrder(byTitle.map((e) => e.group), groupPins).map((g) => groupMap.get(g.id)!);

  for (const entry of sortedGroups) {
    entry.tabs = entry.group.title
      ? pinAwareSortTabs(entry.tabs, entry.group.title, allPins, by, domainOf, rank)
      : entry.tabs.sort((a, b) => compareTabs(a, b, by, domainOf, rank));
  }
  ungrouped.sort((a, b) => compareTabs(a, b, by, domainOf, rank));

  const blocks: Block[] = sortedGroups.map((entry) => ({ ids: entry.tabs.map((t) => t.id!), groupId: entry.group.id }));
  if (ungrouped.length > 0) blocks.push({ ids: ungrouped.map((t) => t.id!), groupId: -1 });

  for (const step of planLayout(tabs, blocks, pinnedCount)) {
    await chrome.tabs.move(step.ids, { index: step.index });
    if (step.groupId !== -1) await chrome.tabs.group({ tabIds: step.ids, groupId: step.groupId });
  }
}

/** One run of the target strip: a whole group, or (groupId -1) every loose tab. */
interface Block {
  ids: number[];
  groupId: number;
}

interface LayoutStep {
  ids: number[];
  /** As passed to tabs.move; -1 is the end of the window. */
  index: number;
  /** Re-assert this group once the tabs land, or -1 for loose tabs. */
  groupId: number;
}

/**
 * The moves that turn the window into `blocks` laid end to end after the Chrome-pinned tabs.
 *
 * This runs on every tab that finishes loading, and it used to move and regroup every block
 * whether or not anything was out of place: 2 calls per group plus one for the loose tabs, 121
 * of them on a 1000-tab window that was already sorted. Each block is now checked against a
 * local copy of the strip and skipped when its tabs already sit at its index in order; the copy
 * is updated for every move that is kept, so the blocks after it are checked against the strip
 * as it will really be.
 *
 * Skipping cannot change where anything ends up. Blocks go down front to back, so when block k
 * is reached everything before its index is already final, every tab it moves travels leftward,
 * and a block found in place is exactly one whose move would have been a no-op. Leftward is
 * also the only direction a multi-tab tabs.move is safe in: Chrome moves the ids one at a time
 * to index, index+1, …, so a rightward batch lands scattered. The regroup is kept on every
 * block that does move, because Chrome drops a tab from its group when it lands away from the
 * rest of that group.
 *
 * One case still re-laid everything: a loose tab sitting ahead of the groups — a link opened
 * from a Chrome-pinned tab lands right after the pins — puts every block after it one slot off.
 * So a second plan first sends such strays to the end of the window (appended one at a time,
 * which is safe in either direction, and a loose tab appended there joins no group) and then
 * does the same pass; whichever plan makes fewer calls is used.
 */
function planLayout(tabs: chrome.tabs.Tab[], blocks: Block[], pinnedCount: number): LayoutStep[] {
  const strip = [...tabs].sort((a, b) => a.index - b.index).map((t) => t.id!);
  const direct = placeBlocks(strip, blocks, pinnedCount);

  const loose = blocks.find((b) => b.groupId === -1);
  if (!loose) return direct;
  let looseStart = pinnedCount;
  for (const b of blocks) {
    if (b === loose) break;
    looseStart += b.ids.length;
  }
  const early = new Set(strip.slice(0, looseStart));
  const strays = loose.ids.filter((id) => early.has(id));
  if (strays.length === 0) return direct;

  const stray = new Set(strays);
  const viaTail = [
    { ids: strays, index: -1, groupId: -1 },
    ...placeBlocks([...strip.filter((id) => !stray.has(id)), ...strays], blocks, pinnedCount),
  ];
  return callCount(viaTail) < callCount(direct) ? viaTail : direct;
}

function placeBlocks(strip: number[], blocks: Block[], pinnedCount: number): LayoutStep[] {
  let model = strip;
  const steps: LayoutStep[] = [];
  let index = pinnedCount;
  for (const block of blocks) {
    // Membership needs no check of its own: a block's tabs are the ones tabs.query reported in
    // that group, and only a tab that is moved can change group.
    const inPlace = block.ids.every((id, i) => model[index + i] === id);
    if (!inPlace) {
      steps.push({ ids: block.ids, index, groupId: block.groupId });
      const moving = new Set(block.ids);
      model = model.filter((id) => !moving.has(id));
      model.splice(index, 0, ...block.ids);
    }
    index += block.ids.length;
  }
  return steps;
}

const callCount = (steps: LayoutStep[]) =>
  steps.reduce((n, s) => n + (s.groupId === -1 ? 1 : 2), 0);

function pinAwareSortTabs(
  tabs: chrome.tabs.Tab[],
  groupTitle: string,
  allPins: PinnedTabEntry[],
  by: "title" | "url" | "domain",
  domainOf: DomainMapper,
  rank: SortRanker
): chrome.tabs.Tab[] {
  const groupPins = allPins.filter((p) => p.groupName === groupTitle);
  if (groupPins.length === 0) return tabs.sort((a, b) => compareTabs(a, b, by, domainOf, rank));

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
  unpinned.sort((a, b) => compareTabs(a, b, by, domainOf, rank));

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
  by: "title" | "url" | "domain",
  domainOf: DomainMapper,
  rank: SortRanker
): number {
  switch (by) {
    case "title":
      return (a.title || "").localeCompare(b.title || "");
    case "url":
      return (a.url || "").localeCompare(b.url || "");
    case "domain": {
      const ra = rank(a.url || "");
      const rb = rank(b.url || "");
      // Rank-first domains lead the strip, in the order the Sort Priority list shows them.
      if (ra.domain !== rb.domain) return ra.domain < rb.domain ? -1 : 1;
      // Domain still wins before path tier, or a rule on one domain would interleave its tabs
      // with another domain's and break up the blocks the whole sort exists to produce.
      const dom = domainOf(a.url || "").localeCompare(domainOf(b.url || ""));
      if (dom !== 0) return dom;
      if (ra.path !== rb.path) return ra.path < rb.path ? -1 : 1;
      return (a.title || "").localeCompare(b.title || "");
    }
  }
}
