import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import {
  resolveParents, collectSubtree, spliceParent, spliceParents, recordOpener, forgetTab,
  readParents, branchUpRoot, collectBranch, groupBranch, lineageOpener, EXPLICIT_ROOT,
  parentOf, branchOutline, outlineBranch,
} from "./tree.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }];
});

const tab = (t: Partial<{
  id: number; url: string; pendingUrl: string; title: string; pinned: boolean; windowId: number;
  groupId: number; index: number; active: boolean; openerTabId: number;
}>) =>
  ({ id: 0, url: "https://x.com", pinned: false, windowId: 1, groupId: -1, index: 0, ...t }) as any;

// The Hacker News journey the commands exist for: a listing tab, the articles opened from it,
// and the sub-links opened from one of those articles.
const HN_TREE = () => [
  tab({ id: 1, url: "https://news.ycombinator.com", title: "Hacker News", index: 0 }),
  tab({ id: 2, url: "https://a.com", index: 1 }),
  tab({ id: 3, url: "https://b.com", index: 2 }),
  tab({ id: 4, url: "https://b.com/deep", index: 3 }),
  tab({ id: 9, url: "https://unrelated.com", index: 4 }),
];
const HN_PARENTS = { 2: 1, 3: 1, 4: 3 };

describe("resolveParents", () => {
  it("keeps a recorded link after the opener tab is closed", () => {
    // Chrome has already dropped openerTabId here; only the recorded map still knows.
    const tabs = [tab({ id: 2 }), tab({ id: 4 })];
    const parents = resolveParents(tabs, { 4: 2 });
    expect(parents.get(4)).toBe(2);
  });

  it("falls back to Chrome's live openerTabId when nothing was recorded", () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2, openerTabId: 1 })];
    expect(resolveParents(tabs, {}).get(2)).toBe(1);
  });

  it("drops links whose parent tab no longer exists", () => {
    const parents = resolveParents([tab({ id: 4 })], { 4: 3 });
    expect(parents.has(4)).toBe(false);
  });

  it("drops links whose child tab no longer exists", () => {
    const parents = resolveParents([tab({ id: 1 })], { 4: 1 });
    expect(parents.has(4)).toBe(false);
  });

  it("ignores a tab recorded as its own parent", () => {
    expect(resolveParents([tab({ id: 5 })], { 5: 5 }).has(5)).toBe(false);
  });

  it("lets Chrome's live value win over a stale recorded one", () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3, openerTabId: 2 })];
    expect(resolveParents(tabs, { 3: 1 }).get(3)).toBe(2);
  });
});

describe("lineageOpener", () => {
  it("records the opener of a link-opened tab", () => {
    expect(lineageOpener(tab({ id: 2, openerTabId: 1, url: "", pendingUrl: "https://a.com" }))).toBe(1);
  });

  it("has nothing to record for a tab nobody opened", () => {
    expect(lineageOpener(tab({ id: 2, pendingUrl: "https://a.com" }))).toBeUndefined();
  });

  it("refuses a tab that names itself as opener", () => {
    expect(lineageOpener(tab({ id: 2, openerTabId: 2 }))).toBeUndefined();
  });

  // Chrome hands a Ctrl+T tab the previously active tab as its opener. That is a strip
  // heuristic, not lineage: whatever gets typed there is a new task.
  it("turns a Ctrl+T new-tab page into an explicit root", () => {
    expect(lineageOpener(tab({ id: 2, openerTabId: 1, url: "", pendingUrl: "chrome://newtab/" }))).toBe(EXPLICIT_ROOT);
    expect(lineageOpener(tab({ id: 2, openerTabId: 1, url: "chrome://newtab/" }))).toBe(EXPLICIT_ROOT);
    expect(lineageOpener(tab({ id: 2, openerTabId: 1, url: "chrome://new-tab-page/" }))).toBe(EXPLICIT_ROOT);
  });

  it("does not mistake a page that merely mentions newtab for one", () => {
    expect(lineageOpener(tab({ id: 2, openerTabId: 1, pendingUrl: "https://x.com/chrome://newtab" }))).toBe(1);
  });
});

