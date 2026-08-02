import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { pushUndo, peekUndo, popUndo, undoStackSize, loadUndoStack, snapshotBeforeClose, snapshotClosedTabs, snapshotBeforeGroup, executeUndo } from "./undo.ts";

let stub: ChromeStub;

const entry = (type: string, data: unknown = []) => ({ type, label: type, timestamp: 1, data });

beforeEach(async () => {
  stub = installChromeStub();
  // Drain the module-level stack between tests
  while (await popUndo()) {
    /* empty */
  }
});

describe("undo stack", () => {
  it("push / peek / pop / size", async () => {
    expect(undoStackSize()).toBe(0);
    await pushUndo(entry("close"));
    await pushUndo(entry("group"));
    expect(undoStackSize()).toBe(2);
    expect(peekUndo()?.type).toBe("group");
    expect((await popUndo())?.type).toBe("group");
    expect((await popUndo())?.type).toBe("close");
    expect(await popUndo()).toBeNull();
  });

  it("caps at 20 entries, dropping the oldest", async () => {
    for (let i = 0; i < 25; i++) await pushUndo(entry("close", i));
    expect(undoStackSize()).toBe(20);
    expect(peekUndo()?.data).toBe(24);
    let bottom = null;
    let e;
    while ((e = await popUndo())) bottom = e;
    expect(bottom?.data).toBe(5);
  });

  it("persists to session storage and loads back", async () => {
    await pushUndo(entry("close", "x"));
    expect(stub.sessionData["tabOrdo_undoStack"]).toHaveLength(1);
    while (await popUndo()) {
      /* empty */
    }
    stub.sessionData["tabOrdo_undoStack"] = [entry("group", "y")];
    await loadUndoStack();
    expect(undoStackSize()).toBe(1);
    expect(peekUndo()?.data).toBe("y");
  });
});

describe("cross-realm stack", () => {
  it("picks up entries another surface persisted before pushing", async () => {
    await pushUndo(entry("close", "mine"));
    // The side panel is the same component in a second realm, with its own module-level
    // mirror but the same session storage behind it.
    stub.sessionData["tabOrdo_undoStack"] = [entry("close", "mine"), entry("group", "theirs")];
    await pushUndo(entry("close", "later"));
    const persisted = stub.sessionData["tabOrdo_undoStack"] as { data: unknown }[];
    expect(persisted.map((e) => e.data)).toEqual(["mine", "theirs", "later"]);
  });
});

describe("executeUndo — close", () => {
  it("returns a message when there is nothing to undo", async () => {
    expect(await executeUndo()).toBe("Nothing to undo");
  });

  it("reopens closed tabs pinned-state intact, inactive, skipping newtab and empty urls", async () => {
    // Window 1 is still open; window 2 is gone.
    stub.windows = [{ id: 1 }];
    await snapshotClosedTabs([
      { url: "https://a.com", pinned: true, windowId: 1 },
      { url: "chrome://newtab/", pinned: false, windowId: 1 },
      { url: "", pinned: false, windowId: 1 },
      { url: "https://b.com", pinned: false, windowId: 2 },
    ] as chrome.tabs.Tab[]);

    const msg = await executeUndo();
    expect(msg).toBe("Reopened 2 tab(s)");
    expect(stub.created).toEqual([
      // restored into its original window, which still exists...
      { url: "https://a.com", pinned: true, active: false, windowId: 1 },
      // ...while a tab whose window is gone falls back to the focused one
      { url: "https://b.com", pinned: false, active: false },
    ]);
    expect(undoStackSize()).toBe(0);
  });

  it("returns a message for unknown entry types", async () => {
    await pushUndo(entry("mystery"));
    expect(await executeUndo()).toBe("Unknown undo type");
  });

  // The snapshot recorded url/pinned/window only, so an undone close came back at the end of
  // the strip and outside its group — the tab was reopened, its place was not.
  it("puts a restored tab back at its index and into the group it was closed from", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 7, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: 7, index: 1 },
      { id: 3, url: "https://c.com", pinned: false, windowId: 1, groupId: -1, index: 2 },
    ];
    stub.groups = [{ id: 7, title: "Work", color: "blue", windowId: 1 }];

    await snapshotBeforeClose([2]);
    await chrome.tabs.remove(2);

    expect(await executeUndo()).toBe("Reopened 1 tab(s)");
    expect(stub.created).toEqual([
      { url: "https://b.com", pinned: false, active: false, windowId: 1, index: 1 },
    ]);
    // The group survived the close, so the tab rejoins it rather than getting a second
    // "Work" group built beside it.
    const restored = stub.openTabs.find((t) => t.url === "https://b.com")!;
    expect(restored.groupId).toBe(7);
    expect(stub.groups).toHaveLength(1);
  });

  it("rebuilds the group when closing the tab took the whole group with it", async () => {
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 7, index: 0 }];
    stub.groups = [{ id: 7, title: "Work", color: "blue", windowId: 1 }];

    await snapshotBeforeClose([1]);
    await chrome.tabs.remove(1);
    stub.groups = []; // Chrome drops a group once its last tab closes

    expect(await executeUndo()).toBe("Reopened 1 tab(s)");
    const restored = stub.openTabs.find((t) => t.url === "https://a.com")!;
    expect(restored.groupId).not.toBe(-1);
    expect(stub.groupUpdates).toEqual([expect.objectContaining({ title: "Work", color: "blue" })]);
  });

  it("leaves an ungrouped tab ungrouped", async () => {
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 0 }];
    await snapshotBeforeClose([1]);
    await chrome.tabs.remove(1);

    await executeUndo();
    expect(stub.openTabs.find((t) => t.url === "https://a.com")!.groupId).toBe(-1);
    expect(stub.groupUpdates).toEqual([]);
  });
});

