import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { pushUndo, peekUndo, peekUndoEntry, popUndo, undoStackSize, loadUndoStack, touchesUndoStack, snapshotBeforeClose, snapshotBeforeGroup, executeUndo } from "./undo.ts";

let stub: ChromeStub;

const entry = (type: string, data: unknown = []) => ({ type, label: type, timestamp: 1, data });

/** The side panel: the same component in a second realm, with its own module instance and
 *  mirror, over the same session storage. */
async function otherRealm(): Promise<typeof import("./undo.ts")> {
  vi.resetModules();
  return import("./undo.ts");
}

const entryKeys = () => Object.keys(stub.sessionData).filter((k) => k.startsWith("tabOrdo_undo:"));
const metaKeys = () => Object.keys(stub.sessionData).filter((k) => k.startsWith("tabOrdo_undoMeta:"));
/** Every snapshot-bearing key a storage read named since `from`. "*" is a whole-area get. */
const payloadReads = (from = 0) =>
  stub.storageReads.slice(from).flatMap((r) => r.keys).filter((k) => k === "*" || k.startsWith("tabOrdo_undo:"));

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
    expect(entryKeys()).toHaveLength(20);
    expect(metaKeys()).toHaveLength(20);
    expect((await peekUndoEntry())?.data).toBe(24);
    let bottom = null;
    let e;
    while ((e = await popUndo())) bottom = e;
    expect(bottom?.data).toBe(5);
    expect(Object.keys(stub.sessionData)).toEqual([]);
  });

  it("stores each entry under its own key, with its metadata beside it", async () => {
    await pushUndo({ type: "close", label: "Closed 1 tab(s)", timestamp: 42, data: ["x"] });
    expect(entryKeys()).toHaveLength(1);
    const id = entryKeys()[0].slice("tabOrdo_undo:".length);
    expect(stub.sessionData[`tabOrdo_undoMeta:${id}`]).toEqual({ type: "close", label: "Closed 1 tab(s)", timestamp: 42 });

    const panel = await otherRealm();
    await panel.loadUndoStack();
    expect(panel.undoStackSize()).toBe(1);
    expect(panel.peekUndo()).toEqual({ id, type: "close", label: "Closed 1 tab(s)", timestamp: 42 });
  });
});

// Stack order is key order, and ids lead with the push time. A realm always pushes above what it
// has seen; two surfaces' pushes are a user action apart, so tests model that with a clock step
// rather than letting a fresh realm share a millisecond with the other one's last push.
let clock = 0;
const tick = () => vi.setSystemTime(new Date(2_000_000_000_000 + ++clock * 1000));

describe("cross-realm stack", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pops entries another surface pushed, in the order they were pushed", async () => {
    const panel = await otherRealm();
    tick();
    await pushUndo(entry("close", "mine"));
    tick();
    await panel.pushUndo(entry("group", "theirs"));
    tick();
    await pushUndo(entry("close", "later"));
    expect(undoStackSize()).toBe(3);
    expect([(await popUndo())?.data, (await popUndo())?.data, (await popUndo())?.data]).toEqual(["later", "theirs", "mine"]);
  });

  // Each push is its own keys now, but eviction is a list-then-remove: two surfaces pushing onto
  // a stack one short of full both see 21 or 22 entries, and neither may take the other's.
  it("keeps both entries when two surfaces push onto a nearly full stack at once", async () => {
    const panel = await otherRealm();
    tick();
    for (let i = 0; i < 19; i++) await pushUndo(entry("close", i));
    tick();
    await Promise.all([pushUndo(entry("close", "popup")), panel.pushUndo(entry("close", "panel"))]);

    await loadUndoStack();
    expect(undoStackSize()).toBe(20);
    const popped: unknown[] = [];
    let e;
    while ((e = await popUndo())) popped.push(e.data);
    expect(popped.slice(0, 2).sort()).toEqual(["panel", "popup"]);
    expect(popped).not.toContain(0);
  });

  it("does not hand out an entry the other surface already popped", async () => {
    const panel = await otherRealm();
    await pushUndo(entry("close", "first"));
    await pushUndo(entry("close", "second"));
    expect((await panel.popUndo())?.data).toBe("second");
    expect((await popUndo())?.data).toBe("first");
    expect(await popUndo()).toBeNull();
  });

  it("recognises the keys a push or pop changes, and nothing else", () => {
    expect(touchesUndoStack({ "tabOrdo_undoMeta:0001-a": {} })).toBe(true);
    expect(touchesUndoStack({ tabOrdo_undoStack: {} })).toBe(true);
    expect(touchesUndoStack({ tabParents: {}, "bulkOpLock:x": {} })).toBe(false);
  });
});

