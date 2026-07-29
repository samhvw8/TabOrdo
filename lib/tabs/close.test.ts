import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { popUndo, peekUndo } from "../undo.ts";
import {
  closeTabsToLeft,
  closeTabsToRight,
  closeTabsSameSite,
  closeOldTabs,
} from "./close.ts";

// These five close or reorder the user's tabs with no confirmation step in front of them, so
// "which tabs does it touch" is the assertion that matters most in the codebase. Every one of
// them was previously uncovered.

let stub: ChromeStub;

beforeEach(async () => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }, { id: 2 }];
  while (await popUndo()) {
    /* drain the module-level undo stack between tests */
  }
});

const openIds = () => stub.openTabs.map((t) => t.id).sort((a, b) => a - b);

/** URLs recorded in the top undo entry, so we can prove the snapshot precedes the removal. */
function snapshotUrls(): string[] {
  const entry = peekUndo();
  if (!entry || entry.type !== "close") return [];
  return (entry.data as { url: string }[]).map((d) => d.url);
}

describe("closeTabsToLeft / closeTabsToRight", () => {
  beforeEach(() => {
    stub.openTabs = [
      { id: 1, url: "https://pin.com", pinned: true, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://left.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 3, url: "https://here.com", pinned: false, windowId: 1, groupId: -1, index: 2, active: true },
      { id: 4, url: "https://right.com", pinned: false, windowId: 1, groupId: -1, index: 3 },
      { id: 5, url: "https://other-window.com", pinned: false, windowId: 2, groupId: -1, index: 0 },
    ];
  });

  it("closes only unpinned tabs left of the active tab", async () => {
    expect(await closeTabsToLeft()).toBe(1);
    expect(stub.removedIds).toEqual([2]);
    expect(openIds()).toEqual([1, 3, 4, 5]);
  });

  it("closes only unpinned tabs right of the active tab", async () => {
    expect(await closeTabsToRight()).toBe(1);
    expect(stub.removedIds).toEqual([4]);
    expect(openIds()).toEqual([1, 2, 3, 5]);
  });

  it("never reaches into another window", async () => {
    await closeTabsToRight();
    expect(stub.removedIds).not.toContain(5);
  });

  it("snapshots the closed tabs for undo before removing them", async () => {
    await closeTabsToLeft();
    expect(snapshotUrls()).toEqual(["https://left.com"]);
  });

  it("is a no-op when the window has no active tab", async () => {
    for (const t of stub.openTabs) t.active = false;
    expect(await closeTabsToLeft()).toBe(0);
    expect(stub.removedIds).toEqual([]);
  });

  it("records no undo entry when nothing matched", async () => {
    // Active tab is leftmost unpinned, so there is nothing to its left.
    stub.openTabs = [
      { id: 1, url: "https://here.com", pinned: false, windowId: 1, groupId: -1, index: 0, active: true },
      { id: 2, url: "https://right.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
    ];
    expect(await closeTabsToLeft()).toBe(0);
    expect(peekUndo()).toBeNull();
  });
});

describe("closeTabsSameSite", () => {
  beforeEach(() => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/here", pinned: false, windowId: 1, groupId: -1, index: 0, active: true },
      { id: 2, url: "https://a.com/other", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 3, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 2 },
      { id: 4, url: "https://a.com/pinned", pinned: true, windowId: 1, groupId: -1, index: 3 },
      { id: 5, url: "https://a.com/elsewhere", pinned: false, windowId: 2, groupId: -1, index: 0 },
    ];
  });

  it("closes same-domain tabs across every window but keeps the active tab", async () => {
    expect(await closeTabsSameSite()).toBe(2);
    expect(stub.removedIds.sort()).toEqual([2, 5]);
    expect(openIds()).toEqual([1, 3, 4]);
  });

  it("spares pinned tabs on the same domain", async () => {
    await closeTabsSameSite();
    expect(stub.removedIds).not.toContain(4);
  });

  it("treats subdomains as the same site", async () => {
    stub.openTabs.push({
      id: 6, url: "https://docs.a.com/x", pinned: false, windowId: 1, groupId: -1, index: 4,
    });
    await closeTabsSameSite();
    expect(stub.removedIds).toContain(6);
  });

  it("is a no-op when the active tab has no URL", async () => {
    stub.openTabs[0].url = undefined;
    expect(await closeTabsSameSite()).toBe(0);
    expect(stub.removedIds).toEqual([]);
  });

  it("snapshots for undo", async () => {
    await closeTabsSameSite();
    expect(snapshotUrls().sort()).toEqual(["https://a.com/elsewhere", "https://a.com/other"]);
  });
});

describe("closeOldTabs", () => {
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    const now = Date.now();
    stub.openTabs = [
      { id: 1, url: "https://fresh.com", pinned: false, windowId: 1, groupId: -1, index: 0, lastAccessed: now - DAY },
      { id: 2, url: "https://stale.com", pinned: false, windowId: 1, groupId: -1, index: 1, lastAccessed: now - 30 * DAY },
      { id: 3, url: "https://stale-pinned.com", pinned: true, windowId: 1, groupId: -1, index: 2, lastAccessed: now - 30 * DAY },
      { id: 4, url: "https://stale-active.com", pinned: false, windowId: 1, groupId: -1, index: 3, active: true, lastAccessed: now - 30 * DAY },
      { id: 5, url: "https://stale-elsewhere.com", pinned: false, windowId: 2, groupId: -1, index: 0, lastAccessed: now - 30 * DAY },
    ];
  });

  it("closes tabs older than the default 7 days, across windows", async () => {
    expect(await closeOldTabs()).toBe(2);
    expect(stub.removedIds.sort()).toEqual([2, 5]);
  });

  it("spares pinned and active tabs however stale they are", async () => {
    await closeOldTabs();
    expect(stub.removedIds).not.toContain(3);
    expect(stub.removedIds).not.toContain(4);
  });

  it("honours a custom age threshold", async () => {
    expect(await closeOldTabs(60)).toBe(0);
    expect(stub.removedIds).toEqual([]);
  });

  // A tab Chrome never reported a lastAccessed for reads as epoch 0, i.e. infinitely old.
  it("closes tabs with no lastAccessed at all", async () => {
    stub.openTabs = [
      { id: 9, url: "https://unknown.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
    ];
    expect(await closeOldTabs()).toBe(1);
    expect(stub.removedIds).toEqual([9]);
  });

  it("snapshots for undo", async () => {
    await closeOldTabs();
    expect(snapshotUrls().sort()).toEqual(["https://stale-elsewhere.com", "https://stale.com"]);
  });
});
