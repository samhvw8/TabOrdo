import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub, type StubTab } from "./testing/chrome-stub.ts";
import { discardableTabs, discardInactiveTabs, discardIdleTabs, IDLE_DISCARD_MS } from "./discard.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
});

const tab = (t: Partial<StubTab> & { id: number }): StubTab =>
  ({ url: "https://x.com", pinned: false, windowId: 1, groupId: -1, index: 0, ...t });

const ids = (ts: chrome.tabs.Tab[]) => ts.map((t) => t.id);

const NOW = 10_000_000;

// The alarm, the "Discard inactive tabs" menu entry and bare /freeze each had their own copy of
// this filter, and the copies disagreed.
describe("discardableTabs", () => {
  const strip = [
    tab({ id: 1, active: true }),
    tab({ id: 2, pinned: true }),
    tab({ id: 3, audible: true }),
    tab({ id: 4, discarded: true }),
    tab({ id: 5 }),
    tab({ id: 6, frozen: true }),
  ] as unknown as chrome.tabs.Tab[];

  it("spares the active, Chrome-pinned, audible and already discarded tabs", () => {
    expect(ids(discardableTabs(strip))).toEqual([5, 6]);
  });

  // Frozen is the step before discarded in Chrome's tab lifecycle: the page is paused but still
  // holds its memory, which is what discarding is for.
  it("counts a tab Chrome froze as discardable", () => {
    expect(ids(discardableTabs(strip))).toContain(6);
  });

  it("with a cutoff, spares tabs used since it", () => {
    const tabs = [
      tab({ id: 1, lastAccessed: NOW - IDLE_DISCARD_MS - 1 }),
      tab({ id: 2, lastAccessed: NOW - IDLE_DISCARD_MS }),
      tab({ id: 3 }),
    ] as unknown as chrome.tabs.Tab[];
    // A tab Chrome reports no access time for counts as idle.
    expect(ids(discardableTabs(tabs, NOW - IDLE_DISCARD_MS))).toEqual([1, 3]);
  });
});

describe("discardInactiveTabs", () => {
  it("discards every discardable tab, however recently used, and says how many", async () => {
    stub.openTabs = [
      tab({ id: 1, active: true }),
      tab({ id: 2, lastAccessed: Date.now() }),
      tab({ id: 3, audible: true }),
    ];
    expect(await discardInactiveTabs()).toBe(1);
    expect(stub.discardedIds).toEqual([2]);
  });
});

describe("discardIdleTabs (the alarm)", () => {
  function setAutoDiscard(on: boolean) {
    stub.localData.rulesConfig = { rules: [], autoDiscard: on };
  }

  beforeEach(() => {
    const long = Date.now() - IDLE_DISCARD_MS - 60_000;
    stub.openTabs = [
      tab({ id: 1, lastAccessed: long }),
      tab({ id: 2, lastAccessed: Date.now() }),
      tab({ id: 3, lastAccessed: long, frozen: true }),
      tab({ id: 4, lastAccessed: long, pinned: true }),
    ];
  });

  it("discards the tabs idle past the cutoff", async () => {
    setAutoDiscard(true);
    await discardIdleTabs();
    expect(stub.discardedIds.sort()).toEqual([1, 3]);
  });

  it("does nothing with the Discard toggle off", async () => {
    setAutoDiscard(false);
    await discardIdleTabs();
    expect(stub.discardedIds).toEqual([]);
  });
});
