import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { removeDuplicates } from "./index.ts";
import { executeUndo } from "../undo.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
});

describe("removeDuplicates", () => {
  it("keeps one tab per URL and closes the rest", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1 },
      { id: 3, url: "https://b.com/", pinned: false, windowId: 1, groupId: -1 },
    ];
    expect(await removeDuplicates()).toBe(1);
    expect(stub.removedIds).toEqual([2]);
  });

  // The snapshot used to live at the call sites, and both popup paths took a *group*
  // snapshot — which dedup never changes — so undo restored grouping and the closed
  // duplicates stayed closed.
  it("records a close snapshot, so undo reopens what it closed", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1 },
    ];
    await removeDuplicates();

    expect(await executeUndo()).toBe("Reopened 1 tab(s)");
    expect(stub.created.map((c) => c.url)).toEqual(["https://a.com/"]);
  });

  it("takes no snapshot when there is nothing to close", async () => {
    stub.openTabs = [{ id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1 }];
    expect(await removeDuplicates()).toBe(0);
    expect(await executeUndo()).toBe("Nothing to undo");
  });

  // The key used to be protocol + host + path, so every video on YouTube, every issue on
  // GitHub and every search result was "the same tab" as its siblings.
  it("treats different query strings as different pages", async () => {
    stub.openTabs = [
      { id: 1, url: "https://youtube.com/watch?v=A", pinned: false, windowId: 1, groupId: -1 },
      { id: 2, url: "https://youtube.com/watch?v=B", pinned: false, windowId: 1, groupId: -1 },
    ];
    expect(await removeDuplicates()).toBe(0);
    expect(stub.removedIds).toEqual([]);
  });

  it("treats different hashes as different pages", async () => {
    stub.openTabs = [
      { id: 1, url: "https://docs.com/guide#intro", pinned: false, windowId: 1, groupId: -1 },
      { id: 2, url: "https://docs.com/guide#setup", pinned: false, windowId: 1, groupId: -1 },
    ];
    expect(await removeDuplicates()).toBe(0);
  });

  it("still dedupes the same page when only tracking params differ", async () => {
    stub.openTabs = [
      { id: 1, url: "https://blog.com/post?id=7", pinned: false, windowId: 1, groupId: -1, lastAccessed: 2 },
      { id: 2, url: "https://blog.com/post?id=7&utm_source=twitter&fbclid=xyz", pinned: false, windowId: 1, groupId: -1, lastAccessed: 1 },
      { id: 3, url: "https://blog.com/post?id=7&gclid=abc", pinned: false, windowId: 1, groupId: -1, lastAccessed: 0 },
    ];
    expect(await removeDuplicates()).toBe(2);
    expect(stub.removedIds.sort()).toEqual([2, 3]);
  });

  // Recency alone decides between two plain copies — asserted here rather than left to fall
  // out of the tracking-params case, which varies two things at once.
  it("keeps the most recently used copy when no copy is pinned", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 10 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 99 },
    ];
    expect(await removeDuplicates()).toBe(1);
    expect(stub.removedIds).toEqual([1]);
    expect(stub.openTabs.map((t) => t.id)).toEqual([2]);
  });

  // Survivors were picked purely by lastAccessed, so a pinned tab lost to any copy the user
  // had touched more recently — the one copy they'd asked to keep was the one that went.
  it("never closes a pinned tab", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: true, windowId: 1, groupId: -1, lastAccessed: 1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 99 },
    ];
    expect(await removeDuplicates()).toBe(1);
    expect(stub.removedIds).toEqual([2]);
  });

  // A pin decides which copy survives; it does not exempt a page from dedup. Two pinned
  // copies used to both stay, so the pinned strip was the one place /dedup could not clean.
  it("keeps only the most recent copy when every copy is pinned", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: true, windowId: 1, groupId: -1, lastAccessed: 1 },
      { id: 2, url: "https://a.com/", pinned: true, windowId: 1, groupId: -1, lastAccessed: 99 },
    ];
    expect(await removeDuplicates()).toBe(1);
    expect(stub.removedIds).toEqual([1]);
  });

  // Chrome's pin and a position pin rank the same; recency settles it between them.
  it("keeps one copy when one is Chrome-pinned and another is position-pinned", async () => {
    stub.groups = [{ id: 5, title: "Docs" }];
    stub.localData.pinnedTabs = [
      { id: "p1", url: "https://a.com/", groupName: "Docs", position: 0 },
    ];
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: true, windowId: 1, groupId: -1, lastAccessed: 1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: 5, lastAccessed: 50 },
      { id: 3, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 99 },
    ];
    expect(await removeDuplicates()).toBe(2);
    expect(stub.removedIds).toEqual([1, 3]);
  });

  // A /pin is the same promise as Chrome's pin — keep this copy — but only the native flag
  // was honoured here, so a position-pinned tab still lost to any copy touched more recently.
  it("never closes a tab pinned to a position in its group", async () => {
    stub.groups = [{ id: 5, title: "Docs" }];
    stub.localData.pinnedTabs = [
      { id: "p1", url: "https://a.com/", groupName: "Docs", position: 0 },
    ];
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: 5, lastAccessed: 1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 99 },
    ];
    expect(await removeDuplicates()).toBe(1);
    expect(stub.removedIds).toEqual([2]);
  });

  // tabId wins over URL, the same order applyPinsToGroup uses: the pin's stored URL goes
  // stale the moment the tab navigates, and the entry still points at that tab.
  it("resolves a position pin by tab id when its stored url is stale", async () => {
    stub.groups = [{ id: 5, title: "Docs" }];
    stub.localData.pinnedTabs = [
      { id: "p1", url: "https://a.com/old", tabId: 1, groupName: "Docs", position: 0 },
    ];
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: 5, lastAccessed: 1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: 5, lastAccessed: 99 },
    ];
    expect(await removeDuplicates()).toBe(1);
    expect(stub.removedIds).toEqual([2]);
  });

  // One entry protects one tab. Matching every same-URL copy in the group would make dedup
  // a no-op on exactly the group the user curates most.
  it("still closes a second copy sitting inside the pinned group", async () => {
    stub.groups = [{ id: 5, title: "Docs" }];
    stub.localData.pinnedTabs = [
      { id: "p1", url: "https://a.com/", groupName: "Docs", position: 0 },
    ];
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: 5, lastAccessed: 1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: 5, lastAccessed: 99 },
    ];
    expect(await removeDuplicates()).toBe(1);
    expect(stub.removedIds).toEqual([2]);
  });

  // A pin is scoped to its group, so a copy in another group is not the pinned one.
  it("ignores a pin whose group does not match the tab", async () => {
    stub.groups = [{ id: 5, title: "Docs" }, { id: 6, title: "Reading" }];
    stub.localData.pinnedTabs = [
      { id: "p1", url: "https://a.com/", groupName: "Docs", position: 0 },
    ];
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: 6, lastAccessed: 1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: 6, lastAccessed: 99 },
    ];
    expect(await removeDuplicates()).toBe(1);
    expect(stub.removedIds).toEqual([1]);
  });

  // A duplicate closed between the scan and the removal — by the user, or by the page itself
  // — must neither abort the rest nor be reported as a failure: it is gone, as intended. The
  // vanish is staged on the strip query closeTabs makes for its undo snapshot, the last read
  // before the remove.
  it("closes the remaining duplicates when one has gone since the scan", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 99 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 50 },
      { id: 3, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 10 },
    ];
    const realQuery = chrome.tabs.query;
    let scans = 0;
    (chrome.tabs as unknown as { query: typeof realQuery }).query = ((info: object) => {
      if (++scans === 2) stub.openTabs = stub.openTabs.filter((t) => t.id !== 2);
      return realQuery(info);
    }) as typeof realQuery;

    expect(await removeDuplicates()).toBe(2);
    expect(stub.removedIds).toEqual([3]);
    expect(stub.openTabs.map((t) => t.id)).toEqual([1]);
    // The snapshot never saw tab 2, so undo brings back only the copy dedup itself closed.
    expect(await executeUndo()).toBe("Reopened 1 tab(s)");
  });

  // The remaining kind of failure is a tab Chrome refuses to close, such as one mid-drag.
  // That one is still there, and "No duplicates found" would be a lie.
  it("throws, after closing what it can, when Chrome refuses a duplicate", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 99 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 50 },
      { id: 3, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1, lastAccessed: 10 },
    ];
    stub.failRemoveIds.add(2);

    await expect(removeDuplicates()).rejects.toThrow(/could not be closed/);
    expect(stub.removedIds).toEqual([3]);
    expect(stub.openTabs.map((t) => t.id).sort()).toEqual([1, 2]);
  });
});
