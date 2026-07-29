import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { shuffleTabs, moveCurrentTab, moveGroup } from "./order.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }, { id: 2 }];
});

const openIds = () => stub.openTabs.map((t) => t.id).sort((a, b) => a - b);

/** Ids of window 1 in strip order. */
const strip = (windowId = 1) =>
  stub.openTabs.filter((t) => t.windowId === windowId).sort((a, b) => a.index! - b.index!).map((t) => t.id);

describe("shuffleTabs", () => {
  beforeEach(() => {
    stub.openTabs = [
      { id: 1, url: "https://pin.com", pinned: true, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 3, url: "https://c.com", pinned: false, windowId: 1, groupId: -1, index: 2 },
      { id: 4, url: "https://d.com", pinned: false, windowId: 1, groupId: -1, index: 3 },
      { id: 5, url: "https://other.com", pinned: false, windowId: 2, groupId: -1, index: 0 },
    ];
  });

  it("closes nothing and loses no tabs", async () => {
    await shuffleTabs();
    expect(stub.removedIds).toEqual([]);
    expect(openIds()).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves the pinned tab at the head of the strip", async () => {
    await shuffleTabs();
    const win1 = stub.openTabs.filter((t) => t.windowId === 1).sort((a, b) => a.index! - b.index!);
    expect(win1[0].id).toBe(1);
    expect(win1.map((t) => t.id).slice(1).sort()).toEqual([2, 3, 4]);
  });

  it("does not touch other windows", async () => {
    await shuffleTabs();
    expect(stub.openTabs.find((t) => t.id === 5)!.windowId).toBe(2);
  });

  // Regression guard for the batching fix: this used to be one move call per tab.
  it("reorders in a single tabs.move call", async () => {
    await shuffleTabs();
    expect(stub.moves).toHaveLength(1);
    expect(stub.moves[0].ids.sort()).toEqual([2, 3, 4]);
  });
});

describe("moveCurrentTab", () => {
  it("rejects a position it cannot parse", async () => {
    for (const bad of ["", "abc", "0", "-3"]) {
      expect(await moveCurrentTab(bad)).toBe("Usage: /move ^|$|<number>");
    }
    expect(stub.moves).toEqual([]);
  });

  it("reports when there is no active tab", async () => {
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 0 }];
    expect(await moveCurrentTab("^")).toBe("No active tab");
  });

  describe("an ungrouped tab moves within the ungrouped run", () => {
    beforeEach(() => {
      stub.openTabs = [
        { id: 1, url: "https://pin.com", pinned: true, windowId: 1, groupId: -1, index: 0 },
        { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
        { id: 3, url: "https://c.com", pinned: false, windowId: 1, groupId: -1, index: 2 },
        { id: 4, url: "https://d.com", pinned: false, windowId: 1, groupId: -1, index: 3, active: true },
      ];
    });

    // "first" means first *after* the pinned tabs — Chrome will not let anything precede them.
    it("^ lands after the pinned tabs, not at index 0", async () => {
      expect(await moveCurrentTab("^")).toBe("Moved tab to position first");
      expect(strip()).toEqual([1, 4, 2, 3]);
    });

    it("$ lands at the end", async () => {
      stub.openTabs[3].active = false;
      stub.openTabs[1].active = true;
      expect(await moveCurrentTab("$")).toBe("Moved tab to position last");
      expect(strip()).toEqual([1, 3, 4, 2]);
    });

    it("a number is 1-based and offset past the pinned tabs", async () => {
      expect(await moveCurrentTab("1")).toBe("Moved tab to position 1");
      expect(strip()).toEqual([1, 4, 2, 3]);
    });

    it("clamps a number past the end instead of failing", async () => {
      expect(await moveCurrentTab("99")).toBe("Moved tab to position 99");
      expect(strip()).toEqual([1, 2, 3, 4]);
    });
  });

  describe("a grouped tab moves within its own group", () => {
    beforeEach(() => {
      stub.openTabs = [
        { id: 1, url: "https://pin.com", pinned: true, windowId: 1, groupId: -1, index: 0 },
        { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: 50, index: 1 },
        { id: 3, url: "https://c.com", pinned: false, windowId: 1, groupId: 50, index: 2 },
        { id: 4, url: "https://d.com", pinned: false, windowId: 1, groupId: 50, index: 3, active: true },
        { id: 5, url: "https://e.com", pinned: false, windowId: 1, groupId: -1, index: 4 },
      ];
      stub.groups = [{ id: 50, title: "Work", color: "blue", windowId: 1 }];
    });

    it("^ is the head of the group, not the head of the window", async () => {
      expect(await moveCurrentTab("^")).toBe("Moved to position first in group");
      expect(strip()).toEqual([1, 4, 2, 3, 5]);
    });

    it("$ is the tail of the group, not the tail of the window", async () => {
      stub.openTabs[3].active = false;
      stub.openTabs[1].active = true;
      expect(await moveCurrentTab("$")).toBe("Moved to position last in group");
      expect(strip()).toEqual([1, 3, 4, 2, 5]);
    });

    // Clamping to maxIdx is what stops /move 99 from ejecting the tab out of its group.
    it("clamps a large number to the end of the group", async () => {
      stub.openTabs[3].active = false;
      stub.openTabs[1].active = true;
      await moveCurrentTab("99");
      expect(strip()).toEqual([1, 3, 4, 2, 5]);
    });
  });
});

describe("moveGroup", () => {
  beforeEach(() => {
    stub.openTabs = [
      { id: 1, url: "https://pin.com", pinned: true, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a1.com", pinned: false, windowId: 1, groupId: 50, index: 1 },
      { id: 3, url: "https://a2.com", pinned: false, windowId: 1, groupId: 50, index: 2 },
      { id: 4, url: "https://b1.com", pinned: false, windowId: 1, groupId: 60, index: 3, active: true },
      { id: 5, url: "https://b2.com", pinned: false, windowId: 1, groupId: 60, index: 4 },
    ];
    stub.groups = [
      { id: 50, title: "Alpha", color: "blue", windowId: 1 },
      { id: 60, title: "Beta", color: "green", windowId: 1 },
    ];
  });

  it("rejects a position it cannot parse", async () => {
    expect(await moveGroup("nope")).toBe("Usage: /movegroup ^|$|<number>");
    expect(stub.moves).toEqual([]);
  });

  it("reports when the active tab is not in a group", async () => {
    stub.openTabs[3].active = false;
    stub.openTabs[0].active = true;
    expect(await moveGroup("^")).toBe("Active tab is not in a group");
  });

  it("^ moves the whole group to the front, after the pinned tabs", async () => {
    expect(await moveGroup("^")).toBe("Moved group to position first");
    expect(strip()).toEqual([1, 4, 5, 2, 3]);
  });

  it("$ moves the whole group to the end", async () => {
    stub.openTabs[3].active = false;
    stub.openTabs[1].active = true;
    expect(await moveGroup("$")).toBe("Moved group to position last");
    expect(strip()).toEqual([1, 4, 5, 2, 3]);
  });

  it("keeps the group intact rather than scattering its tabs", async () => {
    await moveGroup("^");
    const g = stub.openTabs.filter((t) => t.groupId === 60).map((t) => t.index).sort();
    expect(g).toEqual([1, 2]);
  });
});
