// Seeded window layouts for the lock invariant tests (lib/tabs/sort-invariants.test.ts).
//
// Every layout is one Chrome could actually be in: Chrome-pinned tabs lead the strip and are
// never grouped, each group's tabs are contiguous, and every grouped tab's group lives in the
// same window. The stub accepts states Chrome never produces (a grouped pinned tab, a group
// with no windowId); the sort was never specified against those, so they are not generated.

import type { ChromeStub, StubGroup, StubTab } from "./chrome-stub.ts";
import type { PinnedGroupEntry, PinnedTabEntry } from "../pin.ts";
import type { SortRule } from "../rules.ts";

export interface SortFixture {
  seed: number;
  by: "title" | "url" | "domain";
  windowIds: number[];
  tabs: StubTab[];
  groups: StubGroup[];
  pinnedTabs: PinnedTabEntry[];
  pinnedGroups: PinnedGroupEntry[];
  sortRules: SortRule[] | null;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small pools on purpose: repeated sites, titles and group names are what exercise the ties,
// duplicate group titles and URL-matched locks the sort has to settle deterministically.
const SITES = [
  "https://github.com", "https://docs.github.com", "https://google.com", "https://mail.google.com",
  "https://bbc.co.uk", "https://apple.com", "https://zebra.io", "http://localhost:3000",
];
const PATHS = ["/", "/a", "/b", "/issues/1", "/pulls/2"];
const TITLES = ["", "Alpha", "Beta", "beta", "Gamma", "Alpha"];
const GROUP_TITLES = ["", "Work", "Work", "github", "Alpha", "zeta", "Reading"];
const PIN_GROUP_TITLES = ["Work", "github", "Alpha", "zeta", "Reading", "Missing"];

export function buildSortFixture(seed: number): SortFixture {
  const r = mulberry32(seed);
  const int = (n: number) => Math.floor(r() * n);
  const pick = <T>(arr: T[]): T => arr[int(arr.length)];
  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const tabs: StubTab[] = [];
  const groups: StubGroup[] = [];
  const windowIds = int(3) === 0 ? [1, 2] : [1];
  let nextGroupId = 10;

  const newTab = (windowId: number, index: number, groupId: number, pinned: boolean): StubTab => ({
    id: 0,
    url: pick(SITES) + pick(PATHS),
    title: pick(TITLES),
    pinned,
    windowId,
    groupId,
    index,
  });

  for (const windowId of windowIds) {
    let index = 0;
    for (let i = int(3); i > 0; i--) tabs.push(newTab(windowId, index++, -1, true));
    for (let run = int(7); run > 0; run--) {
      if (r() < 0.55) {
        const groupId = nextGroupId++;
        groups.push({ id: groupId, title: pick(GROUP_TITLES), color: "blue", windowId });
        for (let n = 1 + int(4); n > 0; n--) tabs.push(newTab(windowId, index++, groupId, false));
      } else {
        for (let n = 1 + int(3); n > 0; n--) tabs.push(newTab(windowId, index++, -1, false));
      }
    }
  }

  // Ids uncorrelated with strip order, so no ordering can pass by leaning on id order.
  const ids = shuffle(tabs.map((_, i) => i + 1));
  tabs.forEach((t, i) => { t.id = ids[i]; });

  const pinnedTabs: PinnedTabEntry[] = [];
  for (const g of groups) {
    if (!g.title || r() >= 0.35) continue;
    const members = tabs.filter((t) => t.groupId === g.id);
    for (let n = 1 + int(2); n > 0; n--) {
      const tab = pick(members);
      pinnedTabs.push({
        id: `tp${pinnedTabs.length}`,
        url: r() < 0.2 ? pick(SITES) + pick(PATHS) : tab.url!,
        title: tab.title,
        tabId: r() < 0.5 ? tab.id : undefined,
        groupName: g.title,
        position: int(4),
      });
    }
  }

  // Mostly titles that exist in the fixture, so pins actually move groups rather than miss.
  const presentTitles = groups.map((g) => g.title!).filter(Boolean);
  const pinnedGroups: PinnedGroupEntry[] = [];
  for (let n = r() < 0.65 ? 1 + int(3) : 0; n > 0; n--) {
    const groupTitle = presentTitles.length > 0 && r() < 0.8 ? pick(presentTitles) : pick(PIN_GROUP_TITLES);
    // pinGroup keeps titles unique; positions are left free to collide, as clamping to the
    // window's group count makes them do in real profiles.
    if (pinnedGroups.some((p) => p.groupTitle === groupTitle)) continue;
    pinnedGroups.push({ id: `gp${pinnedGroups.length}`, groupTitle, position: int(5) });
  }

  const sortRules: SortRule[] | null = r() < 0.25
    ? [{
        id: "sr",
        domain: pick(["github.com", "zebra.io", "google.com"]),
        rankFirst: r() < 0.7,
        patterns: r() < 0.5 ? ["/issues/*"] : [],
        enabled: true,
      }]
    : null;

  const by = r() < 0.7 ? "domain" : pick(["title", "url"] as const);

  // chrome.tabs.query returns strip order; the stub returns array order. Shuffle some fixtures
  // so tie-breaking that leans on query order is exercised both ways.
  if (r() < 0.33) shuffle(tabs);
  if (r() < 0.5) shuffle(groups);

  return { seed, by, windowIds, tabs, groups, pinnedTabs, pinnedGroups, sortRules };
}

/** Copy a fixture into a freshly installed stub. Deep copies, so a run never edits the fixture. */
export function loadSortFixture(stub: ChromeStub, fx: SortFixture): void {
  stub.windows = fx.windowIds.map((id) => ({ id }));
  stub.currentWindowId = fx.windowIds[0];
  stub.openTabs = structuredClone(fx.tabs);
  stub.groups = structuredClone(fx.groups);
  stub.localData.pinnedTabs = structuredClone(fx.pinnedTabs);
  stub.localData.pinnedGroups = structuredClone(fx.pinnedGroups);
  if (fx.sortRules) stub.localData.rulesConfig = { sortRules: structuredClone(fx.sortRules) };
}

/** Each window's strip as "id:groupId" in index order. */
export function stripLayout(stub: ChromeStub, windowIds: number[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of windowIds) {
    out[w] = stub.openTabs
      .filter((t) => t.windowId === w)
      .sort((a, b) => a.index! - b.index!)
      .map((t) => `${t.id}:${t.groupId}`)
      .join(" ");
  }
  return out;
}
