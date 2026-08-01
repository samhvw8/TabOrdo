import { describe, it, expect, beforeEach, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { popUndo, peekUndo } from "./undo.ts";
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

describe("mergeStatus", () => {
  it("distinguishes a clean merge from one that lost groups", () => {
    expect(mergeStatus({ moved: 0, groupsFailed: 0 })).toBe("Nothing to merge");
    expect(mergeStatus({ moved: 3, groupsFailed: 0 })).toBe("Merged 3 tab(s)");
    expect(mergeStatus({ moved: 3, groupsFailed: 2 }))
      .toBe("Merged 3 tab(s) — 2 group(s) could not be rebuilt");
  });
});
