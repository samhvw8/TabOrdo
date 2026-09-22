import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installChromeStub, type ChromeStub, type StubTab } from "./testing/chrome-stub.ts";
import {
  createAutomationState, planAutoUngroup, autoUngroupSingleTabGroups, onTabNavigated, onTabRegrouped,
  switchToExisting, followPinState, GROUP_SETTLE_MS, NEW_TAB_GRACE_MS, SORT_SETTLE_MS, type AutomationState,
} from "./automation.ts";
import { acquireBulkLock, newLockOwner } from "./bulklock.ts";
import { getActionLog } from "./actionLog.ts";
import { hasUndo } from "./undo.ts";
import type { RulesConfig } from "./rules.ts";

// The service worker's listener bodies. Nothing imported the worker, so none of this was tested
// until it moved here.

let stub: ChromeStub;
let state: AutomationState;

beforeEach(() => {
  stub = installChromeStub();
  state = createAutomationState();
});

afterEach(() => {
  vi.useRealTimers();
});

function setConfig(over: Partial<RulesConfig>): void {
  stub.localData.rulesConfig = {
    rules: [], autoGroup: false, autoUngroup: false, useRules: false, autoSort: false, autoPinFollow: false,
    autoDiscard: false, switchToExisting: false, useAI: false, ignorePatterns: [], ignoreGroupNames: [], sortRules: [],
    ...over,
  };
}

const tab = (t: Partial<StubTab> & { id: number }): StubTab =>
  ({ url: "https://x.com", pinned: false, windowId: 1, groupId: -1, index: 0, ...t });

const asTab = (t: StubTab) => t as unknown as chrome.tabs.Tab;
const asTabs = (ts: StubTab[]) => ts as unknown as chrome.tabs.Tab[];
const asGroups = (gs: object[]) => gs as chrome.tabGroups.TabGroup[];

function config(over: Partial<RulesConfig> = {}): RulesConfig {
  return {
    rules: [], autoGroup: false, autoUngroup: false, useRules: false, autoSort: false, autoPinFollow: false,
    autoDiscard: false, switchToExisting: false, useAI: false, ignorePatterns: [], ignoreGroupNames: [], sortRules: [],
    ...over,
  };
}

describe("planAutoUngroup", () => {
  const now = 1_000_000;

  it("dissolves a titled group that is down to one tab", () => {
    const plan = planAutoUngroup(
      asTabs([tab({ id: 1, groupId: 10 }), tab({ id: 2, groupId: 20 }), tab({ id: 3, groupId: 20 })]),
      asGroups([{ id: 10, title: "news" }, { id: 20, title: "docs" }]),
      config(), new Map(), now
    );
    expect(plan).toEqual({ ungroup: [{ tabId: 1, title: "news" }] });
  });

  // Other tools make untitled groups; dissolving theirs started a delete-and-recreate loop.
  it("leaves untitled, shared, rule-named and ignored-name groups alone", () => {
    const plan = planAutoUngroup(
      asTabs([tab({ id: 1, groupId: 10 }), tab({ id: 2, groupId: 20 }), tab({ id: 3, groupId: 30 }), tab({ id: 4, groupId: 40 })]),
      asGroups([{ id: 10, title: "" }, { id: 20, title: "team", shared: true }, { id: 30, title: "Work" }, { id: 40, title: "keep" }]),
      config({
        useRules: true,
        rules: [{ id: "r", name: "Work", color: "blue", patterns: [] }],
        ignoreGroupNames: [{ pattern: "keep", enabled: true }],
      }),
      new Map(), now
    );
    expect(plan.ungroup).toEqual([]);
  });

  it("dissolves a rule-named group once rules are off", () => {
    const plan = planAutoUngroup(
      asTabs([tab({ id: 3, groupId: 30 })]),
      asGroups([{ id: 30, title: "Work" }]),
      config({ rules: [{ id: "r", name: "Work", color: "blue", patterns: [] }] }),
      new Map(), now
    );
    expect(plan.ungroup).toEqual([{ tabId: 3, title: "Work" }]);
  });

  it("holds a group still settling, and says when the first one settles", () => {
    const plan = planAutoUngroup(
      asTabs([tab({ id: 1, groupId: 10 }), tab({ id: 2, groupId: 20 })]),
      asGroups([{ id: 10, title: "a" }, { id: 20, title: "b" }]),
      config(),
      new Map([[10, now - 500], [20, now - 1500]]),
      now
    );
    expect(plan).toEqual({ ungroup: [], settleInMs: GROUP_SETTLE_MS - 1500 });
  });
});