describe("pushUndo durability", () => {
  // The write was fire-and-forget behind a bare catch, so a rejected session write left the
  // caller closing tabs it had no snapshot for.
  it("rejects when the stack cannot be persisted", async () => {
    stub.failWrites = true;
    await expect(pushUndo(entry("close", "x"))).rejects.toThrow();
  });

  // syncFromStorage rewrites the shared module-level array, so two unserialized pushes each
  // reloaded the same pre-write state and the first entry vanished.
  it("does not drop an entry when two pushes overlap", async () => {
    stub.sessionData["tabOrdo_undoStack"] = [entry("close", "theirs")];
    await Promise.all([pushUndo(entry("close", "a")), pushUndo(entry("close", "b"))]);
    const persisted = stub.sessionData["tabOrdo_undoStack"] as { data: unknown }[];
    expect(persisted.map((e) => e.data)).toEqual(["theirs", "a", "b"]);
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

  it("moves tabs back to their snapshotted window before regrouping", async () => {
    stub.windows = [{ id: 1 }, { id: 2 }];
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 2, groupId: -1, index: 0 },
    ];
    await snapshotBeforeGroup();

    // What /aigroup does: consolidate across windows, then group.
    stub.openTabs[1].windowId = 1;
    stub.openTabs[1].index = 1;
    stub.openTabs[0].groupId = 5;
    stub.openTabs[1].groupId = 5;

    await executeUndo();
    expect(stub.moves).toEqual([expect.objectContaining({ ids: [2], windowId: 2 })]);
    expect(stub.openTabs.find((t) => t.id === 2)?.windowId).toBe(2);
  });

  it("leaves tabs alone when the snapshotted window is gone", async () => {
    stub.windows = [{ id: 1 }, { id: 2 }];
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 2, groupId: -1, index: 0 }];
    await snapshotBeforeGroup();

    stub.openTabs[0].windowId = 1;
    stub.windows = [{ id: 1 }]; // window 2 closed since the snapshot
    await executeUndo();
    expect(stub.moves).toEqual([]);
  });

  it("leaves tabs grouped after the snapshot alone", async () => {
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 7, index: 0 }];
    stub.groups = [{ id: 7, title: "Work", color: "blue", windowId: 1 }];
    await snapshotBeforeGroup();

    stub.openTabs[0].groupId = -1;
    // Opened and grouped by the user after the snapshot — outside this undo's scope.
    stub.openTabs.push({ id: 2, url: "https://new.com", pinned: false, windowId: 1, groupId: 12, index: 1 });
    stub.groups.push({ id: 12, title: "Later", color: "red", windowId: 1 });

    await executeUndo();
    expect(stub.ungroupedIds).not.toContain(2);
    expect(stub.openTabs.find((t) => t.id === 2)?.groupId).toBe(12);
  });

  it("keeps same-titled groups from different windows apart", async () => {
    stub.windows = [{ id: 1 }, { id: 2 }];
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 7, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 2, groupId: 8, index: 0 },
    ];
    stub.groups = [
      { id: 7, title: "Work", color: "blue", windowId: 1 },
      { id: 8, title: "Work", color: "blue", windowId: 2 },
    ];
    await snapshotBeforeGroup();

    // Something consolidated both into one group in window 1.
    stub.openTabs[1].windowId = 1;
    stub.openTabs[1].index = 1;
    stub.openTabs[0].groupId = 9;
    stub.openTabs[1].groupId = 9;

    const msg = await executeUndo();
    expect(msg).toBe("Restored previous group state");
    const t1 = stub.openTabs.find((t) => t.id === 1)!;
    const t2 = stub.openTabs.find((t) => t.id === 2)!;
    expect(t2.windowId).toBe(2);
    expect(t1.groupId).not.toBe(t2.groupId);
  });

  it("reports groups it could not rebuild instead of aborting the restore", async () => {
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: 7, index: 0 }];
    stub.groups = [{ id: 7, title: "Work", color: "blue", windowId: 1 }];
    await snapshotBeforeGroup();

    stub.openTabs[0].groupId = -1;
    stub.failGroup = true;
    expect(await executeUndo()).toBe("Restored previous group state — 1 group(s) could not be rebuilt");
  });

  it("does not relocate for legacy entries that recorded no window", async () => {
    stub.windows = [{ id: 1 }, { id: 2 }];
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 2, groupId: -1, index: 0 }];
    await pushUndo({ type: "group", label: "Group change", timestamp: 1, data: [{ tabId: 1, groupId: -1 }] });

    await executeUndo();
    expect(stub.moves).toEqual([]);
  });
});
