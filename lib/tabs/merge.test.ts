import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { mergeAllWindows, mergeAllWindowsWithPinned } from "./index.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }, { id: 2 }];
});

function groupOf(tabId: number): number {
  return stub.openTabs.find((t) => t.id === tabId)!.groupId;
}

/** Tab ids of a window in strip order. */
function stripOf(windowId: number): number[] {
  return stub.openTabs
    .filter((t) => t.windowId === windowId)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((t) => t.id);
}

describe("mergeAllWindows", () => {
  it("rebuilds a group carried over from another window", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com", pinned: false, windowId: 2, groupId: 50, index: 0 },
      { id: 3, url: "https://b.com", pinned: false, windowId: 2, groupId: 50, index: 1 },
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 2 }];

    await mergeAllWindows();

    expect(stub.openTabs.every((t) => t.windowId === 1)).toBe(true);
    expect(groupOf(2)).not.toBe(-1);
    expect(groupOf(2)).toBe(groupOf(3));
    expect(stub.groupUpdates).toEqual([
      expect.objectContaining({ title: "Work", color: "blue" }),
    ]);
  });

  it("leaves ungrouped tabs ungrouped", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://loose.com", pinned: false, windowId: 2, groupId: -1, index: 0 },
    ];

    await mergeAllWindows();

    expect(groupOf(2)).toBe(-1);
    expect(stub.groupUpdates).toEqual([]);
  });

  it("folds an incoming group into a same-titled group already in the target window", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 60, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 2, groupId: 61, index: 0 },
    ];
    stub.groups = [
      { id: 60, title: "Work", color: "blue", windowId: 1 },
      { id: 61, title: "Work", color: "blue", windowId: 2 },
    ];

    await mergeAllWindows();

    expect(groupOf(2)).toBe(60);
    // Joined the existing group rather than creating and titling a second one.
    expect(stub.groupUpdates).toEqual([]);
  });

  it("keeps groups with the same title but different colors separate", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 60, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 2, groupId: 61, index: 0 },
    ];
    stub.groups = [
      { id: 60, title: "Work", color: "blue", windowId: 1 },
      { id: 61, title: "Work", color: "red", windowId: 2 },
    ];

    await mergeAllWindows();

    expect(groupOf(2)).not.toBe(60);
    expect(stub.groupUpdates).toEqual([
      expect.objectContaining({ title: "Work", color: "red" }),
    ]);
  });

  it("merges same-titled groups from two different source windows into one", async () => {
    stub.windows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com", pinned: false, windowId: 2, groupId: 70, index: 0 },
      { id: 3, url: "https://b.com", pinned: false, windowId: 3, groupId: 71, index: 0 },
    ];
    stub.groups = [
      { id: 70, title: "Docs", color: "green", windowId: 2 },
      { id: 71, title: "Docs", color: "green", windowId: 3 },
    ];

    await mergeAllWindows();

    expect(groupOf(2)).toBe(groupOf(3));
    expect(stub.groupUpdates).toHaveLength(1);
  });

  it("keeps untitled groups distinct instead of collapsing them together", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com", pinned: false, windowId: 2, groupId: 80, index: 0 },
      { id: 3, url: "https://b.com", pinned: false, windowId: 2, groupId: 81, index: 1 },
    ];
    stub.groups = [
      { id: 80, color: "blue", windowId: 2 },
      { id: 81, color: "red", windowId: 2 },
    ];

    await mergeAllWindows();

    expect(groupOf(2)).not.toBe(-1);
    expect(groupOf(3)).not.toBe(-1);
    expect(groupOf(2)).not.toBe(groupOf(3));
  });

  it("preserves the collapsed state of a carried group", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com", pinned: false, windowId: 2, groupId: 90, index: 0 },
    ];
    stub.groups = [{ id: 90, title: "Reading", color: "pink", collapsed: true, windowId: 2 }];

    await mergeAllWindows();

    expect(stub.groupUpdates).toEqual([
      expect.objectContaining({ title: "Reading", collapsed: true }),
    ]);
  });

  it("does not move pinned tabs out of their window", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://pinned.com", pinned: true, windowId: 2, groupId: -1, index: 0 },
    ];

    await mergeAllWindows();

    expect(stub.openTabs.find((t) => t.id === 2)!.windowId).toBe(2);
    expect(stub.moves).toEqual([]);
  });

  it("leaves incognito, popup and app windows alone instead of failing the whole move", async () => {
    stub.windows = [{ id: 1 }, { id: 2, incognito: true }, { id: 3, type: "popup" }, { id: 4, type: "app" }, { id: 5 }];
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://private.com", pinned: false, windowId: 2, groupId: -1, index: 0 },
      { id: 3, url: "https://popup.com", pinned: false, windowId: 3, groupId: -1, index: 0 },
      { id: 4, url: "https://app.com", pinned: false, windowId: 4, groupId: -1, index: 0 },
      { id: 5, url: "https://other.com", pinned: false, windowId: 5, groupId: -1, index: 0 },
    ];

    const result = await mergeAllWindows();

    expect(result.moved).toBe(1);
    expect(stripOf(1)).toEqual([1, 5]);
    expect([2, 3, 4].map((id) => stub.openTabs.find((t) => t.id === id)!.windowId)).toEqual([2, 3, 4]);
  });

  it("is a no-op when every tab already lives in the current window", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 95, index: 0 },
    ];
    stub.groups = [{ id: 95, title: "Work", color: "blue", windowId: 1 }];

    const result = await mergeAllWindows();

    expect(stub.moves).toEqual([]);
    expect(groupOf(1)).toBe(95);
    expect(result).toEqual({ moved: 0, groupsFailed: 0 });
  });
});