describe("autoUngroupSingleTabGroups", () => {
  beforeEach(() => {
    setConfig({ autoUngroup: true });
    stub.openTabs = [tab({ id: 1, groupId: 10 })];
    stub.groups = [{ id: 10, title: "news", windowId: 1 }];
  });

  it("ungroups the lone tab, marks it as our own write and logs it", async () => {
    await autoUngroupSingleTabGroups(state, 1);
    expect(stub.ungroupedIds).toEqual([1]);
    expect(state.selfWrites.has(1)).toBe(true);
    expect((await getActionLog())[0]).toMatchObject({ action: "Ungrouped", detail: '"news" (single tab left)' });
  });

  it("stands down while a bulk operation holds the lock", async () => {
    await acquireBulkLock(newLockOwner(), 60_000);
    await autoUngroupSingleTabGroups(state, 1);
    expect(stub.ungroupedIds).toEqual([]);
  });

  it("comes back for a young group once it has settled", async () => {
    vi.useFakeTimers();
    state.groupCreatedAt.set(10, Date.now());
    await autoUngroupSingleTabGroups(state, 1);
    expect(stub.ungroupedIds).toEqual([]);
    await vi.advanceTimersByTimeAsync(GROUP_SETTLE_MS + 150);
    expect(stub.ungroupedIds).toEqual([1]);
  });
});

