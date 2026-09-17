import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import {
  groupStartIndex, buildGroupOrder, pinTab, unpinTab, getPinnedTabs, syncPinUrl, clearPinTabIds, PIN_BADGE,
  applyGroupPinsToWindow, applyAllGroupPins,
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

  it("skips the group being moved when counting slots", () => {
    // Moving group A (already first) to slot 1 lands it after group B.
    expect(groupStartIndex(strip(), 1, 1, 2)).toBe(6);
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

  // Each move shifts the indices after it. The pass used to re-query the whole window after
  // every lock to find out where things now were; a leftward move is fully predictable.
  it("follows its own moves with a local copy instead of re-querying per lock", async () => {
    const pins = [
      { id: "d", groupTitle: "D", position: 0 },
      { id: "c", groupTitle: "C", position: 1 },
      { id: "b", groupTitle: "B", position: 2 },
    ];
    expect(await applyGroupPinsToWindow(1, pins)).toBe(3);
    expect(order()).toEqual([4, 3, 2, 1, 9]);
    expect(windowQueries).toBe(1);
  });

  // A rightward move to a slot short of the last lands where only Chrome knows (see
  // GroupPinMove.predictable), so that move alone is followed by a fresh query.
  it("re-queries after a move only Chrome can place", async () => {
    expect(await applyGroupPinsToWindow(1, [{ id: "a", groupTitle: "A", position: 1 }])).toBe(1);
    expect(windowQueries).toBe(2);
  });

  it("reads the lock list itself when not handed one", async () => {
    stub.localData.pinnedGroups = [{ id: "d", groupTitle: "D", position: 0 }];
    expect(await applyGroupPinsToWindow(1)).toBe(1);
    expect(order()).toEqual([4, 1, 2, 3, 9]);
  });
});

describe("applyAllGroupPins", () => {
  it("reads the lock list once, not once per window", async () => {
    const stub = installChromeStub();
    stub.windows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    stub.openTabs = [1, 2, 3].flatMap((w) => [
      { id: w * 10, url: "https://a.com", pinned: false, windowId: w, groupId: w * 10, index: 0 },
      { id: w * 10 + 1, url: "https://b.com", pinned: false, windowId: w, groupId: w * 10 + 1, index: 1 },
    ]);
    stub.groups = [1, 2, 3].flatMap((w) => [
      { id: w * 10, title: "A", windowId: w },
      { id: w * 10 + 1, title: "B", windowId: w },
    ]);
    stub.localData.pinnedGroups = [{ id: "b", groupTitle: "B", position: 0 }];
    stub.storageReads.length = 0;

    expect(await applyAllGroupPins()).toBe(3);
    expect(stub.storageReads.filter((r) => r.keys.includes("pinnedGroups"))).toHaveLength(1);
  });
});
