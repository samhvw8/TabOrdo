import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import {
  groupStartIndex, buildGroupOrder, pinTab, unpinTab, getPinnedTabs, syncPinUrl, clearPinTabIds, PIN_BADGE,
  applyGroupPinsToWindow, lockedGroupOrder,
} from "./pin.ts";

// 2 pinned tabs, then group A (1), group B (2), group C (3).
function strip(): chrome.tabs.Tab[] {
  const rows = [
    { id: 1, index: 0, pinned: true, groupId: -1 },
    { id: 2, index: 1, pinned: true, groupId: -1 },
    { id: 10, index: 2, pinned: false, groupId: 1 },
    { id: 11, index: 3, pinned: false, groupId: 1 },
    { id: 20, index: 4, pinned: false, groupId: 2 },
    { id: 21, index: 5, pinned: false, groupId: 2 },
    { id: 30, index: 6, pinned: false, groupId: 3 },
  ];
  return rows as unknown as chrome.tabs.Tab[];
}

describe("groupStartIndex", () => {
  it("puts slot 0 immediately after the pinned tabs", () => {
    expect(groupStartIndex(strip(), 3, 0, 2)).toBe(2);
  });

  it("puts slot 1 directly after the first group", () => {
    expect(groupStartIndex(strip(), 3, 1, 2)).toBe(4);
  });

  it("puts slot 2 after the second group", () => {
    expect(groupStartIndex(strip(), 3, 2, 2)).toBe(6);
  });

  // The index is read with the group lifted out, as tabGroups.move reads it. Counting it with A
  // still in the strip gave 6, which lands A after C.
  it("counts a rightward move with the group lifted out", () => {
    // Moving group A (already first) to slot 1: after B, before C.
    expect(groupStartIndex(strip(), 1, 1, 2)).toBe(4);
  });

  it("puts the last slot at the end of the strip without the group", () => {
    expect(groupStartIndex(strip(), 1, 2, 2)).toBe(5);
  });

  it("treats slot 0 as right after pinned tabs even with leading ungrouped tabs", () => {
    const tabs = [
      { id: 1, index: 0, pinned: true, groupId: -1 },
      { id: 5, index: 1, pinned: false, groupId: -1 },
      { id: 10, index: 2, pinned: false, groupId: 1 },
    ] as unknown as chrome.tabs.Tab[];
    expect(groupStartIndex(tabs, 1, 0, 1)).toBe(1);
  });

  it("does not mutate the caller's array", () => {
    const tabs = strip();
    const before = tabs.map((t) => t.id);
    groupStartIndex(tabs, 3, 2, 2);
    expect(tabs.map((t) => t.id)).toEqual(before);
  });
});

describe("buildGroupOrder", () => {
  it("lists group ids in tab-strip order, once each", () => {
    expect(buildGroupOrder(strip())).toEqual([1, 2, 3]);
  });

  it("ignores pinned tabs and ungrouped tabs", () => {
    const tabs = [
      { id: 1, index: 0, pinned: true, groupId: 9 },
      { id: 5, index: 1, pinned: false, groupId: -1 },
      { id: 10, index: 2, pinned: false, groupId: 1 },
    ] as unknown as chrome.tabs.Tab[];
    expect(buildGroupOrder(tabs)).toEqual([1]);
  });
});

describe("unpinTab", () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
  });

  it("removes the entry matched by tabId even when the URL has moved on", async () => {
    await pinTab("https://a.com", "Work", 0, "A", 42);
    // getPinForTab would light up "Unlock" off the tabId; a URL-only unpin found nothing
    // and reported "Tab was not pinned".
    stub.localData["pinnedTabs"] = [
      { id: "x", url: "https://old.example", title: "A", tabId: 42, groupName: "Work", position: 0 },
    ];
    expect(await unpinTab("https://a.com", "Work", 42)).toBe(true);
    expect(await getPinnedTabs()).toEqual([]);
  });

  it("still falls back to a URL match when no tabId is supplied", async () => {
    await pinTab("https://a.com", "Work", 0);
    expect(await unpinTab("https://a.com", "Work")).toBe(true);
    expect(await getPinnedTabs()).toEqual([]);
  });

  it("returns false when nothing matches", async () => {
    await pinTab("https://a.com", "Work", 0, "A", 42);
    expect(await unpinTab("https://b.com", "Work", 99)).toBe(false);
    expect(await getPinnedTabs()).toHaveLength(1);
  });
});

