import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installChromeStub, type ChromeStub, type StubTab } from "./testing/chrome-stub.ts";
import {
  createLockSyncState, syncLockedTab, resetLocksAfterRestart, noticeTab, RECONCILE_SETTLE_MS, type LockSyncState,
} from "./locksync.ts";
import { getPinnedTabs, type PinnedTabEntry } from "./pin.ts";

let stub: ChromeStub;
let state: LockSyncState;

beforeEach(() => {
  stub = installChromeStub();
  state = createLockSyncState();
});

afterEach(() => {
  vi.useRealTimers();
});

const lock = (p: Partial<PinnedTabEntry>): PinnedTabEntry =>
  ({ id: "p", url: "https://a.com/1", groupName: "Read", position: 0, ...p });

const tab = (id: number, url: string, groupId = -1, title = "T"): StubTab =>
  ({ id, url, title, pinned: false, windowId: 1, groupId });

const asTab = (t: StubTab) => t as unknown as chrome.tabs.Tab;

describe("syncLockedTab", () => {
  it("carries a lock along when its tab navigates", async () => {
    stub.localData.pinnedTabs = [lock({ tabId: 7 })];
    await syncLockedTab(state, 7, { url: "https://a.com/2" }, asTab(tab(7, "https://a.com/2", 5, "Chapter 2")));
    expect(await getPinnedTabs()).toMatchObject([{ tabId: 7, url: "https://a.com/2", title: "Chapter 2" }]);
  });

  // A full navigation takes the injected badge down with the old page.
  it("puts the badge back once the locked tab has loaded", async () => {
    stub.localData.pinnedTabs = [lock({ tabId: 7 })];
    await syncLockedTab(state, 7, { status: "complete" }, asTab(tab(7, "https://a.com/1")));
    expect(stub.scriptedIds).toEqual([7]);
  });

  it("leaves a tab no lock tracks alone", async () => {
    stub.localData.pinnedTabs = [lock({ tabId: 7 })];
    await syncLockedTab(state, 8, { url: "https://b.com", status: "complete" }, asTab(tab(8, "https://b.com")));
    expect(stub.scriptedIds).toEqual([]);
    expect(await getPinnedTabs()).toMatchObject([{ url: "https://a.com/1" }]);
  });

  // It runs for every url, title and load event of every tab. The URL sync and the check for a
  // lock waiting on this URL each read the list, twice per event for a tab no lock tracks.
  it("reads the lock list once per event", async () => {
    stub.localData.pinnedTabs = [lock({ tabId: 7 })];
    stub.storageReads.length = 0;
    await syncLockedTab(state, 8, { url: "https://b.com", status: "complete" }, asTab(tab(8, "https://b.com")));
    expect(stub.storageReads.filter((r) => r.keys.includes("pinnedTabs"))).toHaveLength(1);
  });
});

// Tab ids do not survive a browser restart and the new session reuses them. Before, the only
// thing that matched a lock back to its tab was the Locks panel opening; until then a locked tab
// that navigated left its lock behind, and its badge stayed off.
describe("after a browser restart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Last session's lock held tab 7. Tab 7 is now some unrelated page; the locked page came
    // back as tab 12, in its group.
    stub.localData.pinnedTabs = [lock({ tabId: 7 })];
    stub.groups = [{ id: 5, title: "Read", windowId: 1 }];
    stub.openTabs = [tab(7, "https://unrelated.com", -1), tab(12, "https://a.com/1", 5)];
  });

  it("matches each lock to its restored tab and badges it", async () => {
    await resetLocksAfterRestart(state);
    await vi.advanceTimersByTimeAsync(RECONCILE_SETTLE_MS);
    expect((await getPinnedTabs())[0].tabId).toBe(12);
    expect(stub.scriptedIds).toEqual([12]);
  });

  it("then carries the lock along when the restored tab navigates", async () => {
    await resetLocksAfterRestart(state);
    await vi.advanceTimersByTimeAsync(RECONCILE_SETTLE_MS);
    await syncLockedTab(state, 12, { url: "https://a.com/2" }, asTab(tab(12, "https://a.com/2", 5)));
    expect((await getPinnedTabs())[0]).toMatchObject({ tabId: 12, url: "https://a.com/2" });
  });

  // The reset and the sync race: both are listeners Chrome does not await. A sync that read
  // the list before the reset landed would move the lock onto the unrelated tab 7.
  it("never lets last session's id pull the lock onto an unrelated tab", async () => {
    const reset = resetLocksAfterRestart(state);
    const sync = syncLockedTab(state, 7, { url: "https://unrelated.com/next" }, asTab(tab(7, "https://unrelated.com/next")));
    await Promise.all([reset, sync]);
    await vi.advanceTimersByTimeAsync(RECONCILE_SETTLE_MS);
    expect((await getPinnedTabs())[0]).toMatchObject({ tabId: 12, url: "https://a.com/1" });
  });

  // Session restore can create tabs after onStartup has fired and the first pass has run.
  it("matches a tab restored after the first pass once it is created", async () => {
    const late = tab(12, "https://a.com/1", 5);
    stub.openTabs = [tab(7, "https://unrelated.com", -1)];
    await resetLocksAfterRestart(state);
    await vi.advanceTimersByTimeAsync(RECONCILE_SETTLE_MS);
    expect((await getPinnedTabs())[0].tabId).toBeUndefined();

    stub.openTabs.push(late);
    await noticeTab(state, asTab(late));
    await vi.advanceTimersByTimeAsync(RECONCILE_SETTLE_MS);
    expect((await getPinnedTabs())[0].tabId).toBe(12);
  });

  it("matches a lock with no tab when a tab finishes loading its URL", async () => {
    stub.localData.pinnedTabs = [lock({})];
    await syncLockedTab(state, 12, { status: "complete" }, asTab(stub.openTabs[1]));
    await vi.advanceTimersByTimeAsync(RECONCILE_SETTLE_MS);
    expect((await getPinnedTabs())[0].tabId).toBe(12);
  });

  it("waits for a burst of new tabs to settle, then matches in one pass", async () => {
    stub.localData.pinnedTabs = [lock({})];
    await noticeTab(state, asTab(stub.openTabs[1]));
    await vi.advanceTimersByTimeAsync(RECONCILE_SETTLE_MS - 1);
    expect((await getPinnedTabs())[0].tabId).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect((await getPinnedTabs())[0].tabId).toBe(12);
  });

  it("does not look for a tab when no lock is waiting for its URL", async () => {
    stub.localData.pinnedTabs = [lock({ tabId: 12 })];
    const query = vi.spyOn(chrome.tabs, "query");
    await noticeTab(state, asTab(tab(20, "https://a.com/1")));
    await vi.advanceTimersByTimeAsync(RECONCILE_SETTLE_MS);
    expect(query).not.toHaveBeenCalled();
  });
});