describe("onTabNavigated: auto-group", () => {
  const navigate = (t: StubTab) => onTabNavigated(state, t.id, { url: t.url }, asTab(t));

  describe("with a rule", () => {
    const rules = [{ id: "r", name: "Work", color: "blue" as const, patterns: ["corp.com"] }];

    beforeEach(() => setConfig({ autoGroup: true, useRules: true, rules }));

    it("joins the window's group named after the rule", async () => {
      stub.openTabs = [tab({ id: 1, url: "https://corp.com/a", groupId: 10 }), tab({ id: 2, url: "https://corp.com/b", index: 1 })];
      stub.groups = [{ id: 10, title: "Work", windowId: 1 }];
      await navigate(stub.openTabs[1]);
      expect(stub.openTabs.find((t) => t.id === 2)!.groupId).toBe(10);
      expect(state.selfWrites.has(2)).toBe(true);
    });

    // A rule makes a group of one on purpose; a domain never does.
    it("makes a one-tab group titled and coloured after the rule when there is none", async () => {
      stub.openTabs = [tab({ id: 2, url: "https://corp.com/b" })];
      await navigate(stub.openTabs[0]);
      const gid = stub.openTabs[0].groupId;
      expect(gid).not.toBe(-1);
      expect(stub.groupUpdates).toEqual([{ id: gid, title: "Work", color: "blue" }]);
    });

    it("does not join a shared group of that name", async () => {
      stub.openTabs = [tab({ id: 1, url: "https://corp.com/a", groupId: 10 }), tab({ id: 2, url: "https://corp.com/b", index: 1 })];
      stub.groups = [{ id: 10, title: "Work", windowId: 1, shared: true } as never];
      await navigate(stub.openTabs[1]);
      expect([-1, 10]).not.toContain(stub.openTabs.find((t) => t.id === 2)!.groupId);
    });
  });

  describe("by domain", () => {
    beforeEach(() => setConfig({ autoGroup: true }));

    it("joins the group titled for the site", async () => {
      stub.openTabs = [tab({ id: 1, url: "https://github.com/a", groupId: 10 }), tab({ id: 2, url: "https://github.com/b", index: 1 })];
      stub.groups = [{ id: 10, title: "github", windowId: 1 }];
      await navigate(stub.openTabs[1]);
      expect(stub.openTabs.find((t) => t.id === 2)!.groupId).toBe(10);
    });

    it("makes a group with another loose tab of the site", async () => {
      stub.openTabs = [tab({ id: 1, url: "https://github.com/a" }), tab({ id: 2, url: "https://github.com/b", index: 1 })];
      await navigate(stub.openTabs[1]);
      const [a, b] = stub.openTabs;
      expect(a.groupId).not.toBe(-1);
      expect(b.groupId).toBe(a.groupId);
      expect(stub.groupUpdates[0]).toMatchObject({ id: a.groupId, title: "github" });
      expect(state.selfWrites.has(1) && state.selfWrites.has(2)).toBe(true);
    });

    it("makes no group for the only tab of a site", async () => {
      stub.openTabs = [tab({ id: 2, url: "https://github.com/b" })];
      await navigate(stub.openTabs[0]);
      expect(stub.openTabs[0].groupId).toBe(-1);
    });

    // An ignored URL opts out of grouping only: auto-ungroup still gets its look at the window.
    it("leaves an ignored URL loose but still schedules auto-ungroup", async () => {
      setConfig({ autoGroup: true, autoUngroup: true, ignorePatterns: [{ pattern: "github.com", enabled: true }] });
      stub.openTabs = [tab({ id: 1, url: "https://github.com/a" }), tab({ id: 2, url: "https://github.com/b", index: 1 })];
      await navigate(stub.openTabs[1]);
      expect(stub.openTabs.every((t) => t.groupId === -1)).toBe(true);
      expect(state.ungroupTimers.has(1)).toBe(true);
    });
  });

  describe("guards", () => {
    beforeEach(() => {
      setConfig({ autoGroup: true });
      stub.openTabs = [tab({ id: 1, url: "https://github.com/a" }), tab({ id: 2, url: "https://github.com/b", index: 1 })];
    });

    it("leaves a Chrome-pinned tab alone", async () => {
      stub.openTabs[1].pinned = true;
      await navigate(stub.openTabs[1]);
      expect(stub.openTabs.every((t) => t.groupId === -1)).toBe(true);
    });

    it("stands down while a bulk operation holds the lock", async () => {
      await acquireBulkLock(newLockOwner(), 60_000);
      await navigate(stub.openTabs[1]);
      expect(stub.openTabs.every((t) => t.groupId === -1)).toBe(true);
    });

    // The grace lets another extension group its own new tab first; the re-read after it is
    // what stops TabOrdo taking the tab back out.
    it("waits out a new tab's grace, then leaves it if someone grouped it meanwhile", async () => {
      vi.useFakeTimers();
      state.recentTabs.set(2, Date.now());
      const done = navigate(stub.openTabs[1]);
      await vi.advanceTimersByTimeAsync(NEW_TAB_GRACE_MS - 50);
      expect(stub.groupUpdates).toEqual([]);
      stub.openTabs[1].groupId = 77;
      await vi.advanceTimersByTimeAsync(50);
      await done;
      expect(stub.openTabs[0].groupId).toBe(-1);
      expect(stub.openTabs[1].groupId).toBe(77);
    });
  });
});

