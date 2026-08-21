import { describe, it, expect, beforeEach, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { popUndo, peekUndo, executeUndo } from "./undo.ts";
import { getArchive } from "./archive.ts";
import { runAction, ACTION_HANDLERS, mergeStatus, type ActionContext } from "./actions.ts";
import { ACTION_COMMANDS } from "./commands.ts";
import type { SearchResult } from "./search.ts";

// The palette's action behaviour used to live in a switch inside App.svelte and was reachable
// only by mounting the component. These exercise the handlers directly.

let stub: ChromeStub;
let filePickerOpened: number;

beforeEach(async () => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }, { id: 2 }];
  filePickerOpened = 0;
  while (await popUndo()) {
    /* drain the module-level undo stack between tests */
  }
});

const asResult = (t: { id: number; url?: string; title?: string; groupTitle?: string }): SearchResult =>
  ({ tabId: t.id, url: t.url ?? "", title: t.title ?? "", groupTitle: t.groupTitle } as SearchResult);

/** Build a context; `matches` are the tabs the user's query resolved to. */
function ctx(over: Partial<ActionContext> = {}): ActionContext {
  const matchingTabs = over.matchingTabs ?? [];
  return {
    query: "",
    matchingTabs,
    tabIds: over.tabIds ?? matchingTabs.map((t) => t.tabId!),
    currentWindowId: 1,
    rankTabs: () => [],
    requestFilePicker: () => { filePickerOpened++; },
    ...over,
  };
}

function seedTabs() {
  stub.openTabs = [
    { id: 1, url: "https://a.com", title: "A", pinned: false, windowId: 1, groupId: -1, index: 0, active: true },
    { id: 2, url: "https://b.com", title: "B", pinned: false, windowId: 1, groupId: -1, index: 1 },
    { id: 3, url: "https://c.com", title: "C", pinned: false, windowId: 1, groupId: -1, index: 2 },
  ];
}

describe("runAction dispatch", () => {
  it("returns null for a prefix with no handler, so /aigroup stays with the caller", async () => {
    expect(await runAction("aigroup", ctx())).toBeNull();
    expect(await runAction("nonsense", ctx())).toBeNull();
  });

  it("aliases /lock and /pin to the same handler", () => {
    expect(ACTION_HANDLERS.lock).toBe(ACTION_HANDLERS.pin);
    expect(ACTION_HANDLERS.unlock).toBe(ACTION_HANDLERS.unpin);
    expect(ACTION_HANDLERS.lockgroup).toBe(ACTION_HANDLERS.pingroup);
    expect(ACTION_HANDLERS.unlockgroup).toBe(ACTION_HANDLERS.unpingroup);
  });

  // Without this, adding a command to ACTION_COMMANDS and forgetting the handler ships a
  // slash command that is listed, accepted, and silently does nothing.
  it("has a handler for every advertised action command", () => {
    const missing = ACTION_COMMANDS
      .map((c) => c.prefix)
      .filter((p) => p !== "aigroup" && typeof ACTION_HANDLERS[p] !== "function");
    expect(missing).toEqual([]);
  });

  it("advertises every handler it defines", () => {
    const advertised = new Set(ACTION_COMMANDS.map((c) => c.prefix));
    const orphans = Object.keys(ACTION_HANDLERS).filter((p) => !advertised.has(p));
    expect(orphans).toEqual([]);
  });
});

describe("/close", () => {
  beforeEach(seedTabs);

  it("snapshots then closes the matched tabs", async () => {
    const r = await runAction("close", ctx({ matchingTabs: [asResult({ id: 2, url: "https://b.com" })] }));
    expect(r).toEqual({ message: "Closed 1 tab(s)", acted: true });
    expect(stub.removedIds).toEqual([2]);
    expect(peekUndo()?.type).toBe("close");
  });

  it("does nothing, and reports nothing, when the query matched no tabs", async () => {
    const r = await runAction("close", ctx({ query: "zzz" }));
    expect(r).toEqual({ acted: false });
    expect(stub.removedIds).toEqual([]);
    expect(peekUndo()).toBeNull();
  });
});

