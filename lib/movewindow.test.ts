import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { uniteDomain, isolateDomain, splitByDomain } from "./tabs.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }, { id: 2 }];
});

function groupOf(tabId: number): number {
  return stub.openTabs.find((t) => t.id === tabId)!.groupId;
}

// mergeAllWindows was fixed for cross-window group loss first; these four siblings move tabs
// across windows too and used to destroy groups the same way.
describe("uniteDomain", () => {
  it("keeps the group of a tab pulled in from another window", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/here", pinned: false, windowId: 1, groupId: -1, index: 0, active: true },
      { id: 2, url: "https://a.com/there", pinned: false, windowId: 2, groupId: 50, index: 0 },
      { id: 3, url: "https://a.com/more", pinned: false, windowId: 2, groupId: 50, index: 1 },
    ];
    stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 2 }];

    const moved = await uniteDomain();

    expect(moved).toBe(2);
    expect(groupOf(2)).not.toBe(-1);
    expect(groupOf(2)).toBe(groupOf(3));
    expect(stub.groupUpdates).toEqual([
      expect.objectContaining({ title: "Work", color: "blue" }),
    ]);
  });

  it("leaves ungrouped tabs ungrouped", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/here", pinned: false, windowId: 1, groupId: -1, index: 0, active: true },
      { id: 2, url: "https://a.com/there", pinned: false, windowId: 2, groupId: -1, index: 0 },
    ];

    expect(await uniteDomain()).toBe(1);
    expect(groupOf(2)).toBe(-1);
    expect(stub.groupUpdates).toEqual([]);
  });
});

describe("isolateDomain", () => {
  // windows.create({tabId}) detaches that first tab too, so capture has to happen before it.
  it("keeps the group of the FIRST tab, the one windows.create moves", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/one", pinned: false, windowId: 1, groupId: 60, index: 0, active: true },
      { id: 2, url: "https://a.com/two", pinned: false, windowId: 1, groupId: 60, index: 1 },
      { id: 3, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 2 },
    ];
    stub.groups = [{ id: 60, title: "Docs", color: "green", windowId: 1 }];

    expect(await isolateDomain()).toBe(2);
    expect(groupOf(1)).not.toBe(-1);
    expect(groupOf(1)).toBe(groupOf(2));
    expect(stub.groupUpdates).toEqual([
      expect.objectContaining({ title: "Docs", color: "green" }),
    ]);
  });
});

describe("splitByDomain", () => {
  it("preserves groups in each new window", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/one", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com/two", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 3, url: "https://b.com/one", pinned: false, windowId: 1, groupId: 70, index: 2 },
      { id: 4, url: "https://b.com/two", pinned: false, windowId: 1, groupId: 70, index: 3 },
    ];
    stub.groups = [{ id: 70, title: "Reading", color: "pink", windowId: 1 }];

    expect(await splitByDomain()).toBe(1);
    expect(groupOf(3)).not.toBe(-1);
    expect(groupOf(3)).toBe(groupOf(4));
    expect(stub.groupUpdates).toEqual([
      expect.objectContaining({ title: "Reading", color: "pink" }),
    ]);
  });
});