describe("onTabNavigated: auto-sort", () => {
  // organizeWindow reads the window's groups once per run, so this counts sorts per window.
  function countSorts(): Map<number, number> {
    const runs = new Map<number, number>();
    const query = chrome.tabGroups.query.bind(chrome.tabGroups);
    (chrome.tabGroups as { query: unknown }).query = (q: chrome.tabGroups.QueryInfo) => {
      if (q.windowId !== undefined) runs.set(q.windowId, (runs.get(q.windowId) ?? 0) + 1);
      return query(q);
    };
    return runs;
  }
  const complete = (t: StubTab) => onTabNavigated(state, t.id, { status: "complete" }, asTab(t));

  it("sorts the window once a tab finishes loading and the burst settles", async () => {
    vi.useFakeTimers();
    setConfig({ autoSort: true });
    stub.openTabs = [tab({ id: 1, url: "https://b.com", index: 0 }), tab({ id: 2, url: "https://a.com", index: 1 })];
    await complete(stub.openTabs[0]);
    expect(stub.moves).toEqual([]);
    await vi.advanceTimersByTimeAsync(SORT_SETTLE_MS);
    expect([...stub.openTabs].sort((x, y) => x.index! - y.index!).map((t) => t.id)).toEqual([2, 1]);
  });

  // Chrome does not await listeners, so ten tabs finishing together used to start ten sorts of
  // the same window at once, each moving blocks the others had just moved.
  it("sorts a burst of loads in one window once", async () => {
    vi.useFakeTimers();
    setConfig({ autoSort: true });
    stub.openTabs = Array.from({ length: 10 }, (_, i) => tab({ id: i + 1, url: `https://s${9 - i}.com`, index: i }));
    const runs = countSorts();
    await Promise.all(stub.openTabs.map(complete));
    await vi.advanceTimersByTimeAsync(SORT_SETTLE_MS);
    expect(runs.get(1)).toBe(1);
  });

  it("sorts each window of a burst once", async () => {
    vi.useFakeTimers();
    setConfig({ autoSort: true });
    stub.openTabs = [tab({ id: 1, windowId: 1 }), tab({ id: 2, windowId: 1 }), tab({ id: 3, windowId: 2 })];
    const runs = countSorts();
    await Promise.all(stub.openTabs.map(complete));
    await vi.advanceTimersByTimeAsync(SORT_SETTLE_MS);
    expect([runs.get(1), runs.get(2)]).toEqual([1, 1]);
  });

  it("runs one follow-up, not one per load, for loads that land while a sort is running", async () => {
    vi.useFakeTimers();
    setConfig({ autoSort: true });
    stub.openTabs = [tab({ id: 1, url: "https://b.com", index: 0 }), tab({ id: 2, url: "https://a.com", index: 1 })];
    const runs = countSorts();
    const move = chrome.tabs.move.bind(chrome.tabs);
    (chrome.tabs as { move: unknown }).move = async (...a: Parameters<typeof move>) => {
      await new Promise((r) => setTimeout(r, 100));
      return move(...a);
    };
    await complete(stub.openTabs[0]);
    await vi.advanceTimersByTimeAsync(SORT_SETTLE_MS + 10); // first sort is now inside its slow move
    await complete(stub.openTabs[1]);
    await complete(stub.openTabs[0]);
    await vi.advanceTimersByTimeAsync(SORT_SETTLE_MS * 4);
    expect(runs.get(1)).toBe(2);
  });

  // A page that finished loading before auto-group put it in its group would otherwise stay at
  // the group's end until some other tab in the window loaded.
  it("sorts after auto-group moves a tab into a group", async () => {
    vi.useFakeTimers();
    setConfig({ autoGroup: true, autoSort: true });
    stub.openTabs = [tab({ id: 1, url: "https://github.com/z", groupId: 10 }), tab({ id: 2, url: "https://github.com/a", index: 1 })];
    stub.groups = [{ id: 10, title: "github", windowId: 1 }];
    await onTabNavigated(state, 2, { url: "https://github.com/a" }, asTab(stub.openTabs[1]));
    const runs = countSorts(); // from here: grouping itself also reads the window's groups
    await vi.advanceTimersByTimeAsync(SORT_SETTLE_MS);
    expect(stub.openTabs[1].groupId).toBe(10);
    expect(runs.get(1)).toBe(1);
  });

  it("skips the sort when a bulk action holds the lock as the timer fires", async () => {
    vi.useFakeTimers();
    setConfig({ autoSort: true });
    stub.openTabs = [tab({ id: 1, url: "https://b.com", index: 0 }), tab({ id: 2, url: "https://a.com", index: 1 })];
    await complete(stub.openTabs[0]);
    await acquireBulkLock(newLockOwner(), 60_000);
    await vi.advanceTimersByTimeAsync(SORT_SETTLE_MS);
    expect(stub.moves).toEqual([]);
  });

  it("does not sort on a URL change alone", async () => {
    setConfig({ autoSort: true });
    stub.openTabs = [tab({ id: 1, url: "https://b.com", index: 0 }), tab({ id: 2, url: "https://a.com", index: 1 })];
    await onTabNavigated(state, 1, { url: "https://b.com" }, asTab(stub.openTabs[0]));
    expect(stub.moves).toEqual([]);
  });
});