describe("/archive", () => {
  beforeEach(seedTabs);

  it("writes the archive before closing the tabs", async () => {
    const r = await runAction("archive", ctx({
      matchingTabs: [asResult({ id: 2, url: "https://b.com", title: "B", groupTitle: "Work" })],
    }));
    expect(r).toEqual({ message: "Archived 1 tab(s)", acted: true });
    const archive = await getArchive();
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatchObject({ url: "https://b.com", title: "B", groupName: "Work" });
    expect(stub.removedIds).toEqual([2]);
  });

  it("is a no-op with no matches", async () => {
    expect(await runAction("archive", ctx({ query: "zzz" }))).toEqual({ acted: false });
    expect(await getArchive()).toEqual([]);
  });

  // It closed every match while archiveTabs kept only the ones with a real URL, so
  // "Archived 1" could close two — and the second one was gone for good.
  it("closes only the tabs it actually archived", async () => {
    const r = await runAction("archive", ctx({
      matchingTabs: [
        asResult({ id: 2, url: "https://b.com", title: "B" }),
        asResult({ id: 3, url: "chrome://newtab/", title: "New Tab" }),
      ],
    }));
    expect(r).toEqual({ message: "Archived 1 tab(s)", acted: true });
    expect(stub.removedIds).toEqual([2]);
    expect(stub.openTabs.map((t) => t.id)).toEqual([1, 3]);
  });

  // The only destructive handler that took no snapshot: Ctrl+Z after /archive popped whatever
  // older entry happened to be on the stack.
  it("snapshots the close so undo can bring the tabs back", async () => {
    await runAction("archive", ctx({ matchingTabs: [asResult({ id: 2, url: "https://b.com", title: "B" })] }));
    const top = peekUndo();
    expect(top?.type).toBe("close");
    expect((top?.data as { url: string }[]).map((d) => d.url)).toEqual(["https://b.com"]);
  });

  it("reports, and closes nothing, when no match can be archived", async () => {
    const r = await runAction("archive", ctx({
      matchingTabs: [asResult({ id: 3, url: "chrome://newtab/", title: "New Tab" })],
    }));
    expect(r).toEqual({ message: "Nothing to archive", acted: false });
    expect(stub.removedIds).toEqual([]);
    expect(await getArchive()).toEqual([]);
  });
});

describe("/group and /ungroup", () => {
  beforeEach(seedTabs);

  it("names the new group after the query", async () => {
    const r = await runAction("group", ctx({
      query: "Research",
      matchingTabs: [asResult({ id: 1 }), asResult({ id: 2 })],
    }));
    expect(r?.message).toBe("Grouped 2 tab(s)");
    expect(stub.groupUpdates).toEqual([expect.objectContaining({ title: "Research" })]);
  });

  it("falls back to the label 'Grouped' for a bare /group", async () => {
    await runAction("group", ctx({ matchingTabs: [asResult({ id: 1 })] }));
    expect(stub.groupUpdates).toEqual([expect.objectContaining({ title: "Grouped" })]);
  });

  it("ungroups the matched tabs", async () => {
    stub.openTabs[0].groupId = 7;
    stub.openTabs[1].groupId = 7;
    const r = await runAction("ungroup", ctx({ matchingTabs: [asResult({ id: 1 }), asResult({ id: 2 })] }));
    expect(r?.message).toBe("Ungrouped 2 tab(s)");
    expect(stub.ungroupedIds.sort()).toEqual([1, 2]);
  });

  it("falls back to the active tab for a bare /ungroup", async () => {
    stub.openTabs[0].groupId = 7;
    const r = await runAction("ungroup", ctx());
    expect(r?.message).toBe("Ungrouped current tab");
    expect(stub.ungroupedIds).toEqual([1]);
  });

  // The fallback is for a *bare* command only. A query that matched nothing must not silently
  // redirect the action onto whatever tab happens to be focused.
  it("does not fall back to the active tab when a query matched nothing", async () => {
    stub.openTabs[0].groupId = 7;
    expect(await runAction("ungroup", ctx({ query: "zzz" }))).toEqual({ acted: false });
    expect(stub.ungroupedIds).toEqual([]);
  });

  it("does nothing for a bare /ungroup when the active tab has no group", async () => {
    expect(await runAction("ungroup", ctx())).toEqual({ acted: false });
    expect(stub.ungroupedIds).toEqual([]);
  });
});

