import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { popUndo, peekUndo, peekUndoEntry, executeUndo, undoStackSize } from "../undo.ts";
import {
  closeTabs,
  closeTabsToLeft,
  closeTabsToRight,
  closeTabsSameSite,
  closeOldTabs,
} from "./close.ts";
import { removeDuplicates } from "./dedup.ts";

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
async function snapshotUrls(): Promise<string[]> {
  const entry = await peekUndoEntry();
  if (!entry || entry.type !== "close") return [];
  return (entry.data as { url: string }[]).map((d) => d.url);
}

describe("closeTabs", () => {
  beforeEach(() => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 3, url: "https://c.com", pinned: false, windowId: 1, groupId: -1, index: 2 },
    ];
  });

  it("removes exactly the ids it was given", async () => {
    expect(await closeTabs([1, 3])).toBe(2);
    expect(stub.removedIds).toEqual([1, 3]);
    expect(openIds()).toEqual([2]);
  });

  it("is a no-op for an empty list, and pushes no undo entry", async () => {
    expect(await closeTabs([])).toBe(0);
    expect(stub.openTabs).toHaveLength(3);
    expect(peekUndo()).toBeNull();
  });

  it("snapshots for undo before removing", async () => {
    await closeTabs([2]);
    expect(await snapshotUrls()).toEqual(["https://b.com"]);
    expect(await executeUndo()).toBe("Reopened 1 tab(s)");
  });

  // Chrome walks an id array in order and stops at the first it can't resolve, so one stale
  // entry in the popup's list used to leave every tab after it open.
  it("closes the live tabs when one id has already gone, and counts it as done", async () => {
    expect(await closeTabs([1, 999, 3])).toBe(3);
    expect(stub.removedIds).toEqual([1, 3]);
    expect(openIds()).toEqual([2]);
  });

  it("records no undo entry when every id had already gone", async () => {
    expect(await closeTabs([998, 999])).toBe(2);
    expect(peekUndo()).toBeNull();
  });

  // A refused close is the one signal the user can act on. Counting only the fulfilled ones
  // turned "Chrome would not close this tab" into "No duplicates found".
  it("still closes the rest, then throws, when Chrome refuses one tab", async () => {
    stub.failRemoveIds.add(2);
    await expect(closeTabs([1, 2, 3])).rejects.toThrow(/1 tab\(s\) could not be closed/);
    expect(stub.removedIds).toEqual([1, 3]);
    expect(openIds()).toEqual([2]);
  });

  // The snapshot precedes the close, so after a refusal it names a tab that is still open.
  // Recreating it put a second copy beside the first — Ctrl/Z after a partial close used to
  // manufacture exactly the duplicates the user was trying to lose.
  it("after a refused tab, undo reopens only the tabs that actually closed", async () => {
    stub.failRemoveIds.add(2);
    await closeTabs([1, 2, 3]).catch(() => {});

    expect(await executeUndo()).toBe("Reopened 2 tab(s)");
    expect(stub.created.map((c) => c.url).sort()).toEqual(["https://a.com", "https://c.com"]);
    expect(openIds()).toHaveLength(3);
  });

  it("takes no snapshot when asked not to", async () => {
    expect(await closeTabs([1], { snapshot: false })).toBe(1);
    expect(stub.removedIds).toEqual([1]);
    expect(undoStackSize()).toBe(0);
  });
});

// The same three guarantees for every bulk closer, in one place. Each of these used to snapshot
// and remove on its own, and the guarantees drifted apart one call site per release.
describe("every bulk closer", () => {
  // Five old copies of one page around an active sixth: [1, 2] sit left of it, [4, 5] right,
  // so each closer has at least two targets. `refuse` is one of that closer's targets and
  // `rest` the others.
  const closers: { name: string; run: () => Promise<number>; refuse: number; rest: number[] }[] = [
    { name: "closeTabsToLeft", run: closeTabsToLeft, refuse: 1, rest: [2] },
    { name: "closeTabsToRight", run: closeTabsToRight, refuse: 4, rest: [5] },
    { name: "closeTabsSameSite", run: closeTabsSameSite, refuse: 1, rest: [2, 4, 5] },
    { name: "closeOldTabs", run: () => closeOldTabs(), refuse: 1, rest: [2, 4, 5] },
    { name: "removeDuplicates", run: removeDuplicates, refuse: 1, rest: [2, 4, 5] },
  ];

  beforeEach(() => {
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const tab = (id: number, index: number, active = false) => ({
      id, index, active, url: "https://a.com", pinned: false, windowId: 1, groupId: -1,
      lastAccessed: active ? Date.now() : old,
    });
    stub.openTabs = [tab(1, 0), tab(2, 1), tab(3, 2, true), tab(4, 3), tab(5, 4)];
  });

  // pushUndo rejects when session storage refuses the write. Closing anyway would leave the
  // user with tabs gone and nothing to undo with.
  for (const { name, run } of closers) {
    it(`${name} closes nothing when the undo snapshot cannot be persisted`, async () => {
      stub.failWrites = true;
      await expect(run()).rejects.toThrow();
      expect(stub.removedIds).toEqual([]);
    });
  }

  // These used to hand Chrome one id array after pushing a full snapshot. Chrome stopped at
  // the refused id, the error toast invited Ctrl+Z, and undo recreated every tab in the
  // snapshot — the refused one included, now twice over.
  for (const { name, run, refuse, rest } of closers) {
    it(`${name} closes the rest, reports the tab Chrome refused, and undo reopens only the rest`, async () => {
      stub.failRemoveIds.add(refuse);
      await expect(run()).rejects.toThrow(/could not be closed/);
      expect(stub.removedIds.sort()).toEqual(rest);

      expect(await executeUndo()).toBe(`Reopened ${rest.length} tab(s)`);
      expect(stub.created).toHaveLength(rest.length);
      expect(stub.openTabs).toHaveLength(5);
    });
  }
});

// The reason closeTabs can promise anything is that nothing else removes a tab. This walks
// the production source — comments and tests aside — and fails on a second caller, so the
// next "just close it here" lands in this file's explanation rather than in a release.
describe("chrome.tabs.remove", () => {
  it("is called from closeTabs and nowhere else", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const rel = relative(root, path);
        if (statSync(path).isDirectory()) {
          if (rel !== "lib/testing") walk(path);
          continue;
        }
        if (!/\.(ts|svelte)$/.test(name) || name.endsWith(".test.ts")) continue;
        readFileSync(path, "utf8").split("\n").forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("<!--")) return;
          if (/chrome\.tabs\.remove\s*\(/.test(code)) hits.push(`${rel}:${i + 1}`);
        });
      }
    };
    for (const dir of ["lib", "entrypoints", "components"]) walk(join(root, dir));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^lib\/tabs\/close\.ts:\d+$/);
  });
});

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
    expect(await snapshotUrls()).toEqual(["https://left.com"]);
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
    expect((await snapshotUrls()).sort()).toEqual(["https://a.com/elsewhere", "https://a.com/other"]);
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
    expect((await snapshotUrls()).sort()).toEqual(["https://stale-elsewhere.com", "https://stale.com"]);
  });
});