describe("explicit roots", () => {
  it("overrule Chrome's live opener when merging", () => {
    // Chrome still reports the Ctrl+T heuristic; the map says the tab is a root.
    const tabs = [tab({ id: 1 }), tab({ id: 2, openerTabId: 1 })];
    expect(resolveParents(tabs, { 2: EXPLICIT_ROOT }).has(2)).toBe(false);
  });

  it("never surface as a parent id", () => {
    const parents = resolveParents([tab({ id: 2 })], { 2: EXPLICIT_ROOT });
    expect([...parents.values()]).not.toContain(EXPLICIT_ROOT);
  });

  it("survive a splice of unrelated tabs", () => {
    expect(spliceParents({ 2: EXPLICIT_ROOT, 3: 1 }, [1])).toEqual({ 2: EXPLICIT_ROOT });
  });

  it("are not inherited by the children of a closed explicit root", () => {
    // 5 was opened from Ctrl+T tab 2; closing 2 makes 5 a plain root, not a flagged one.
    expect(spliceParents({ 2: EXPLICIT_ROOT, 5: 2 }, [2])).toEqual({});
  });

  it("are stored by recordOpener like any other link", async () => {
    await recordOpener(2, EXPLICIT_ROOT);
    expect(await readParents()).toEqual({ 2: EXPLICIT_ROOT });
  });
});

describe("parentOf", () => {
  it("answers from the recorded map", async () => {
    stub.openTabs = HN_TREE();
    stub.sessionData.tabParents = { ...HN_PARENTS };
    expect(await parentOf(4)).toBe(3);
    expect(await parentOf(1)).toBeUndefined();
  });
});

describe("collectSubtree", () => {
  const parents = new Map(Object.entries(HN_PARENTS).map(([c, p]) => [Number(c), p]));

  it("reaches grandchildren, not just direct children", () => {
    expect(collectSubtree(1, parents, [1, 2, 3, 4, 9])).toEqual([1, 2, 3, 4]);
  });

  it("gathers only the sub-branch when started lower down", () => {
    expect(collectSubtree(3, parents, [1, 2, 3, 4, 9])).toEqual([3, 4]);
  });

  it("returns the root alone when it opened nothing", () => {
    expect(collectSubtree(9, parents, [1, 2, 3, 4, 9])).toEqual([9]);
  });

  it("returns candidates in the order given, not tree order", () => {
    expect(collectSubtree(1, parents, [4, 3, 2, 1])).toEqual([4, 3, 2, 1]);
  });

  // Defensive, not load-bearing: the map is persisted state, and a walk over one that went
  // bad has to terminate rather than spin.
  it("terminates on a cycle", () => {
    const cyclic = new Map([[1, 2], [2, 1]]);
    expect(collectSubtree(1, cyclic, [1, 2]).sort()).toEqual([1, 2]);
  });
});

describe("branchOutline", () => {
  const parents = new Map<number, number>([[2, 1], [3, 1], [4, 3], [5, 3]]);

  it("lists the root, then each child followed by its own subtree", () => {
    expect(branchOutline(1, parents, [1, 2, 3, 4, 5])).toEqual([
      { id: 1, depth: 0 }, { id: 2, depth: 1 }, { id: 3, depth: 1 }, { id: 4, depth: 2 }, { id: 5, depth: 2 },
    ]);
  });

  it("orders siblings by the order given, not by id", () => {
    expect(branchOutline(1, parents, [1, 3, 5, 4, 2]).map((n) => n.id)).toEqual([1, 3, 5, 4, 2]);
  });

  it("starts wherever it is pointed", () => {
    expect(branchOutline(3, parents, [1, 2, 3, 4, 5])).toEqual([
      { id: 3, depth: 0 }, { id: 4, depth: 1 }, { id: 5, depth: 1 },
    ]);
  });

  it("leaves out ids missing from the order without losing what sits below them", () => {
    expect(branchOutline(1, parents, [1, 2, 4, 5]).map((n) => n.id)).toEqual([1, 2, 4, 5]);
  });

  it("terminates on a cycle", () => {
    const loop = new Map<number, number>([[2, 1], [1, 2]]);
    expect(branchOutline(1, loop, [1, 2]).map((n) => n.id)).toEqual([1, 2]);
  });

  it("reads the live strip in window-then-index order", async () => {
    stub.openTabs = HN_TREE();
    stub.sessionData.tabParents = { ...HN_PARENTS };
    expect((await outlineBranch(1)).map((n) => n.id)).toEqual([1, 2, 3, 4]);
    expect((await outlineBranch(1)).map((n) => n.depth)).toEqual([0, 1, 1, 2]);
  });
});

