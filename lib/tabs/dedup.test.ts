import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { removeDuplicates } from "./index.ts";
import { executeUndo, popUndo } from "../undo.ts";

let stub: ChromeStub;

beforeEach(async () => {
  stub = installChromeStub();
  while (await popUndo()) {
    /* drain the module-level stack between tests */
  }
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

  it("closes none when every copy is pinned", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: true, windowId: 1, groupId: -1 },
      { id: 2, url: "https://a.com/", pinned: true, windowId: 1, groupId: -1 },
    ];
    expect(await removeDuplicates()).toBe(0);
    expect(stub.removedIds).toEqual([]);
  });

  // pushUndo rejects when session storage refuses the write. Closing anyway would leave the
  // user with tabs gone and nothing to undo with.
  it("closes nothing when the undo snapshot cannot be persisted", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1 },
      { id: 2, url: "https://a.com/", pinned: false, windowId: 1, groupId: -1 },
    ];
    stub.failWrites = true;
    await expect(removeDuplicates()).rejects.toThrow();
    expect(stub.removedIds).toEqual([]);
  });
});
