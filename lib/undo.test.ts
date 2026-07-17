import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { pushUndo, peekUndo, popUndo, undoStackSize, loadUndoStack, snapshotClosedTabs, snapshotBeforeGroup, executeUndo } from "./undo.ts";

let stub: ChromeStub;

const entry = (type: string, data: unknown = []) => ({ type, label: type, timestamp: 1, data });

beforeEach(() => {
  stub = installChromeStub();
  // Drain the module-level stack between tests
  while (popUndo()) {
    /* empty */
  }
});

describe("undo stack", () => {
  it("push / peek / pop / size", () => {
    expect(undoStackSize()).toBe(0);
    pushUndo(entry("close"));
    pushUndo(entry("group"));
    expect(undoStackSize()).toBe(2);
    expect(peekUndo()?.type).toBe("group");
    expect(popUndo()?.type).toBe("group");
    expect(popUndo()?.type).toBe("close");
    expect(popUndo()).toBeNull();
  });

  it("caps at 20 entries, dropping the oldest", () => {
    for (let i = 0; i < 25; i++) pushUndo(entry("close", i));
    expect(undoStackSize()).toBe(20);
    expect(peekUndo()?.data).toBe(24);
    let bottom = null;
    let e;
    while ((e = popUndo())) bottom = e;
    expect(bottom?.data).toBe(5);
  });

  it("persists to session storage and loads back", async () => {
    pushUndo(entry("close", "x"));
    expect(stub.sessionData["tabOrdo_undoStack"]).toHaveLength(1);
    while (popUndo()) {
      /* empty */
    }
    stub.sessionData["tabOrdo_undoStack"] = [entry("group", "y")];
    await loadUndoStack();
    expect(undoStackSize()).toBe(1);
    expect(peekUndo()?.data).toBe("y");
  });
});

describe("executeUndo — close", () => {
  it("returns a message when there is nothing to undo", async () => {
    expect(await executeUndo()).toBe("Nothing to undo");
  });

  it("reopens closed tabs pinned-state intact, inactive, skipping newtab and empty urls", async () => {
    snapshotClosedTabs([
      { url: "https://a.com", pinned: true, windowId: 1 },
      { url: "chrome://newtab/", pinned: false, windowId: 1 },
      { url: "", pinned: false, windowId: 1 },
      { url: "https://b.com", pinned: false, windowId: 2 },
    ] as chrome.tabs.Tab[]);

    const msg = await executeUndo();
    expect(msg).toBe("Reopened 2 tab(s)");
    expect(stub.created).toEqual([
      { url: "https://a.com", pinned: true, active: false },
      { url: "https://b.com", pinned: false, active: false },
    ]);
    expect(undoStackSize()).toBe(0);
  });

  it("returns a message for unknown entry types", async () => {
    pushUndo(entry("mystery"));
    expect(await executeUndo()).toBe("Unknown undo type");
  });
});

describe("executeUndo — group", () => {
  it("restores the snapshotted group layout: ungroups current, regroups per snapshot", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 7 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: -1 },
      { id: 3, url: "https://c.com", pinned: false, windowId: 1, groupId: -1 },
    ];
    stub.groups = [{ id: 7, title: "Work", color: "blue" }];
    await snapshotBeforeGroup();

    // Simulate a grouping action that changed everything
    stub.openTabs[0].groupId = -1;
    stub.openTabs[1].groupId = 9;
    stub.openTabs[2].groupId = 9;

    const msg = await executeUndo();
    expect(msg).toBe("Restored previous group state");
    // tabs 2 and 3 were grouped at undo time -> ungrouped first
    expect(stub.ungroupedIds).toEqual([2, 3]);
    // tab 1 goes back into a "Work"/blue group
    expect(stub.openTabs[0].groupId).not.toBe(-1);
    expect(stub.groupUpdates).toEqual([expect.objectContaining({ title: "Work", color: "blue" })]);
    // tabs 2 and 3 were ungrouped in the snapshot -> stay ungrouped
    expect(stub.openTabs[1].groupId).toBe(-1);
    expect(stub.openTabs[2].groupId).toBe(-1);
  });

  it("skips snapshotted tabs that no longer exist", async () => {
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 7 }];
    stub.groups = [{ id: 7, title: "Work", color: "blue" }];
    await snapshotBeforeGroup();

    stub.openTabs = []; // every tab closed since the snapshot
    const msg = await executeUndo();
    expect(msg).toBe("Restored previous group state");
    expect(stub.groupUpdates).toEqual([]);
  });

  it("merges snapshot groups sharing title and color into one group (current behavior)", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 7 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: 8 },
    ];
    stub.groups = [
      { id: 7, title: "Work", color: "blue" },
      { id: 8, title: "Work", color: "blue" },
    ];
    await snapshotBeforeGroup();

    stub.openTabs[0].groupId = -1;
    stub.openTabs[1].groupId = -1;
    await executeUndo();
    // Both land in the same group because the snapshot keys on title:color
    expect(stub.openTabs[0].groupId).toBe(stub.openTabs[1].groupId);
  });
});