describe("spliceParent", () => {
  it("re-parents children to their grandparent so the branch survives", () => {
    // Article 3 closes; its sub-link 4 should still belong to the Hacker News tab.
    expect(spliceParent(HN_PARENTS, 3)).toEqual({ 2: 1, 4: 1 });
  });

  it("promotes children to roots when the closed tab was one", () => {
    expect(spliceParent(HN_PARENTS, 1)).toEqual({ 4: 3 });
  });

  it("leaves unrelated links alone", () => {
    expect(spliceParent(HN_PARENTS, 2)).toEqual({ 3: 1, 4: 3 });
  });

  it("never re-parents a tab onto itself", () => {
    expect(spliceParent({ 2: 1, 1: 2 }, 1)).toEqual({});
  });
});

describe("recordOpener / forgetTab", () => {
  it("persists a link to session storage", async () => {
    await recordOpener(2, 1);
    expect(await readParents()).toEqual({ 2: 1 });
  });

  it("keeps every link from a burst of tab opens", async () => {
    // Ctrl-clicking a listing page fires these back to back; a read-modify-write per event
    // without serialisation would drop all but the last.
    await Promise.all([recordOpener(2, 1), recordOpener(3, 1), recordOpener(4, 1)]);
    expect(await readParents()).toEqual({ 2: 1, 3: 1, 4: 1 });
  });

  it("skips the write when the link is already recorded", async () => {
    await recordOpener(2, 1);
    let writes = 0;
    chrome.storage.onChanged.addListener((_c, area) => { if (area === "session") writes++; });
    await recordOpener(2, 1);
    await Promise.resolve(); // the stub delivers onChanged on a microtask, as Chrome does
    expect(writes).toBe(0);
    expect(await readParents()).toEqual({ 2: 1 });
  });

  it("refuses to record a tab as its own opener", async () => {
    await recordOpener(2, 2);
    expect(await readParents()).toEqual({});
  });

  it("splices a closed tab out of the map", async () => {
    stub.sessionData.tabParents = { ...HN_PARENTS };
    await forgetTab(3);
    expect(await readParents()).toEqual({ 2: 1, 4: 1 });
  });

  it("does nothing for a tab that was never in the map", async () => {
    stub.sessionData.tabParents = { ...HN_PARENTS };
    await forgetTab(99);
    expect(await readParents()).toEqual(HN_PARENTS);
  });

  // Closing a window fires onRemoved per tab. One write each would fan storage.onChanged out
  // to every open realm fifty times over to reach one final state.
  it("collapses a window-close storm into a single write", async () => {
    stub.sessionData.tabParents = Object.fromEntries([...Array(50)].map((_, i) => [i + 2, 1]));
    let writes = 0;
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "session" && "tabParents" in (c as Record<string, unknown>)) writes++;
    });

    await Promise.all([...Array(50)].map((_, i) => forgetTab(i + 2)));
    await new Promise((r) => setTimeout(r, 0)); // the stub delivers onChanged on a microtask

    expect(writes).toBe(1);
    expect(await readParents()).toEqual({});
  });

  it("reads storage once for the whole storm, not once per tab", async () => {
    stub.sessionData.tabParents = Object.fromEntries([...Array(50)].map((_, i) => [i + 2, 1]));
    stub.storageReads.length = 0;
    await Promise.all([...Array(50)].map((_, i) => forgetTab(i + 2)));
    // Followers find the pending set already drained and return before paying for a read.
    expect(stub.storageReads.filter((r) => r.keys.includes("tabParents")).length).toBe(1);
  });

  // Draining clears the pending set before the write. If a failed write kept that set cleared,
  // every child in the batch would be orphaned for good — their parent is gone, so no later
  // event re-derives the link.
  it("re-splices a batch whose write failed once a later removal comes through", async () => {
    stub.sessionData.tabParents = { 2: 1, 3: 2, 4: 3 };
    stub.failWrites = true;
    await Promise.all([forgetTab(2), forgetTab(3)]);
    expect(await readParents()).toEqual({ 2: 1, 3: 2, 4: 3 }); // write never landed

    stub.failWrites = false;
    await forgetTab(9);
    // 2 and 3 are still pending, so tab 4 reaches the listing page above them after all.
    expect(await readParents()).toEqual({ 4: 1 });
  });
});