describe("onTabRegrouped", () => {
  beforeEach(() => setConfig({ autoUngroup: true }));

  it("schedules auto-ungroup for a group change someone else made", async () => {
    await onTabRegrouped(state, 1, { groupId: 10 }, asTab(tab({ id: 1 })));
    expect(state.ungroupTimers.has(1)).toBe(true);
  });

  it("ignores the echo of our own group change", async () => {
    state.selfWrites.mark([1]);
    await onTabRegrouped(state, 1, { groupId: 10 }, asTab(tab({ id: 1 })));
    expect(state.ungroupTimers.has(1)).toBe(false);
  });
});

describe("switchToExisting", () => {
  beforeEach(() => {
    setConfig({ switchToExisting: true });
    stub.windows = [{ id: 1 }, { id: 2 }];
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com/x", windowId: 2, index: 0, lastAccessed: 5 }),
      tab({ id: 2, url: "https://a.com/x", index: 0, active: true }),
    ];
  });

  it("sends a new foreground tab to the open copy and closes it, with no undo entry", async () => {
    state.recentTabs.set(2, Date.now());
    await switchToExisting(state, 2, { url: "https://a.com/x" }, asTab(stub.openTabs[1]));
    expect(stub.tabUpdates).toContainEqual({ id: 1, active: true });
    expect(stub.removedIds).toEqual([2]);
    expect(await hasUndo()).toBe(false);
  });

  it("leaves a tab that is not new", async () => {
    await switchToExisting(state, 2, { url: "https://a.com/x" }, asTab(stub.openTabs[1]));
    expect(stub.removedIds).toEqual([]);
  });
});

describe("followPinState", () => {
  beforeEach(() => {
    setConfig({ autoPinFollow: true });
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com", pinned: true }),
      tab({ id: 2, url: "https://a.com", index: 1 }),
      tab({ id: 3, url: "https://a.com", index: 2 }),
      tab({ id: 4, url: "https://b.com", index: 3 }),
    ];
  });

  it("gives every other tab with the same URL the new pin state", async () => {
    await followPinState(state, 1, { pinned: true }, asTab(stub.openTabs[0]));
    expect(stub.tabUpdates).toEqual([{ id: 2, pinned: true }, { id: 3, pinned: true }]);
    expect(stub.openTabs.find((t) => t.id === 4)!.pinned).toBe(false);
  });

  it("does nothing with the toggle off", async () => {
    setConfig({ autoPinFollow: false });
    await followPinState(state, 1, { pinned: true }, asTab(stub.openTabs[0]));
    expect(stub.tabUpdates).toEqual([]);
  });

  describe("with Chrome's onUpdated echoes wired up", () => {
    let runs: Promise<void>[];

    beforeEach(() => {
      runs = [];
      chrome.tabs.onUpdated.addListener((id, info, t) => {
        runs.push(followPinState(state, id, info, t as chrome.tabs.Tab));
      });
    });

    /** Let every echo arrive, and every run it started finish. */
    async function settle(): Promise<void> {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 0));
        await Promise.all(runs);
      }
    }

    // What the busy flag was for: each update's echo arrives as a pin change on a copy. A pass
    // started from one converges (the state already matches) but re-queries every tab in the
    // profile. The ledger marks the copies before updating them, so no echo starts one.
    it("starts no second pass from the echoes of its own updates", async () => {
      const query = vi.spyOn(chrome.tabs, "query");
      runs.push(followPinState(state, 1, { pinned: true }, asTab(stub.openTabs[0])));
      await settle();
      expect(stub.tabUpdates).toEqual([{ id: 2, pinned: true }, { id: 3, pinned: true }]);
      expect(runs).toHaveLength(3);
      expect(query).toHaveBeenCalledTimes(1);
    });

    // The flag also swallowed a real toggle on an unrelated tab that landed mid-pass.
    it("still follows a pin toggle on another tab that arrives while a pass is running", async () => {
      stub.openTabs.push(tab({ id: 5, url: "https://b.com", index: 4 }));
      const update = chrome.tabs.update;
      let userPinned = false;
      (chrome.tabs as { update: unknown }).update = async (id: number, props: chrome.tabs.UpdateProperties) => {
        if (!userPinned) {
          userPinned = true;
          await update(4, { pinned: true });
        }
        return update(id, props);
      };

      runs.push(followPinState(state, 1, { pinned: true }, asTab(stub.openTabs[0])));
      await settle();
      expect(stub.openTabs.find((t) => t.id === 5)!.pinned).toBe(true);
    });
  });
});
