import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { sortTabsInWindow, sortTabsInGroup } from "./sort.ts";
import { pinTab } from "../pin.ts";
import { setSortRules, type SortRule } from "../rules.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }];
});

/** Ids in strip order for a window. */
const strip = (windowId = 1) =>
  stub.openTabs.filter((t) => t.windowId === windowId).sort((a, b) => a.index! - b.index!).map((t) => t.id);

const tab = (t: Partial<{ id: number; url: string; title: string; pinned: boolean; windowId: number; groupId: number; index: number }>) =>
  ({ id: 0, url: "https://x.com", title: "", pinned: false, windowId: 1, groupId: -1, index: 0, ...t }) as any;

describe("sortTabsInWindow", () => {
  it("orders ungrouped tabs by domain", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://zebra.com", index: 0 }),
      tab({ id: 2, url: "https://apple.com", index: 1 }),
      tab({ id: 3, url: "https://mango.com", index: 2 }),
    ];
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([2, 3, 1]);
  });

  it("orders by title when asked", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com", title: "Charlie", index: 0 }),
      tab({ id: 2, url: "https://b.com", title: "Alpha", index: 1 }),
      tab({ id: 3, url: "https://c.com", title: "Bravo", index: 2 }),
    ];
    await sortTabsInWindow(1, "title");
    expect(strip()).toEqual([2, 3, 1]);
  });

  it("orders by url when asked", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://c.com/z", index: 0 }),
      tab({ id: 2, url: "https://a.com/y", index: 1 }),
    ];
    await sortTabsInWindow(1, "url");
    expect(strip()).toEqual([2, 1]);
  });

  // Chrome pins live at the head of the strip and cannot be reordered past; sorting has to
  // start counting after them or every move is off by the pinned count.
  it("never moves a Chrome-pinned tab out of the head", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://zzz.com", index: 0, pinned: true }),
      tab({ id: 2, url: "https://mango.com", index: 1 }),
      tab({ id: 3, url: "https://apple.com", index: 2 }),
    ];
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([1, 3, 2]);
  });

  it("keeps each group's tabs contiguous", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com", index: 0, groupId: 50 }),
      tab({ id: 2, url: "https://loose.com", index: 1 }),
      tab({ id: 3, url: "https://b.com", index: 2, groupId: 50 }),
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
    await sortTabsInWindow(1, "domain");
    const positions = stub.openTabs.filter((t) => t.groupId === 50).map((t) => t.index!).sort((a, b) => a - b);
    expect(positions[1] - positions[0]).toBe(1);
  });

  it("puts grouped tabs ahead of loose ones", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://loose.com", index: 0 }),
      tab({ id: 2, url: "https://a.com", index: 1, groupId: 50 }),
      tab({ id: 3, url: "https://b.com", index: 2, groupId: 50 }),
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([2, 3, 1]);
  });

  it("orders groups among themselves by title", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com", index: 0, groupId: 60 }),
      tab({ id: 2, url: "https://b.com", index: 1, groupId: 50 }),
    ];
    stub.groups = [
      { id: 50, title: "Alpha", color: "blue", windowId: 1 },
      { id: 60, title: "Zulu", color: "red", windowId: 1 },
    ];
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([2, 1]);
  });

  it("is a no-op on an empty window", async () => {
    await sortTabsInWindow(1, "domain");
    expect(stub.moves).toEqual([]);
  });
});