// The stub models tab.index and per-window reindexing, so these assertions are real. What it
// still cannot decide is whether Chrome preserves the order of a multi-tab
// chrome.tabs.move(ids, {index:-1}) — that is unverifiable outside a browser, so nothing here
// depends on it.
describe("mergeAllWindows — strip position", () => {
  it("appends merged tabs after the target window's existing tabs", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://second.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 3, url: "https://other.com", pinned: false, windowId: 2, groupId: -1, index: 0 },
    ];

    await mergeAllWindows();

    // Incoming tabs go to the end — index: -1. An index of 0 would put them in front.
    expect(stripOf(1)).toEqual([1, 2, 3]);
  });

  it("keeps a rebuilt group's tabs contiguous", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 10, url: "https://a1.com", pinned: false, windowId: 2, groupId: 50, index: 0 },
      { id: 99, url: "https://loose.com", pinned: false, windowId: 2, groupId: -1, index: 1 },
      { id: 11, url: "https://a2.com", pinned: false, windowId: 2, groupId: 50, index: 2 },
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 2 }];

    await mergeAllWindows();

    const gid = groupOf(10);
    const positions = stripOf(1)
      .map((id, i) => ({ id, i }))
      .filter(({ id }) => groupOf(id) === gid)
      .map(({ i }) => i);
    expect(positions).toEqual([positions[0], positions[0] + 1]);
  });
});

describe("mergeAllWindows — failure reporting", () => {
  it("reports groups it could not rebuild instead of claiming success", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com", pinned: false, windowId: 2, groupId: 50, index: 0 },
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 2 }];
    stub.failGroup = true;

    const result = await mergeAllWindows();

    // The move still happened, so the tabs are loose in window 1 — the caller has to know.
    expect(result.moved).toBe(1);
    expect(result.groupsFailed).toBe(1);
    expect(groupOf(2)).toBe(-1);
  });

  it("reports zero failures when every group rebuilds", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com", pinned: false, windowId: 2, groupId: 50, index: 0 },
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 2 }];

    expect(await mergeAllWindows()).toEqual({ moved: 1, groupsFailed: 0 });
  });
});