describe("/sort", () => {
  it("accepts title, url and domain", async () => {
    for (const by of ["title", "url", "domain"]) {
      expect((await runAction("sort", ctx({ query: by })))?.message).toBe(`Sorted tabs by ${by}`);
    }
  });

  it("falls back to domain for anything else", async () => {
    expect((await runAction("sort", ctx({ query: "sideways" })))?.message).toBe("Sorted tabs by domain");
    expect((await runAction("sort", ctx()))?.message).toBe("Sorted tabs by domain");
  });
});

describe("/mute and /unmute", () => {
  beforeEach(seedTabs);

  it("mutes the matched tabs", async () => {
    const r = await runAction("mute", ctx({ matchingTabs: [asResult({ id: 2 }), asResult({ id: 3 })] }));
    expect(r?.message).toBe("Muted 2 tab(s)");
  });

  it("falls back to the active tab when the command is bare", async () => {
    expect((await runAction("unmute", ctx()))?.message).toBe("Unmuted active tab");
  });

  it("stays put when a query matched nothing", async () => {
    expect(await runAction("mute", ctx({ query: "zzz" }))).toEqual({ acted: false });
  });

  // The loop awaited each update in turn, so the first id that had gone stale threw and the
  // tabs after it in the list were never touched.
  it("mutes the rest of the batch when one tab is already gone", async () => {
    const realUpdate = chrome.tabs.update;
    (chrome.tabs as unknown as { update: (id: number, props: object) => Promise<unknown> }).update =
      async (id, props) => {
        if (id === 2) throw new Error("No tab with id: 2");
        return realUpdate(id, props);
      };

    const r = await runAction("mute", ctx({ matchingTabs: [asResult({ id: 2 }), asResult({ id: 3 })] }));
    expect(r?.message).toBe("Muted 2 tab(s)");
    expect(stub.openTabs.find((t) => t.id === 3)!.muted).toBe(true);
  });
});

describe("/vol", () => {
  beforeEach(seedTabs);

  it("rejects a non-numeric argument with usage help", async () => {
    expect(await runAction("vol", ctx({ query: "loud" }))).toEqual({
      message: "Usage: /vol 50 [search]",
      acted: true,
    });
  });

  it("clamps above 100", async () => {
    const r = await runAction("vol", ctx({ query: "500" }));
    expect(r?.message).toBe("Volume 100% on active tab");
  });

  it("reports partial success when some tabs are not scriptable", async () => {
    stub.failScriptingIds = new Set([3]);
    const targets = [asResult({ id: 2 }), asResult({ id: 3 })];
    const r = await runAction("vol", ctx({ query: "40 media", rankTabs: () => targets }));
    expect(r?.message).toContain("Volume 40% on 1/2 tab(s)");
    expect(r?.message).toContain("need page access");
  });

  it("reports plain success when every target took the change", async () => {
    const targets = [asResult({ id: 2 }), asResult({ id: 3 })];
    const r = await runAction("vol", ctx({ query: "40 media", rankTabs: () => targets }));
    expect(r?.message).toBe("Volume 40% on 2 tab(s)");
  });

  it("says so when the active tab cannot be scripted", async () => {
    stub.failScriptingIds = new Set([1]);
    expect((await runAction("vol", ctx({ query: "20" })))?.message)
      .toBe("Can't control volume on this page");
  });
});

describe("/discard, /reload and /freeze", () => {
  beforeEach(seedTabs);

  it("discards the matched tabs", async () => {
    const r = await runAction("discard", ctx({ matchingTabs: [asResult({ id: 2 })] }));
    expect(r?.message).toBe("Discarded 1 tab(s)");
    expect(stub.discardedIds).toEqual([2]);
  });

  it("reloads the matched tabs", async () => {
    const r = await runAction("reload", ctx({ matchingTabs: [asResult({ id: 2 }), asResult({ id: 3 })] }));
    expect(r?.message).toBe("Reloaded 2 tab(s)");
    expect(stub.reloadedIds.sort()).toEqual([2, 3]);
  });

  it("bare /freeze unloads every inactive, unpinned tab", async () => {
    const r = await runAction("freeze", ctx());
    expect(r?.message).toBe("Unloaded 2 inactive tab(s)");
    expect(stub.discardedIds.sort()).toEqual([2, 3]);
  });

  it("bare /freeze spares the active tab", async () => {
    await runAction("freeze", ctx());
    expect(stub.discardedIds).not.toContain(1);
  });

  it("bare /freeze reports when there is nothing to unload", async () => {
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 0, active: true },
    ];
    expect(await runAction("freeze", ctx())).toEqual({ message: "No tabs to unload", acted: true });
  });
});