describe("syncPinUrl", () => {
  beforeEach(() => {
    installChromeStub();
  });

  it("returns null when no pin tracks the tab", async () => {
    await pinTab("https://a.com", "Work", 0, "A", 42);
    expect(await syncPinUrl(99, "https://b.com", "B")).toBeNull();
  });

  it("follows the tab through a navigation and returns the entry", async () => {
    await pinTab("https://a.com", "Work", 0, "A", 42);
    const pin = await syncPinUrl(42, "https://a.com/deep", "Deep");
    expect(pin).toMatchObject({ url: "https://a.com/deep", title: "Deep" });
    expect(await getPinnedTabs()).toEqual([
      expect.objectContaining({ url: "https://a.com/deep", title: "Deep" }),
    ]);
  });

  it("strips the title badge before storing — applying the 📌 is not a rename", async () => {
    await pinTab("https://a.com", "Work", 0, "A", 42);
    const pin = await syncPinUrl(42, "https://a.com", `${PIN_BADGE}A`);
    expect(pin?.title).toBe("A");
    expect((await getPinnedTabs())[0].title).toBe("A");
  });
});

describe("clearPinTabIds", () => {
  beforeEach(() => {
    installChromeStub();
  });

  // Tab ids are per-browser-session; a stale one collides with an unrelated tab in the next
  // session, and syncPinUrl (tabId-only match) then rewrites the pin to wherever it goes.
  it("sheds every stored tabId and keeps the rest of each entry", async () => {
    await pinTab("https://a.com", "Work", 0, "A", 42);
    await pinTab("https://b.com", "Work", 1, "B", 43);
    await clearPinTabIds();
    const pins = await getPinnedTabs();
    expect(pins).toHaveLength(2);
    for (const p of pins) expect(p.tabId).toBeUndefined();
    expect(pins[0]).toMatchObject({ url: "https://a.com", groupName: "Work", position: 0, title: "A" });
    // The hijack scenario end-to-end: the old id now belongs to some other tab.
    expect(await syncPinUrl(42, "https://evil.example", "Evil")).toBeNull();
  });

  it("is a no-op when nothing stores a tabId", async () => {
    await pinTab("https://a.com", "Work", 0);
    await clearPinTabIds();
    expect(await getPinnedTabs()).toHaveLength(1);
  });
});

describe("lockedGroupOrder", () => {
  const groups = (...titles: string[]) =>
    titles.map((title, i) => ({ id: i + 1, title })) as chrome.tabGroups.TabGroup[];
  const pin = (groupTitle: string, position: number) => ({ id: groupTitle, groupTitle, position });
  const titles = (order: chrome.tabGroups.TabGroup[]) => order.map((g) => g.title);

  it("keeps the order it is given when nothing is locked", () => {
    expect(titles(lockedGroupOrder(groups("A", "B", "C"), []))).toEqual(["A", "B", "C"]);
  });

  it("puts a locked group at its slot, left or right of where it was", () => {
    expect(titles(lockedGroupOrder(groups("A", "B", "C", "D"), [pin("D", 1)]))).toEqual(["A", "D", "B", "C"]);
    expect(titles(lockedGroupOrder(groups("A", "B", "C", "D"), [pin("A", 2)]))).toEqual(["B", "C", "A", "D"]);
  });

  it("clamps a slot past the end to the last one", () => {
    expect(titles(lockedGroupOrder(groups("A", "B", "C"), [pin("A", 9)]))).toEqual(["B", "C", "A"]);
  });

  it("breaks a tie on the position asked for, then the title, then the order given", () => {
    expect(titles(lockedGroupOrder(groups("A", "B", "C"), [pin("A", 9), pin("B", 4)]))).toEqual(["C", "B", "A"]);
    expect(titles(lockedGroupOrder(groups("B", "A", "C"), [pin("B", 9), pin("A", 9)]))).toEqual(["C", "A", "B"]);
    // One lock, two groups with its title: both obey it, in the order given.
    const twins = [{ id: 7, title: "W" }, { id: 3, title: "A" }, { id: 5, title: "W" }] as chrome.tabGroups.TabGroup[];
    expect(lockedGroupOrder(twins, [pin("W", 0)]).map((g) => g.id)).toEqual([7, 5, 3]);
  });

  it("lets a shared slot spill into the next one", () => {
    expect(titles(lockedGroupOrder(groups("A", "B", "C", "D"), [pin("C", 1), pin("D", 1)])))
      .toEqual(["A", "C", "D", "B"]);
  });

  // The sort and /lockgroup both run it, one on the strip the other left behind.
  it("returns an order it leaves alone", () => {
    const pins = [pin("A", 9), pin("B", 9), pin("E", 1), pin("F", 1)];
    const once = lockedGroupOrder(groups("A", "B", "C", "D", "E", "F"), pins);
    expect(lockedGroupOrder(once, pins)).toEqual(once);
  });
});

