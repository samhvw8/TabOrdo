import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { sortTabsInWindow, sortTabsInGroup } from "./sort.ts";
import { pinTab } from "../pin.ts";

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