describe("/split", () => {
  beforeEach(seedTabs);

  // Its description promises active-tab behaviour; it used to require a query and no-op without one.
  it("sends the active tab to a new window when invoked bare", async () => {
    const before = stub.windows.length;
    const r = await runAction("split", ctx());
    expect(r).toEqual({ message: "Split tab to new window", acted: true });
    expect(stub.windows.length).toBe(before + 1);
    expect(stub.openTabs.find((t) => t.id === 1)!.windowId).not.toBe(1);
  });

  it("sends the first match when a query resolved tabs", async () => {
    await runAction("split", ctx({ matchingTabs: [asResult({ id: 3 })] }));
    expect(stub.openTabs.find((t) => t.id === 3)!.windowId).not.toBe(1);
    expect(stub.openTabs.find((t) => t.id === 1)!.windowId).toBe(1);
  });

  it("still does nothing when a query matched no tabs", async () => {
    const before = stub.windows.length;
    expect(await runAction("split", ctx({ query: "zzz" }))).toEqual({ acted: false });
    expect(stub.windows.length).toBe(before);
  });
});

describe("/focus and /unfocus", () => {
  beforeEach(seedTabs);

  it("flags that saved-workspace state changed so the caller re-reads it", async () => {
    const r = await runAction("focus", ctx());
    expect(r?.workspaceChanged).toBe(true);
    expect(r?.message).toBe("Saved 3 tab(s), focus mode on");
  });

  it("reports an empty stack on /unfocus", async () => {
    expect(await runAction("unfocus", ctx())).toEqual({
      message: "No saved workspace",
      acted: true,
      workspaceChanged: true,
    });
  });
});

describe("/load", () => {
  it("asks the component to open the file picker and does not count as an action", async () => {
    expect(await runAction("load", ctx())).toEqual({ acted: false });
    expect(filePickerOpened).toBe(1);
  });
});

describe("/readlater", () => {
  it("explains itself when the Reading List API is absent", async () => {
    expect(await runAction("readlater", ctx())).toEqual({
      message: "Reading List not available (requires Chrome 120+)",
      acted: true,
    });
  });
});

describe("/recent", () => {
  it("returns the recently-closed list without counting as an action", async () => {
    const entries = [{ title: "Gone", url: "https://gone.com" }];
    (globalThis.chrome as any).sessions = {
      getRecentlyClosed: async () => entries.map((e) => ({ tab: { ...e, sessionId: "s1" } })),
    };
    const r = await runAction("recent", ctx());
    expect(r?.acted).toBe(false);
    expect(r?.results).toHaveLength(1);
    expect(r?.message).toBeUndefined();
  });

  it("says so when there is nothing recently closed", async () => {
    (globalThis.chrome as any).sessions = { getRecentlyClosed: async () => [] };
    const r = await runAction("recent", ctx());
    expect(r?.message).toBe("No recently closed tabs");
    expect(r?.results).toEqual([]);
  });
});

describe("/restore", () => {
  it("restores the most recent session", async () => {
    const restore = vi.fn(async () => {});
    (globalThis.chrome as any).sessions = {
      getRecentlyClosed: async () => [{ tab: { sessionId: "abc" } }],
      restore,
    };
    expect((await runAction("restore", ctx()))?.message).toBe("Restored last closed");
    expect(restore).toHaveBeenCalledWith("abc");
  });

  it("reports an empty session list", async () => {
    (globalThis.chrome as any).sessions = { getRecentlyClosed: async () => [] };
    expect((await runAction("restore", ctx()))?.message).toBe("No recently closed tabs");
  });
});

describe("/sidepanel", () => {
  it("explains itself when the API is missing", async () => {
    expect(await runAction("sidepanel", ctx())).toEqual({
      message: "Side Panel not available (Chrome 114+)",
      acted: true,
    });
  });

  it("opens against the current window", async () => {
    const open = vi.fn(async () => {});
    (globalThis.chrome as any).sidePanel = { open };
    expect((await runAction("sidepanel", ctx({ currentWindowId: 42 })))?.message).toBe("Opened Side Panel");
    expect(open).toHaveBeenCalledWith({ windowId: 42 });
  });
});