describe("applyGroupPinsToWindow", () => {
  let stub: ChromeStub;
  let windowQueries = 0;

  beforeEach(() => {
    stub = installChromeStub();
    windowQueries = 0;
    const query = chrome.tabs.query.bind(chrome.tabs);
    (chrome.tabs as { query: unknown }).query = (q: chrome.tabs.QueryInfo) => {
      if (q.windowId !== undefined) windowQueries++;
      return query(q);
    };
    // Four one-tab groups, A..D left to right, then a loose tab.
    stub.openTabs = ["A", "B", "C", "D"].map((title, i) => ({
      id: i + 1, url: `https://${title}.com`, pinned: false, windowId: 1, groupId: 10 + i, index: i,
    }));
    stub.openTabs.push({ id: 9, url: "https://loose.com", pinned: false, windowId: 1, groupId: -1, index: 4 });
    stub.groups = ["A", "B", "C", "D"].map((title, i) => ({ id: 10 + i, title, windowId: 1 }));
  });

  const order = () => [...stub.openTabs].sort((a, b) => a.index! - b.index!).map((t) => t.id);
  const lock = (...pins: [string, number][]) => {
    stub.localData.pinnedGroups = pins.map(([groupTitle, position]) => ({ id: groupTitle, groupTitle, position }));
  };

  // tabGroups.move keeps a group whole in either direction; a multi-tab tabs.move scatters a
  // group moving right, because Chrome places the ids one at a time.
  it("moves each locked group with tabGroups.move, planned on one query of the window", async () => {
    lock(["D", 0], ["C", 1], ["B", 2]);
    expect(await applyGroupPinsToWindow(1)).toBe(3);
    expect(order()).toEqual([4, 3, 2, 1, 9]);
    expect(stub.moves).toEqual([]);
    expect(stub.groupMoves).toHaveLength(3);
    expect(windowQueries).toBe(1);
  });

  it("lands a group locked to a slot on its right in that slot", async () => {
    lock(["A", 1]);
    expect(await applyGroupPinsToWindow(1)).toBe(1);
    expect(order()).toEqual([2, 1, 3, 4, 9]);
  });

  // The same place the sort gives it, so the auto-sort after /lockgroup $ leaves it alone.
  it("puts a group locked to the last slot right after the other groups", async () => {
    lock(["A", 3]);
    await applyGroupPinsToWindow(1);
    expect(order()).toEqual([2, 3, 4, 1, 9]);
  });

  it("moves only the locked group, not the ones it passes", async () => {
    lock(["A", 2]);
    await applyGroupPinsToWindow(1);
    expect(stub.groupMoves).toEqual([{ groupId: 10, index: 2 }]);
    expect(order()).toEqual([2, 3, 1, 4, 9]);
  });

  it("keeps a multi-tab group whole on a rightward move", async () => {
    stub.openTabs = [
      { id: 1, pinned: false, windowId: 1, groupId: 10, index: 0 },
      { id: 2, pinned: false, windowId: 1, groupId: 10, index: 1 },
      { id: 3, pinned: false, windowId: 1, groupId: 11, index: 2 },
      { id: 4, pinned: false, windowId: 1, groupId: 12, index: 3 },
    ];
    stub.groups = [{ id: 10, title: "A", windowId: 1 }, { id: 11, title: "B", windowId: 1 }, { id: 12, title: "C", windowId: 1 }];
    lock(["A", 1]);
    await applyGroupPinsToWindow(1);
    expect(order()).toEqual([3, 1, 2, 4]);
  });

  it("makes no call when every locked group is already in its slot", async () => {
    lock(["A", 0], ["C", 2]);
    expect(await applyGroupPinsToWindow(1)).toBe(0);
    expect(stub.groupMoves).toEqual([]);
  });
});