describe("mergeAllWindowsWithPinned", () => {
  it("moves pinned tabs too, keeping them pinned, so the source window is left empty", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://pinned.com", pinned: true, windowId: 2, groupId: -1, index: 0 },
      { id: 3, url: "https://a.com", pinned: false, windowId: 2, groupId: 50, index: 1 },
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 2 }];

    const result = await mergeAllWindowsWithPinned();

    expect(result).toEqual({ moved: 2, groupsFailed: 0 });
    expect(stub.openTabs.filter((t) => t.windowId === 2)).toEqual([]);
    expect(stub.openTabs.find((t) => t.id === 2)!.pinned).toBe(true);
    expect(groupOf(3)).not.toBe(-1);
  });

  it("re-pins a pinned tab that arrives unpinned", async () => {
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://pinned.com", pinned: true, windowId: 2, groupId: -1, index: 0 },
    ];
    // Model a move that drops the pin, which nothing in the extension API promises against.
    const move = chrome.tabs.move;
    chrome.tabs.move = (async (ids: number[], props: chrome.tabs.MoveProperties) => {
      const moved = (await move(ids, props)) as unknown as chrome.tabs.Tab[];
      for (const t of moved) t.pinned = false;
      return moved;
    }) as typeof chrome.tabs.move;

    await mergeAllWindowsWithPinned();

    expect(stub.openTabs.find((t) => t.id === 2)!.pinned).toBe(true);
    expect(stub.tabUpdates).toEqual([{ id: 2, pinned: true }]);
  });

  it("leaves incognito, popup and app windows alone", async () => {
    stub.windows = [
      { id: 1 },
      { id: 2, incognito: true },
      { id: 3, type: "popup" },
      { id: 4, type: "app" },
      { id: 5 },
    ];
    stub.openTabs = [
      { id: 1, url: "https://home.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://private.com", pinned: false, windowId: 2, groupId: -1, index: 0 },
      { id: 3, url: "https://popup.com", pinned: false, windowId: 3, groupId: -1, index: 0 },
      { id: 4, url: "https://app.com", pinned: false, windowId: 4, groupId: -1, index: 0 },
      { id: 5, url: "https://other.com", pinned: false, windowId: 5, groupId: -1, index: 0 },
    ];

    const result = await mergeAllWindowsWithPinned();

    expect(result.moved).toBe(1);
    expect(stripOf(1)).toEqual([1, 5]);
    expect(stub.openTabs.find((t) => t.id === 2)!.windowId).toBe(2);
    expect(stub.openTabs.find((t) => t.id === 3)!.windowId).toBe(3);
    expect(stub.openTabs.find((t) => t.id === 4)!.windowId).toBe(4);
  });

  it("from an incognito window, gathers the other incognito windows only", async () => {
    stub.currentWindowId = 2;
    stub.windows = [{ id: 1 }, { id: 2, incognito: true }, { id: 3, incognito: true }];
    stub.openTabs = [
      { id: 1, url: "https://regular.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://p1.com", pinned: false, windowId: 2, groupId: -1, index: 0 },
      { id: 3, url: "https://p2.com", pinned: true, windowId: 3, groupId: -1, index: 0 },
    ];

    const result = await mergeAllWindowsWithPinned();

    expect(result.moved).toBe(1);
    expect(stub.openTabs.find((t) => t.id === 1)!.windowId).toBe(1);
    expect(stub.openTabs.find((t) => t.id === 3)!.windowId).toBe(2);
  });

  it("is a no-op when there is no other window", async () => {
    stub.windows = [{ id: 1 }];
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: true, windowId: 1, groupId: -1, index: 0 },
    ];

    expect(await mergeAllWindowsWithPinned()).toEqual({ moved: 0, groupsFailed: 0 });
    expect(stub.moves).toEqual([]);
  });
});
