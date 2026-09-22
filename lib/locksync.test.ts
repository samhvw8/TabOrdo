import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { syncLockedTab } from "./locksync.ts";
import { getPinnedTabs, type PinnedTabEntry } from "./pin.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
});

const lock = (p: Partial<PinnedTabEntry>): PinnedTabEntry =>
  ({ id: "p", url: "https://a.com/1", groupName: "Read", position: 0, ...p });

const tab = (id: number, url: string, title = "T") => ({ id, url, title, pinned: false, windowId: 1, groupId: 5 }) as chrome.tabs.Tab;

describe("syncLockedTab", () => {
  it("carries a lock along when its tab navigates", async () => {
    stub.localData.pinnedTabs = [lock({ tabId: 7 })];
    await syncLockedTab(7, { url: "https://a.com/2" }, tab(7, "https://a.com/2", "Chapter 2"));
    expect(await getPinnedTabs(true)).toMatchObject([{ tabId: 7, url: "https://a.com/2", title: "Chapter 2" }]);
  });

  // A full navigation takes the injected badge down with the old page.
  it("puts the badge back once the locked tab has loaded", async () => {
    stub.localData.pinnedTabs = [lock({ tabId: 7 })];
    await syncLockedTab(7, { status: "complete" }, tab(7, "https://a.com/1"));
    expect(stub.scriptedIds).toEqual([7]);
  });

  it("leaves a tab no lock tracks alone", async () => {
    stub.localData.pinnedTabs = [lock({ tabId: 7 })];
    await syncLockedTab(8, { url: "https://b.com", status: "complete" }, tab(8, "https://b.com"));
    expect(stub.scriptedIds).toEqual([]);
    expect(await getPinnedTabs(true)).toMatchObject([{ url: "https://a.com/1" }]);
  });
});