describe("sortTabsInWindow call count", () => {
  // Auto-sort runs this on every tab that finishes loading, so the common case is a window
  // that is already sorted, or one tab away from it.
  let groupCalls: () => number;

  beforeEach(() => {
    stub.openTabs = [
      tab({ id: 1, url: "https://pinned.com", index: 0, pinned: true }),
      tab({ id: 2, url: "https://a.com", index: 1, groupId: 50 }),
      tab({ id: 3, url: "https://b.com", index: 2, groupId: 50 }),
      tab({ id: 4, url: "https://c.com", index: 3, groupId: 60 }),
      tab({ id: 5, url: "https://d.com", index: 4, groupId: 60 }),
      tab({ id: 6, url: "https://e.com", index: 5 }),
      tab({ id: 7, url: "https://f.com", index: 6 }),
    ];
    stub.groups = [
      { id: 50, title: "Alpha", color: "blue", windowId: 1 },
      { id: 60, title: "Work", color: "red", windowId: 1 },
    ];
    const group = chrome.tabs.group.bind(chrome.tabs);
    let n = 0;
    (chrome.tabs as { group: unknown }).group = (opts: chrome.tabs.GroupOptions) => { n++; return group(opts); };
    groupCalls = () => n;
  });

  const at = (id: number, index: number) => {
    const moved = stub.openTabs.find((t) => t.id === id)!;
    const rest = strip().filter((x) => x !== id);
    rest.splice(index, 0, id);
    for (const t of stub.openTabs) t.index = rest.indexOf(t.id);
    expect(moved.index).toBe(index);
  };

  it("makes no moves and no regroups on a window that is already sorted", async () => {
    await sortTabsInWindow(1, "domain");
    expect(stub.moves).toEqual([]);
    expect(groupCalls()).toBe(0);
    expect(strip()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("moves only the loose tabs when one of them is out of order", async () => {
    at(7, 5);
    await sortTabsInWindow(1, "domain");
    expect(stub.moves).toEqual([{ ids: [6, 7], index: 5, windowId: undefined }]);
    expect(groupCalls()).toBe(0);
    expect(strip()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("moves and regroups only the group whose order changed", async () => {
    at(5, 3);
    await sortTabsInWindow(1, "domain");
    expect(stub.moves).toEqual([{ ids: [4, 5], index: 3, windowId: undefined }]);
    expect(groupCalls()).toBe(1);
    expect(strip()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  // A link opened from a Chrome-pinned tab lands right after the pins, one slot ahead of every
  // group. Re-laying block by block from the front would move and regroup each of them.
  it("sends a loose tab stranded ahead of the groups to the tail instead of re-laying every group", async () => {
    at(7, 1);
    await sortTabsInWindow(1, "domain");
    expect(stub.moves).toEqual([{ ids: [7], index: -1, windowId: undefined }]);
    expect(groupCalls()).toBe(0);
    expect(strip()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("still lands a stranded tab mid-way through the loose tabs", async () => {
    at(6, 1);
    await sortTabsInWindow(1, "domain");
    expect(stub.moves).toHaveLength(2);
    expect(groupCalls()).toBe(0);
    expect(strip()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("sortTabsInWindow with position locks", () => {
  // A lock is the whole reason sorting is not just a comparator: the locked tab has to land on
  // its held index and everything else has to flow around it.
  it("lands a locked tab on its held position, out of sort order", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://apple.com", index: 0, groupId: 50 }),
      tab({ id: 2, url: "https://mango.com", index: 1, groupId: 50 }),
      tab({ id: 3, url: "https://zebra.com", index: 2, groupId: 50 }),
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
    // Hold zebra.com first, even though domain order would put it last.
    await pinTab("https://zebra.com", "Work", 0, "Zebra", 3);

    await sortTabsInWindow(1, "domain");
    expect(strip()[0]).toBe(3);
  });

  it("sorts the rest normally around the locked tab", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://mango.com", index: 0, groupId: 50 }),
      tab({ id: 2, url: "https://apple.com", index: 1, groupId: 50 }),
      tab({ id: 3, url: "https://zebra.com", index: 2, groupId: 50 }),
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
    await pinTab("https://zebra.com", "Work", 0, "Zebra", 3);

    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([3, 2, 1]);
  });

  // pinAwareSortTabs resolves by tabId before URL. A lock recorded against a tab whose URL has
  // since changed must still hold that tab, or navigating a locked tab silently releases it.
  it("holds a locked tab by tabId even after its URL changes", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://apple.com", index: 0, groupId: 50 }),
      tab({ id: 2, url: "https://mango.com", index: 1, groupId: 50 }),
      tab({ id: 3, url: "https://zebra.com", index: 2, groupId: 50 }),
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
    await pinTab("https://zebra.com", "Work", 0, "Zebra", 3);

    // The tab navigates somewhere the pin's stored URL no longer matches.
    stub.openTabs.find((t) => t.id === 3)!.url = "https://zebra.com/somewhere-else";

    await sortTabsInWindow(1, "domain");
    expect(strip()[0]).toBe(3);
  });
});

describe("sortTabsInWindow with sort rules", () => {
  const sortRule = (over: Partial<SortRule> & { domain: string }): SortRule =>
    ({ id: over.domain, rankFirst: false, patterns: [], enabled: true, ...over });

  it("lifts rank-first domains to the head, in list order", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://apple.com/a", index: 0 }),
      tab({ id: 2, url: "https://sangtacviet.vip/x", index: 1 }),
      tab({ id: 3, url: "https://banana.com/b", index: 2 }),
    ];
    await setSortRules([
      sortRule({ domain: "sangtacviet.vip", rankFirst: true }),
      sortRule({ domain: "apple.com", rankFirst: true }),
    ]);
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([2, 1, 3]);
  });

  it("orders paths inside a domain without moving the domain itself", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/settings", title: "Settings", index: 0 }),
      tab({ id: 2, url: "https://github.com/o/r/issues/9", title: "Issue", index: 1 }),
      tab({ id: 3, url: "https://github.com/o/r/pulls/12", title: "PR", index: 2 }),
      tab({ id: 4, url: "https://apple.com/a", title: "Apple", index: 3 }),
    ];
    await setSortRules([
      sortRule({ domain: "github.com", patterns: ["**/pulls/**", "**/issues/**"] }),
    ]);
    await sortTabsInWindow(1, "domain");
    // apple.com still sorts ahead of github.com; only github's own run is reordered.
    expect(strip()).toEqual([4, 3, 2, 1]);
  });

  it("combines a rank-first domain with its own path order", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://apple.com/a", title: "Apple", index: 0 }),
      tab({ id: 2, url: "https://sangtacviet.vip/about", title: "About", index: 1 }),
      tab({ id: 3, url: "https://sangtacviet.vip/truyen/9", title: "Truyen", index: 2 }),
    ];
    await setSortRules([
      sortRule({ domain: "sangtacviet.vip", rankFirst: true, patterns: ["/truyen/*"] }),
    ]);
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([3, 2, 1]);
  });

  // Two rank-first domains must not interleave: the rank decides which block leads, and the
  // domain comparison still has to hold each block together.
  it("keeps each rank-first domain's tabs contiguous", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://apple.com/a", title: "A", index: 0 }),
      tab({ id: 2, url: "https://sangtacviet.vip/x", title: "X", index: 1 }),
      tab({ id: 3, url: "https://apple.com/b", title: "B", index: 2 }),
      tab({ id: 4, url: "https://sangtacviet.vip/y", title: "Y", index: 3 }),
    ];
    await setSortRules([
      sortRule({ domain: "sangtacviet.vip", rankFirst: true }),
      sortRule({ domain: "apple.com", rankFirst: true }),
    ]);
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([2, 4, 1, 3]);
  });

  it("ignores a disabled rule", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://zebra.com/a", index: 0 }),
      tab({ id: 2, url: "https://apple.com/b", index: 1 }),
    ];
    await setSortRules([sortRule({ domain: "zebra.com", rankFirst: true, enabled: false })]);
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([2, 1]);
  });

  // Rules describe domain blocks, and a title sort has none — applying them there would make
  // /sort title quietly stop sorting by title.
  it("leaves a title sort alone", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://apple.com/a", title: "Alpha", index: 0 }),
      tab({ id: 2, url: "https://zebra.com/b", title: "Bravo", index: 1 }),
    ];
    await setSortRules([sortRule({ domain: "zebra.com", rankFirst: true })]);
    await sortTabsInWindow(1, "title");
    expect(strip()).toEqual([1, 2]);
  });

  it("applies inside a group too", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/settings", title: "Settings", index: 0, groupId: 50 }),
      tab({ id: 2, url: "https://github.com/o/r/pulls/12", title: "PR", index: 1, groupId: 50 }),
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
    await setSortRules([sortRule({ domain: "github.com", patterns: ["**/pulls/**"] })]);
    await sortTabsInGroup(50, "domain");
    const inGroup = stub.openTabs.filter((t) => t.groupId === 50).sort((a, b) => a.index! - b.index!);
    expect(inGroup.map((t) => t.id)).toEqual([2, 1]);
  });

  // A lock is an absolute index; a sort rule only changes comparisons. When both apply the
  // lock has to win, or "locked" would mean nothing on a domain that also has rules.
  it("still yields to a position lock", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/settings", title: "Settings", index: 0, groupId: 50 }),
      tab({ id: 2, url: "https://github.com/o/r/pulls/12", title: "PR", index: 1, groupId: 50 }),
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
    await setSortRules([sortRule({ domain: "github.com", patterns: ["**/pulls/**"] })]);
    await pinTab("https://github.com/settings", "Work", 0, "Settings", 1);

    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([1, 2]);
  });
});

