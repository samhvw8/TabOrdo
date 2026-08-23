import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { getAllTabs, getCurrentWindowTabs, getAllGroups, switchToTab, closeTabs } from "./query.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }, { id: 2 }];
  stub.openTabs = [
    { id: 1, url: "https://a.com", title: "A", pinned: true, windowId: 1, groupId: -1, index: 0, active: true },
    { id: 2, url: "https://b.com", title: "B", pinned: false, windowId: 1, groupId: 50, index: 1 },
    { id: 3, url: "https://c.com", title: "C", pinned: false, windowId: 2, groupId: -1, index: 0 },
  ];
  stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
});

describe("getAllTabs", () => {
  it("returns every tab across every window", async () => {
    expect((await getAllTabs()).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  // The join is the whole point of this function: the palette shows and searches group titles,
  // and chrome.tabs.query only hands back a numeric groupId.
  it("joins each tab to its group's title and colour", async () => {
    const byId = new Map((await getAllTabs()).map((t) => [t.id, t]));
    expect(byId.get(2)).toMatchObject({ groupId: 50, groupTitle: "Work", groupColor: "blue" });
  });

  it("leaves group fields undefined for an ungrouped tab", async () => {
    const t = (await getAllTabs()).find((x) => x.id === 1)!;
    expect(t.groupTitle).toBeUndefined();
    expect(t.groupColor).toBeUndefined();
  });

  it("carries the flags the triage views filter on", async () => {
    const t = (await getAllTabs()).find((x) => x.id === 1)!;
    expect(t).toMatchObject({ pinned: true, active: true, windowId: 1, url: "https://a.com", title: "A" });
  });

  // Chrome omits title/url on tabs that have not finished loading; the search haystack indexes
  // these directly, and undefined would poison it.
  it("substitutes empty strings for a missing title or url", async () => {
    stub.openTabs = [{ id: 9, pinned: false, windowId: 1, groupId: -1, index: 0 }];
    const [t] = await getAllTabs();
    expect(t.title).toBe("");
    expect(t.url).toBe("");
  });

  it("survives a group id that no longer has a group", async () => {
    stub.groups = [];
    const t = (await getAllTabs()).find((x) => x.id === 2)!;
    expect(t.groupId).toBe(50);
    expect(t.groupTitle).toBeUndefined();
  });
});

describe("getCurrentWindowTabs", () => {
  it("keeps only the current window", async () => {
    expect((await getCurrentWindowTabs()).map((t) => t.id)).toEqual([1, 2]);
  });

  it("follows the current window when it changes", async () => {
    stub.currentWindowId = 2;
    expect((await getCurrentWindowTabs()).map((t) => t.id)).toEqual([3]);
  });
});

describe("getAllGroups", () => {
  it("returns every group, across windows", async () => {
    stub.groups.push({ id: 60, title: "Other", color: "red", windowId: 2 });
    expect((await getAllGroups()).map((g) => g.id)).toEqual([50, 60]);
  });
});

describe("switchToTab", () => {
  it("activates the tab and focuses its window", async () => {
    await switchToTab(3);
    expect(stub.openTabs.find((t) => t.id === 3)!.active).toBe(true);
  });

  it("does not throw on a tab that has already gone", async () => {
    await expect(switchToTab(999)).resolves.toBeUndefined();
  });
});

describe("closeTabs", () => {
  it("removes exactly the ids it was given", async () => {
    await closeTabs([1, 3]);
    expect(stub.removedIds).toEqual([1, 3]);
    expect(stub.openTabs.map((t) => t.id)).toEqual([2]);
  });

  it("is a no-op for an empty list", async () => {
    await closeTabs([]);
    expect(stub.openTabs).toHaveLength(3);
  });

  // chrome.tabs.remove(array) rejects the whole call on the first id that has already gone,
  // so one stale entry in the popup's list used to leave every other matched tab open.
  it("closes the live tabs even when one id is already gone", async () => {
    const realRemove = chrome.tabs.remove;
    (chrome.tabs as unknown as { remove: (ids: number | number[]) => Promise<void> }).remove =
      async (ids) => {
        const arr = Array.isArray(ids) ? ids : [ids];
        if (arr.includes(999)) throw new Error("No tab with id: 999");
        return realRemove(ids as number[]);
      };

    await expect(closeTabs([1, 999, 3])).resolves.toBe(2);
    expect(stub.removedIds).toEqual([1, 3]);
    expect(stub.openTabs.map((t) => t.id)).toEqual([2]);
  });
});