describe("spliceParents", () => {
  it("re-parents past a whole chain removed in one pass", async () => {
    // Article 2 and its sub-link 3 both close; 4 belongs to the listing page above them.
    expect(spliceParents({ 2: 1, 3: 2, 4: 3 }, [2, 3])).toEqual({ 4: 1 });
  });

  it("promotes to a root when nothing live is left above", () => {
    expect(spliceParents({ 2: 1, 3: 2 }, [1, 2])).toEqual({});
  });

  it("returns null when the batch touches nothing, so the caller skips the write", () => {
    expect(spliceParents(HN_PARENTS, [98, 99])).toBeNull();
  });

  it("walks past the removed tab to the live ancestor above it", () => {
    // 1 closes; 3 belongs to 1's own parent 2, which is still open.
    expect(spliceParents({ 1: 2, 2: 4, 3: 1 }, [1])).toEqual({ 2: 4, 3: 2 });
  });

  it("terminates when the chain above a survivor is a closed loop", () => {
    // 1 and 2 point at each other and both close: the walk from 3 must stop, not spin.
    expect(spliceParents({ 1: 2, 2: 1, 3: 1 }, [1, 2])).toEqual({});
  });
});

describe("branchUpRoot", () => {
  beforeEach(() => {
    stub.openTabs = HN_TREE();
    stub.sessionData.tabParents = { ...HN_PARENTS };
  });

  it("starts at the tab that opened this one", async () => {
    expect(await branchUpRoot(4)).toEqual({ rootId: 3, climbed: false });
  });

  it("reports no parent for a tab nobody opened", async () => {
    expect(await branchUpRoot(1)).toEqual({ climbed: false });
  });

  // Running /branchup twice must climb, not rebuild the group the first run just made.
  it("walks past ancestors already sharing the active tab's group", async () => {
    for (const id of [3, 4]) stub.openTabs.find((t) => t.id === id)!.groupId = 70;
    expect(await branchUpRoot(4)).toEqual({ rootId: 1, climbed: true });
  });

  // Coming back empty after climbing is a different fact from having no parent, and the
  // caller says so — a tab whose parent sits beside it in the group was plainly opened
  // from something.
  it("distinguishes running out after a climb from having no parent at all", async () => {
    for (const id of [1, 3, 4]) stub.openTabs.find((t) => t.id === id)!.groupId = 70;
    expect(await branchUpRoot(4)).toEqual({ climbed: true });
  });

  it("does not treat ungrouped as a group in common", async () => {
    // Every tab here has groupId -1; that must not make them all one another's group.
    expect(await branchUpRoot(4)).toEqual({ rootId: 3, climbed: false });
  });

  it("stops at the first ancestor outside the group", async () => {
    stub.openTabs.find((t) => t.id === 4)!.groupId = 70;
    // 3 is in a *different* group, so it is already the level being asked for.
    stub.openTabs.find((t) => t.id === 3)!.groupId = 80;
    expect(await branchUpRoot(4)).toEqual({ rootId: 3, climbed: false });
  });

  it("terminates when a corrupted map closes a loop", async () => {
    for (const id of [1, 3, 4]) stub.openTabs.find((t) => t.id === id)!.groupId = 70;
    stub.sessionData.tabParents = { 4: 3, 3: 1, 1: 3 };
    expect(await branchUpRoot(4)).toEqual({ climbed: true });
  });
});

