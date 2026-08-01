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
});
