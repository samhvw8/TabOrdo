import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub, type StubTab } from "./testing/chrome-stub.ts";
import { runMenuItem } from "./menus.ts";
import { hasUndo, peekUndoEntry, executeUndo } from "./undo.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
});

const tab = (t: Partial<StubTab> & { id: number }): StubTab =>
  ({ url: "https://x.com", pinned: false, windowId: 1, groupId: -1, index: 0, ...t });

describe("action-icon menu", () => {
  beforeEach(() => {
    stub.openTabs = [
      tab({ id: 1, url: "https://b.com/1", index: 0 }),
      tab({ id: 2, url: "https://a.com/1", index: 1 }),
      tab({ id: 3, url: "https://b.com/2", index: 2 }),
    ];
  });

  // The dashboard's Group tile snapshotted first and this menu entry, doing the same thing,
  // did not, so Ctrl+Z after it undid whatever came before instead.
  it("Group tabs by domain can be undone", async () => {
    await runMenuItem("tabOrdo-group-domain");
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).not.toBe(-1);
    expect((await peekUndoEntry())?.type).toBe("group");

    await executeUndo();
    expect(stub.openTabs.every((t) => t.groupId === -1)).toBe(true);
  });

  it("Sort tabs by domain can be undone", async () => {
    await runMenuItem("tabOrdo-sort");
    const order = () => [...stub.openTabs].sort((a, b) => a.index! - b.index!).map((t) => t.id);
    expect(order()).toEqual([2, 1, 3]);
    expect((await peekUndoEntry())?.type).toBe("group");

    await executeUndo();
    expect(order()).toEqual([1, 2, 3]);
  });

  it("Remove duplicate tabs leaves an undo entry for what it closed", async () => {
    stub.openTabs.push(tab({ id: 4, url: "https://a.com/1", index: 3 }));
    await runMenuItem("tabOrdo-dedup");
    expect(stub.removedIds).toHaveLength(1);
    expect(await hasUndo()).toBe(true);
  });
});