// A group snapshot covers every unpinned tab. The whole stack used to be one array, so each push
// read and rewrote all twenty snapshots, and every popup open read them to light one button.
describe("storage cost", () => {
  const bigGroupEntry = (tag: number) =>
    entry("group", [...Array(300)].map((_, i) => ({ tabId: i, groupId: -1, windowId: 1, index: i, tag })));

  beforeEach(async () => {
    for (let i = 0; i < 20; i++) await pushUndo(bigGroupEntry(i));
  });

  it("a push onto a full stack reads no entry's snapshot", async () => {
    const from = stub.storageReads.length;
    await pushUndo(entry("close", "new"));
    expect(payloadReads(from)).toEqual([]);
    expect(undoStackSize()).toBe(20);
  });

  it("opening a surface reads metadata only", async () => {
    const panel = await otherRealm();
    const from = stub.storageReads.length;
    await panel.loadUndoStack();
    expect(payloadReads(from)).toEqual([]);
    expect(panel.undoStackSize()).toBe(20);
    expect(panel.peekUndo()?.type).toBe("group");
  });

  it("a pop reads the top snapshot and no other", async () => {
    const top = peekUndo()!;
    const from = stub.storageReads.length;
    await popUndo();
    expect(payloadReads(from)).toEqual([`tabOrdo_undo:${top.id}`]);
  });

  it("still works on a build without getKeys", async () => {
    const area = chrome.storage.session as unknown as { getKeys?: unknown };
    const saved = area.getKeys;
    delete area.getKeys; // Chrome < 130
    try {
      const panel = await otherRealm();
      await panel.loadUndoStack();
      expect(panel.undoStackSize()).toBe(20);
      await panel.pushUndo(entry("close", "old chrome"));
      expect(entryKeys()).toHaveLength(20);
      expect((await popUndo())?.data).toBe("old chrome");
    } finally {
      area.getKeys = saved;
    }
  });
});

// The layout before per-entry keys. Chrome clears the session area on an extension update, so
// this should never be found — but a stack left in it must not be lost or left behind.
describe("legacy single-array stack", () => {
  it("is moved onto per-entry keys under anything pushed since, and the old key removed", async () => {
    stub.sessionData.tabOrdo_undoStack = [entry("close", "old-1"), entry("group", "old-2")];
    await loadUndoStack();
    expect(stub.sessionData.tabOrdo_undoStack).toBeUndefined();
    expect(undoStackSize()).toBe(2);
    expect(peekUndo()?.type).toBe("group");

    await pushUndo(entry("close", "new"));
    const popped: unknown[] = [];
    let e;
    while ((e = await popUndo())) popped.push(e.data);
    expect(popped).toEqual(["new", "old-2", "old-1"]);
  });

  it("is found by a push as well as by a load", async () => {
    stub.sessionData.tabOrdo_undoStack = [entry("close", "old")];
    await pushUndo(entry("close", "new"));
    expect(stub.sessionData.tabOrdo_undoStack).toBeUndefined();
    expect(undoStackSize()).toBe(2);
  });
});

describe("executeUndo — close", () => {
  it("returns a message when there is nothing to undo", async () => {
    expect(await executeUndo()).toBe("Nothing to undo");
  });

  it("reopens closed tabs pinned-state intact, inactive, skipping newtab and empty urls", async () => {
    // Window 1 is still open; window 2 is gone.
    stub.windows = [{ id: 1 }];
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: true, windowId: 1, groupId: -1 },
      { id: 2, url: "chrome://newtab/", pinned: false, windowId: 1, groupId: -1 },
      { id: 3, url: "", pinned: false, windowId: 1, groupId: -1 },
      { id: 4, url: "https://b.com", pinned: false, windowId: 2, groupId: -1 },
    ];
    await snapshotBeforeClose([1, 2, 3, 4]);
    for (const id of [1, 2, 3, 4]) await chrome.tabs.remove(id);

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

  it("pushes nothing when none of the ids are open", async () => {
    stub.openTabs = [];
    await snapshotBeforeClose([7, 8]);
    expect(undoStackSize()).toBe(0);
  });

  // The snapshot is taken before the close and so can name a tab the close then failed to
  // remove. Reopening it put a second copy beside the one still open.
  it("skips a snapshotted tab that is still open", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
    ];
    await snapshotBeforeClose([1, 2]);
    await chrome.tabs.remove(2);

    expect(await executeUndo()).toBe("Reopened 1 tab(s)");
    expect(stub.created.map((c) => c.url)).toEqual(["https://b.com"]);
  });

  // Entries written by versions before the id was recorded: nothing to compare, restore as before.
  it("restores a legacy entry that recorded no ids", async () => {
    stub.openTabs = [{ id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: -1 }];
    await pushUndo({
      type: "close",
      label: "Closed 1 tab(s)",
      timestamp: 1,
      data: [{ url: "https://a.com", pinned: false, windowId: 1 }],
    });

    expect(await executeUndo()).toBe("Reopened 1 tab(s)");
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
    expect(undoStackSize()).toBe(0);
  });

  // The single-array layout reloaded a shared module-level array before each write, so two
  // unserialized pushes each reloaded the same pre-write state and the first entry vanished.
  it("does not drop an entry when two pushes overlap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const panel = await otherRealm();
      tick();
      await panel.pushUndo(entry("close", "theirs"));
      tick();
      await Promise.all([pushUndo(entry("close", "a")), pushUndo(entry("close", "b"))]);
      expect([(await popUndo())?.data, (await popUndo())?.data, (await popUndo())?.data]).toEqual(["b", "a", "theirs"]);
    } finally {
      vi.useRealTimers();
    }
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