describe("sortTabsInGroup", () => {
  beforeEach(() => {
    stub.openTabs = [
      tab({ id: 1, url: "https://zebra.com", title: "Zebra", index: 0, groupId: 50 }),
      tab({ id: 2, url: "https://apple.com", title: "Apple", index: 1, groupId: 50 }),
      tab({ id: 3, url: "https://outside.com", title: "Outside", index: 2 }),
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
  });

  it("sorts only the group's own tabs", async () => {
    await sortTabsInGroup(50, "title");
    const inGroup = stub.openTabs.filter((t) => t.groupId === 50).sort((a, b) => a.index! - b.index!);
    expect(inGroup.map((t) => t.id)).toEqual([2, 1]);
  });

  it("leaves tabs outside the group where they were", async () => {
    await sortTabsInGroup(50, "title");
    expect(stub.openTabs.find((t) => t.id === 3)!.groupId).toBe(-1);
  });

  it("is a no-op for a group with no tabs", async () => {
    await sortTabsInGroup(999, "title");
    expect(stub.moves).toEqual([]);
  });
});

describe("sort rules across two rules on one registrable domain", () => {
  const sortRule = (over: Partial<SortRule> & { domain: string }): SortRule =>
    ({ id: over.domain, rankFirst: false, patterns: [], enabled: true, ...over });

  // mail. and docs. both collapse to google.com, so these tabs share a block and their path
  // tiers get compared directly. Rule order decides, which is the precedence dragging sets.
  it("orders by rule position, not by each rule's own pattern index", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://docs.google.com/search", title: "Docs", index: 0 }),
      tab({ id: 2, url: "https://mail.google.com/inbox", title: "Mail", index: 1 }),
    ];
    await setSortRules([
      // /inbox is the SECOND pattern of the FIRST rule; /search is the first pattern of the
      // second rule. Per-rule indices would put Docs ahead.
      sortRule({ domain: "mail.google.com", patterns: ["/starred", "/inbox"] }),
      sortRule({ domain: "docs.google.com", patterns: ["/search"] }),
    ]);
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([2, 1]);
  });

  it("still puts any matched path ahead of an unmatched one", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://docs.google.com/other", title: "Other", index: 0 }),
      tab({ id: 2, url: "https://docs.google.com/search", title: "Search", index: 1 }),
    ];
    await setSortRules([sortRule({ domain: "google.com", patterns: ["/search"] })]);
    await sortTabsInWindow(1, "domain");
    expect(strip()).toEqual([2, 1]);
  });
});