describe("collectBranch", () => {
  beforeEach(() => {
    stub.openTabs = HN_TREE();
    stub.sessionData.tabParents = { ...HN_PARENTS };
  });

  it("gathers the whole branch below the root, in strip order", async () => {
    const branch = await collectBranch(1, 1);
    expect(branch!.tabs.map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it("leaves out tabs from an unrelated branch", async () => {
    const branch = await collectBranch(1, 1);
    expect(branch!.tabs.map((t) => t.id)).not.toContain(9);
  });

  it("leaves out pinned tabs, which Chrome refuses to group", async () => {
    stub.openTabs.find((t) => t.id === 2)!.pinned = true;
    const branch = await collectBranch(1, 1);
    expect(branch!.tabs.map((t) => t.id)).toEqual([1, 3, 4]);
  });

  it("puts the root's window first so incoming tabs land after the ones already there", async () => {
    stub.windows = [{ id: 1 }, { id: 2 }];
    // Sub-link 4 was dragged out to a second window whose id sorts first by index alone.
    stub.openTabs.find((t) => t.id === 4)!.windowId = 2;
    stub.openTabs.find((t) => t.id === 4)!.index = 0;
    const branch = await collectBranch(1, 1);
    expect(branch!.tabs.map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it("returns null when the root tab is gone", async () => {
    expect(await collectBranch(404, 1)).toBeNull();
  });

  it("works from Chrome's live openers alone, with nothing recorded", async () => {
    delete stub.sessionData.tabParents;
    stub.openTabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, openerTabId: 1 }),
      tab({ id: 3, index: 2, openerTabId: 2 }),
    ];
    const branch = await collectBranch(1, 1);
    expect(branch!.tabs.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("does not gather a Ctrl+T tab that Chrome still credits to the root", async () => {
    // Tab 9 was opened with Ctrl+T while on the listing page: Chrome says opener 1, the map
    // says explicit root. The branch must not swallow whatever got typed there.
    stub.openTabs.find((t) => t.id === 9)!.openerTabId = 1;
    stub.sessionData.tabParents = { ...HN_PARENTS, 9: EXPLICIT_ROOT };
    const branch = await collectBranch(1, 1);
    expect(branch!.tabs.map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  describe("existingGroup", () => {
    const inGroup = (ids: number[], gid: number) => {
      for (const t of stub.openTabs) if (ids.includes(t.id)) t.groupId = gid;
      stub.groups = [{ id: gid, title: "Hacker News", windowId: 1 }];
    };

    it("is the root's group when every member of that group is in the branch", async () => {
      inGroup([1, 2, 3], 50);
      const branch = await collectBranch(1, 1);
      expect(branch!.existingGroup).toEqual({ id: 50, title: "Hacker News" });
    });

    it("is unset when the root is not grouped", async () => {
      inGroup([2, 3], 50);
      expect((await collectBranch(1, 1))!.existingGroup).toBeUndefined();
    });

    it("is unset when a stranger shares the root's group", async () => {
      // A domain auto-group holding the listing page and an unrelated tab is not this branch.
      inGroup([1, 2, 9], 50);
      expect((await collectBranch(1, 1))!.existingGroup).toBeUndefined();
    });

    it("is unset when the root's group sits in another window", async () => {
      // /branchup from a second window: the group has to form where the user is looking.
      stub.windows = [{ id: 1 }, { id: 2 }];
      inGroup([1, 2, 3, 4], 50);
      expect((await collectBranch(1, 2))!.existingGroup).toBeUndefined();
    });
  });
});

describe("groupBranch", () => {
  beforeEach(() => {
    stub.openTabs = HN_TREE();
    stub.sessionData.tabParents = { ...HN_PARENTS };
  });

  it("puts the whole branch in one new group", async () => {
    const branch = await collectBranch(1, 1);
    const out = await groupBranch(branch!);
    expect(out.grouped).toBe(4);
    const gid = stub.openTabs.find((t) => t.id === 1)!.groupId;
    expect(gid).not.toBe(-1);
    expect(stub.openTabs.filter((t) => t.groupId === gid).map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it("pulls members out of whatever group they were already in", async () => {
    stub.openTabs.find((t) => t.id === 3)!.groupId = 50;
    stub.openTabs.find((t) => t.id === 4)!.groupId = 50;
    stub.groups = [{ id: 50, title: "Old", windowId: 1 }];
    const branch = await collectBranch(1, 1);
    await groupBranch(branch!);
    expect(stub.openTabs.filter((t) => t.groupId === 50)).toEqual([]);
  });

  it("leaves the unrelated tab ungrouped", async () => {
    const branch = await collectBranch(1, 1);
    await groupBranch(branch!);
    expect(stub.openTabs.find((t) => t.id === 9)!.groupId).toBe(-1);
  });

  it("moves members in from other windows first, since Chrome won't group across them", async () => {
    stub.windows = [{ id: 1 }, { id: 2 }];
    stub.openTabs.find((t) => t.id === 4)!.windowId = 2;
    const branch = await collectBranch(1, 1);
    const out = await groupBranch(branch!);
    expect(out.moved).toBe(1);
    expect(stub.openTabs.find((t) => t.id === 4)!.windowId).toBe(1);
    expect(out.grouped).toBe(4);
  });

  it("titles the group after the root tab", async () => {
    const branch = await collectBranch(1, 1);
    const out = await groupBranch(branch!);
    expect(out.title).toBe("Hacker News");
    expect(stub.groupUpdates.at(-1)!.title).toBe("Hacker News");
  });

  it("falls back to the root's hostname when its title is too long for a group strip", async () => {
    stub.openTabs.find((t) => t.id === 1)!.title = "A page title far too long to sit in a Chrome tab group";
    const branch = await collectBranch(1, 1);
    expect((await groupBranch(branch!)).title).toBe("news.ycombinator.com");
  });

  it("prefers an explicit title from the command", async () => {
    const branch = await collectBranch(1, 1);
    expect((await groupBranch(branch!, "Morning read")).title).toBe("Morning read");
  });

  it("gives the same title the same colour on every run", async () => {
    const branch = await collectBranch(1, 1);
    await groupBranch(branch!, "Morning read");
    const first = stub.groupUpdates.at(-1)!.color;
    await groupBranch((await collectBranch(1, 1))!, "Morning read");
    expect(stub.groupUpdates.at(-1)!.color).toBe(first);
  });

  describe("folding into the branch's existing group", () => {
    beforeEach(() => {
      // A first run gathered 1, 2, 3; sub-link 4 was opened afterwards.
      for (const t of stub.openTabs) if ([1, 2, 3].includes(t.id)) t.groupId = 50;
      stub.groups = [{ id: 50, title: "Morning read", color: "pink", windowId: 1 }];
    });

    it("adds only the newcomers and creates no second group", async () => {
      const out = await groupBranch((await collectBranch(1, 1))!);
      expect(out).toMatchObject({ reused: true, added: 1, grouped: 4, moved: 0, title: "Morning read" });
      expect(stub.groups.map((g) => g.id)).toEqual([50]);
      expect(stub.openTabs.filter((t) => t.groupId === 50).map((t) => t.id).sort()).toEqual([1, 2, 3, 4]);
    });

    it("keeps the group's title and colour when no name is given", async () => {
      await groupBranch((await collectBranch(1, 1))!);
      expect(stub.groupUpdates).toEqual([]);
    });

    it("renames on request without touching the colour", async () => {
      const out = await groupBranch((await collectBranch(1, 1))!, "Evening read");
      expect(out.title).toBe("Evening read");
      expect(stub.groupUpdates).toEqual([{ id: 50, title: "Evening read" }]);
    });

    it("pulls a newcomer in from another window first", async () => {
      stub.windows = [{ id: 1 }, { id: 2 }];
      stub.openTabs.find((t) => t.id === 4)!.windowId = 2;
      const out = await groupBranch((await collectBranch(1, 1))!);
      expect(out.moved).toBe(1);
      expect(stub.openTabs.find((t) => t.id === 4)).toMatchObject({ windowId: 1, groupId: 50 });
    });

    it("reports nothing added when the branch was already whole", async () => {
      stub.openTabs.find((t) => t.id === 4)!.groupId = 50;
      const out = await groupBranch((await collectBranch(1, 1))!);
      expect(out.added).toBe(0);
      expect(stub.moves).toEqual([]);
    });
  });
});
