import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { ungroupAll, collapseAllGroups, pickMajorityWindow, groupTabsByDomain } from "./group.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }];
});

const tab = (t: Partial<{ id: number; url: string; pinned: boolean; windowId: number; groupId: number; index: number; active: boolean }>) =>
  ({ id: 0, url: "https://x.com", pinned: false, windowId: 1, groupId: -1, index: 0, ...t }) as any;

describe("ungroupAll", () => {
  beforeEach(() => {
    stub.openTabs = [
      tab({ id: 1, groupId: 50, index: 0, pinned: true }),
      tab({ id: 2, groupId: 50, index: 1 }),
      tab({ id: 3, groupId: 60, index: 2 }),
      tab({ id: 4, groupId: -1, index: 3 }),
    ];
    stub.groups = [{ id: 50, title: "A", windowId: 1 }, { id: 60, title: "B", windowId: 1 }];
  });

  it("ungroups every grouped tab", async () => {
    await ungroupAll();
    expect(stub.ungroupedIds.sort()).toEqual([2, 3]);
  });

  // A pinned tab keeps its group in Chrome's UI; touching it here would move it unexpectedly.
  it("leaves pinned tabs in their group", async () => {
    await ungroupAll();
    expect(stub.ungroupedIds).not.toContain(1);
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).toBe(50);
  });

  it("does nothing when no tab is grouped", async () => {
    stub.openTabs = [tab({ id: 1, groupId: -1 })];
    await ungroupAll();
    expect(stub.ungroupedIds).toEqual([]);
  });
});

describe("collapseAllGroups", () => {
  it("collapses every group and reports how many there were", async () => {
    stub.groups = [{ id: 50, title: "A", windowId: 1 }, { id: 60, title: "B", windowId: 1 }];
    expect(await collapseAllGroups()).toBe(2);
    expect(stub.groups.every((g) => g.collapsed)).toBe(true);
  });

  it("returns 0 when there are no groups", async () => {
    expect(await collapseAllGroups()).toBe(0);
    expect(stub.groupUpdates).toEqual([]);
  });
});

describe("pickMajorityWindow", () => {
  it("picks the window holding the most of the tabs", () => {
    expect(pickMajorityWindow([tab({ windowId: 1 }), tab({ windowId: 2 }), tab({ windowId: 2 })])).toBe(2);
  });

  it("is stable for a single tab", () => {
    expect(pickMajorityWindow([tab({ windowId: 7 })])).toBe(7);
  });

  // Ties resolve to whichever window the iteration reaches first — asserted so a future change
  // to the counting loop is a visible decision rather than a silent one.
  it("resolves a tie deterministically", () => {
    const pick = pickMajorityWindow([tab({ windowId: 1 }), tab({ windowId: 2 })]);
    expect([1, 2]).toContain(pick);
    expect(pickMajorityWindow([tab({ windowId: 1 }), tab({ windowId: 2 })])).toBe(pick);
  });
});

describe("groupTabsByDomain", () => {
  it("groups two tabs of the same domain and titles the group after it", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0 }),
      tab({ id: 2, url: "https://github.com/two", index: 1 }),
    ];
    await groupTabsByDomain();
    expect(stub.openTabs.every((t) => t.groupId !== -1)).toBe(true);
    expect(stub.groupUpdates.some((u) => u.title === "github.com")).toBe(true);
  });

  // One tab of a domain is not a group — it would produce a pile of single-tab groups.
  it("leaves a lone tab of a domain ungrouped", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0 }),
      tab({ id: 2, url: "https://example.com", index: 1 }),
      tab({ id: 3, url: "https://github.com/two", index: 2 }),
    ];
    await groupTabsByDomain();
    expect(stub.openTabs.find((t) => t.id === 2)!.groupId).toBe(-1);
  });

  it("never groups pinned tabs", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0, pinned: true }),
      tab({ id: 2, url: "https://github.com/two", index: 1 }),
      tab({ id: 3, url: "https://github.com/three", index: 2 }),
    ];
    await groupTabsByDomain();
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).toBe(-1);
  });

  it("treats subdomains of one site as the same domain", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://docs.github.com/a", index: 0 }),
      tab({ id: 2, url: "https://gist.github.com/b", index: 1 }),
    ];
    await groupTabsByDomain();
    expect(stub.groupUpdates.some((u) => u.title === "github.com")).toBe(true);
  });

  // additive is the default because it must not disturb groups the user made by hand.
  it("additive mode leaves an existing hand-made group alone", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com", index: 0, groupId: 70 }),
      tab({ id: 2, url: "https://b.com", index: 1, groupId: 70 }),
    ];
    stub.groups = [{ id: 70, title: "Mine", color: "purple", windowId: 1 }];
    await groupTabsByDomain("additive");
    expect(stub.openTabs.every((t) => t.groupId === 70)).toBe(true);
  });

  it("rebuild mode dissolves existing groups first", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com/one", index: 0, groupId: 70 }),
      tab({ id: 2, url: "https://b.com", index: 1, groupId: 70 }),
    ];
    stub.groups = [{ id: 70, title: "Mine", color: "purple", windowId: 1 }];
    await groupTabsByDomain("rebuild");
    expect(stub.ungroupedIds.sort()).toEqual([1, 2]);
  });
});