describe("/branch and /branchup", () => {
  // The journey these exist for: a listing page, the articles opened from it, and a sub-link
  // opened from one of those articles.
  const hn = () => {
    stub.windows = [{ id: 1 }];
    stub.openTabs = [
      { id: 1, url: "https://news.ycombinator.com", title: "Hacker News", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 3, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 2 },
      { id: 4, url: "https://b.com/deep", pinned: false, windowId: 1, groupId: -1, index: 3, active: true },
    ];
    stub.sessionData.tabParents = { 2: 1, 3: 1, 4: 3 };
  };
  const groupOf = (id: number) => stub.openTabs.find((t) => t.id === id)!.groupId;
  const membersWith = (id: number) =>
    stub.openTabs.filter((t) => t.groupId === groupOf(id)).map((t) => t.id).sort();

  it("/branch gathers the active tab's whole subtree", async () => {
    hn();
    stub.openTabs.find((t) => t.id === 4)!.active = false;
    stub.openTabs.find((t) => t.id === 3)!.active = true;
    const r = await ACTION_HANDLERS.branch(ctx());
    expect(r.acted).toBe(true);
    expect(membersWith(3)).toEqual([3, 4]);
  });

  it("/branchup starts one level up from the active tab", async () => {
    hn();
    await ACTION_HANDLERS.branchup(ctx());
    expect(membersWith(4)).toEqual([3, 4]);
  });

  // The command advertises that running it again climbs. It only does if it walks past the
  // ancestors the previous run pulled into the active tab's group.
  it("/branchup climbs a level each time it is run", async () => {
    hn();
    await ACTION_HANDLERS.branchup(ctx());
    expect(membersWith(4)).toEqual([3, 4]);

    await ACTION_HANDLERS.branchup(ctx());
    expect(membersWith(4)).toEqual([1, 2, 3, 4]);

    // Third run: the whole chain is now inside the group, so the walk consumes it and stops.
    // "No parent tab" would be false here — tab 1 is a parent, it is just already gathered.
    const r = await ACTION_HANDLERS.branchup(ctx());
    expect(r.acted).toBe(false);
    expect(r.message).toMatch(/already gathered/);
  });

  it("names a pinned root as the reason rather than blaming what it opened", async () => {
    hn();
    stub.openTabs = stub.openTabs.filter((t) => t.id !== 2 && t.id !== 4);
    stub.openTabs.find((t) => t.id === 1)!.pinned = true;
    stub.openTabs.find((t) => t.id === 3)!.active = true;
    stub.sessionData.tabParents = { 3: 1 };
    const r = await ACTION_HANDLERS.branchup(ctx());
    expect(r.acted).toBe(false);
    expect(r.message).toMatch(/pinned/);
  });

  it("still reports 'opened nothing' for an unpinned lone tab", async () => {
    hn();
    stub.openTabs = stub.openTabs.filter((t) => t.id === 4);
    stub.sessionData.tabParents = {};
    const r = await ACTION_HANDLERS.branch(ctx());
    expect(r.message).toMatch(/No tabs were opened/);
  });

  it("uses the trailing text as the group title", async () => {
    hn();
    // Stand on the listing page, not the leaf article, so there is a branch to name.
    stub.openTabs.find((t) => t.id === 4)!.active = false;
    stub.openTabs.find((t) => t.id === 1)!.active = true;
    await ACTION_HANDLERS.branch(ctx({ query: "Morning read" }));
    expect(stub.groupUpdates.at(-1)!.title).toBe("Morning read");
    expect(membersWith(1)).toEqual([1, 2, 3, 4]);
  });

  it("falls back to the root tab's title when no name is given", async () => {
    hn();
    stub.openTabs.find((t) => t.id === 4)!.active = false;
    stub.openTabs.find((t) => t.id === 1)!.active = true;
    await ACTION_HANDLERS.branch(ctx());
    expect(stub.groupUpdates.at(-1)!.title).toBe("Hacker News");
  });

  // Chrome drops tabs opened from a grouped tab into that group by itself, so the second run
  // is mostly about strays. Rebuilding the group for them would cost its collapse state, its
  // colour and any saved-group identity — and would make Ctrl+Z pop a no-op.
  describe("running /branch again", () => {
    const gathered = () => {
      hn();
      stub.openTabs.find((t) => t.id === 4)!.active = false;
      stub.openTabs.find((t) => t.id === 1)!.active = true;
      for (const t of stub.openTabs) if ([1, 2, 3].includes(t.id)) t.groupId = 50;
      stub.groups = [{ id: 50, title: "Morning read", color: "pink", windowId: 1 }];
    };

    it("adds the tabs opened since to the same group", async () => {
      gathered();
      const r = await ACTION_HANDLERS.branch(ctx());
      expect(r.acted).toBe(true);
      expect(r.message).toMatch(/^Added 1 tab\(s\) to "Morning read"/);
      expect(groupOf(4)).toBe(50);
      expect(stub.groups).toHaveLength(1);
    });

    it("says so and touches nothing when the branch is already whole", async () => {
      gathered();
      stub.openTabs.find((t) => t.id === 4)!.groupId = 50;
      const before = peekUndo();
      const r = await ACTION_HANDLERS.branch(ctx());
      expect(r.acted).toBe(false);
      expect(r.message).toMatch(/already gathered in "Morning read"/);
      expect(peekUndo()).toBe(before);
      expect(stub.moves).toEqual([]);
    });

    it("renames the group when the only change asked for is a name", async () => {
      gathered();
      stub.openTabs.find((t) => t.id === 4)!.groupId = 50;
      const r = await ACTION_HANDLERS.branch(ctx({ query: "Evening read" }));
      expect(r.acted).toBe(true);
      expect(r.message).toMatch(/^Renamed branch group to "Evening read"/);
      expect(stub.groupUpdates).toEqual([{ id: 50, title: "Evening read" }]);
    });

    it("still builds a fresh group when the root sits in a group with strangers", async () => {
      gathered();
      // 9 is unrelated to the branch but auto-grouped alongside the listing page.
      stub.openTabs.push({ id: 9, url: "https://news.ycombinator.com/x", pinned: false, windowId: 1, groupId: 50, index: 4 });
      const r = await ACTION_HANDLERS.branch(ctx());
      expect(r.message).toMatch(/^Grouped 4 tab\(s\)/);
      expect(groupOf(1)).not.toBe(50);
      expect(groupOf(9)).toBe(50);
    });
  });

  // Chrome rejects tabs.group while a tab is being dragged. groupBranch groups before it moves
  // anything precisely so that rejection lands on an untouched strip.
  const twoWindowBranch = () => {
    stub.windows = [{ id: 1 }, { id: 2 }];
    stub.openTabs = [
      { id: 1, url: "https://news.ycombinator.com", title: "Hacker News", pinned: false, windowId: 1, groupId: -1, index: 0, active: true },
      { id: 2, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 4, url: "https://a.com/deep", pinned: false, windowId: 2, groupId: -1, index: 0 },
    ];
    stub.sessionData.tabParents = { 2: 1, 4: 2 };
  };

  it("mutates nothing when the group call is rejected outright", async () => {
    twoWindowBranch();
    stub.failGroup = true;

    await expect(ACTION_HANDLERS.branch(ctx())).rejects.toThrow();

    // The stray was never moved: grouping comes first, so the rejection costs nothing.
    expect(stub.openTabs.find((t) => t.id === 4)!.windowId).toBe(2);
    expect(stub.openTabs.every((t) => t.groupId === -1)).toBe(true);
  });

  // The residual half-state: the group exists, and the stray moved but never joined it. The
  // snapshot is taken before any of it so Ctrl+Z can still put that tab back — dropping the
  // entry on failure would discard the only record of a real mutation.
  it("leaves an undo entry that can recover a stray stranded mid-operation", async () => {
    twoWindowBranch();
    const realGroup = chrome.tabs.group;
    let calls = 0;
    // Succeed for the seed group, fail when the stray tries to join it.
    (chrome.tabs as unknown as { group: unknown }).group = async (opts: never) =>
      ++calls > 1 ? Promise.reject(new Error("Tabs cannot be edited right now")) : realGroup(opts);

    await expect(ACTION_HANDLERS.branch(ctx())).rejects.toThrow();
    (chrome.tabs as unknown as { group: unknown }).group = realGroup;

    expect(stub.openTabs.find((t) => t.id === 4)!.windowId).toBe(1); // the move did land
    // UndoEntry.data is `unknown`; the "group" entries are GroupAssignment[], which isn't exported.
    const data = peekUndo()?.data as { tabId: number; windowId?: number }[] | undefined;
    expect(data?.find((d) => d.tabId === 4)?.windowId).toBe(2); // and undo can reverse it
  });

  // Guards snapshotBeforeGroup's cost. It snapshots every tab in every window, which looks
  // wasteful for a 3-tab branch — but grouping makes members contiguous and so displaces
  // non-members, and executeUndo rebuilds the strip by reinserting snapshotted tabs at their
  // recorded index. Scope the snapshot to branch members and the tabs it shoved aside have no
  // recorded home, so undo silently returns a different order than it started with.
  it("undo after a branch restores the strip exactly, including non-members", async () => {
    stub.windows = [{ id: 1 }];
    stub.openTabs = [1, 2, 3, 4, 5].map((id) => ({
      id, url: `https://s${id}.com`, title: `T${id}`,
      pinned: false, windowId: 1, groupId: -1, index: id - 1, active: id === 1,
    }));
    stub.sessionData.tabParents = { 3: 1, 5: 1 }; // branch {1,3,5} straddles 2 and 4

    await ACTION_HANDLERS.branch(ctx());
    expect(membersWith(1)).toEqual([1, 3, 5]);

    await executeUndo();
    const strip = [...stub.openTabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    expect(strip.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
    expect(strip.every((t) => t.groupId === -1)).toBe(true);
  });

  it("forms the group in the window the user is looking at, not the root's", async () => {
    stub.windows = [{ id: 1 }, { id: 2 }];
    stub.openTabs = [
      { id: 1, url: "https://news.ycombinator.com", title: "HN", pinned: false, windowId: 2, groupId: -1, index: 0 },
      { id: 2, url: "https://a.com", pinned: false, windowId: 2, groupId: -1, index: 1 },
      { id: 3, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 0, active: true },
    ];
    stub.sessionData.tabParents = { 2: 1, 3: 1 };

    const r = await ACTION_HANDLERS.branchup(ctx());
    expect(r.acted).toBe(true);
    // The active tab must not be dragged into a window the user was not looking at.
    expect(stub.openTabs.find((t) => t.id === 3)!.windowId).toBe(1);
    expect(stub.openTabs.filter((t) => t.groupId === groupOf(3)).map((t) => t.id).sort()).toEqual([1, 2, 3]);
  });

  // The ignore list protects the group, not the automation — ungroupAll already honours it,
  // and a branch that dissolves a protected group is /ungroup wearing a different verb.
  it("leaves an ignore-listed group intact and says it did", async () => {
    hn();
    stub.localData.rulesConfig = { ignoreGroupNames: [{ pattern: "Work", enabled: true }] };
    stub.openTabs.find((t) => t.id === 2)!.groupId = 50;
    stub.groups = [{ id: 50, title: "Work", windowId: 1 }];
    stub.openTabs.find((t) => t.id === 4)!.active = false;
    stub.openTabs.find((t) => t.id === 1)!.active = true;

    const r = await ACTION_HANDLERS.branch(ctx());
    expect(r.acted).toBe(true);
    expect(stub.openTabs.find((t) => t.id === 2)!.groupId).toBe(50); // still in "Work"
    expect(membersWith(1)).toEqual([1, 3, 4]);
    expect(r.message).toMatch(/1 left in protected group/);
  });

  // A pinned member is not a protected-group member, and telling the user to go look for a
  // group that does not exist in their profile is worse than saying nothing.
  it("names pinning as the reason for a pinned member, not a protected group", async () => {
    hn();
    stub.groups = [];
    stub.openTabs.find((t) => t.id === 2)!.pinned = true;
    stub.openTabs.find((t) => t.id === 4)!.active = false;
    stub.openTabs.find((t) => t.id === 1)!.active = true;

    const r = await ACTION_HANDLERS.branch(ctx());
    expect(r.message).toMatch(/1 pinned/);
    expect(r.message).not.toMatch(/protected group/);
  });

  it("does not count the left-out root a second time as a skipped member", async () => {
    hn();
    stub.groups = [];
    stub.openTabs = stub.openTabs.filter((t) => t.id !== 2 && t.id !== 9);
    stub.openTabs.find((t) => t.id === 1)!.pinned = true;
    stub.sessionData.tabParents = { 3: 1, 4: 1 };

    const r = await ACTION_HANDLERS.branchup(ctx());
    expect(r.message).toMatch(/root tab left out/);
    expect(r.message).not.toMatch(/pinned|protected/);
  });

  // The parent is sitting right there in the same group; claiming it was never opened from
  // another tab contradicts what the user can see, and there is no third state to recover to.
  it("says the branch is already gathered rather than denying the parent exists", async () => {
    hn();
    stub.groups = [{ id: 70, title: "Reading", windowId: 1 }];
    for (const id of [1, 3, 4]) stub.openTabs.find((t) => t.id === id)!.groupId = 70;

    const r = await ACTION_HANDLERS.branchup(ctx());
    expect(r.acted).toBe(false);
    expect(r.message).toMatch(/already gathered/);
    expect(r.message).not.toMatch(/wasn't opened from another/);
  });

  it("still denies a parent for a tab that genuinely has none", async () => {
    hn();
    stub.openTabs.find((t) => t.id === 4)!.active = false;
    stub.openTabs.find((t) => t.id === 1)!.active = true;

    const r = await ACTION_HANDLERS.branchup(ctx());
    expect(r.message).toMatch(/wasn't opened from another/);
  });

  it("leaves a shared group intact — Chrome refuses edits to one", async () => {
    hn();
    stub.openTabs.find((t) => t.id === 3)!.groupId = 60;
    stub.groups = [{ id: 60, title: "Shared", windowId: 1, shared: true } as never];
    stub.openTabs.find((t) => t.id === 4)!.active = false;
    stub.openTabs.find((t) => t.id === 1)!.active = true;

    const r = await ACTION_HANDLERS.branch(ctx());
    expect(stub.openTabs.find((t) => t.id === 3)!.groupId).toBe(60);
    expect(r.message).toMatch(/left in protected group/);
  });
});

describe("mergeStatus", () => {
  it("distinguishes a clean merge from one that lost groups", () => {
    expect(mergeStatus({ moved: 0, groupsFailed: 0 })).toBe("Nothing to merge");
    expect(mergeStatus({ moved: 3, groupsFailed: 0 })).toBe("Merged 3 tab(s)");
    expect(mergeStatus({ moved: 3, groupsFailed: 2 }))
      .toBe("Merged 3 tab(s) — 2 group(s) could not be rebuilt");
  });
});


describe("/parent", () => {
  const hn = () => {
    stub.windows = [{ id: 1 }];
    stub.openTabs = [
      { id: 1, url: "https://news.ycombinator.com", title: "Hacker News", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 3, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
      { id: 4, url: "https://b.com/deep", pinned: false, windowId: 1, groupId: -1, index: 2, active: true },
    ];
    stub.sessionData.tabParents = { 3: 1, 4: 3 };
  };

  it("switches to the tab that opened the active one and closes the popup", async () => {
    hn();
    const r = await ACTION_HANDLERS.parent(ctx());
    expect(r.closePopup).toBe(true);
    expect(stub.tabUpdates.at(-1)).toEqual({ id: 3, active: true });
  });

  it("reaches a parent whose opener link Chrome has already forgotten", async () => {
    // Chrome reports no openerTabId anywhere; only the recorded map knows.
    hn();
    expect(stub.openTabs.every((t) => (t as { openerTabId?: number }).openerTabId === undefined)).toBe(true);
    await ACTION_HANDLERS.parent(ctx());
    expect(stub.tabUpdates.at(-1)!.id).toBe(3);
  });

  it("says when the tab was not opened from another", async () => {
    hn();
    stub.openTabs.find((t) => t.id === 4)!.active = false;
    stub.openTabs.find((t) => t.id === 1)!.active = true;
    const r = await ACTION_HANDLERS.parent(ctx());
    expect(r.acted).toBe(false);
    expect(r.closePopup).toBeUndefined();
    expect(r.message).toMatch(/No parent tab/);
    expect(stub.tabUpdates).toEqual([]);
  });
});
