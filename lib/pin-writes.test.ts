import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import * as pin from "./pin.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
});

const entry = (over: Partial<pin.PinnedTabEntry> = {}) => ({
  id: "p1", url: "https://a.com", title: "A", tabId: 42, groupName: "Work", position: 0, ...over,
});

describe("syncPinUrl", () => {
  beforeEach(() => {
    stub.localData.pinnedTabs = [entry()];
  });

  it("follows a locked tab that navigated", async () => {
    const synced = await pin.syncPinUrl(42, "https://a.com/next", "Next");
    expect(synced).toMatchObject({ url: "https://a.com/next", title: "Next" });
    expect(stub.localData.pinnedTabs).toEqual([entry({ url: "https://a.com/next", title: "Next" })]);
  });

  it("writes nothing for a tab no lock tracks, or a locked tab that has not changed", async () => {
    let writes = 0;
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    (chrome.storage.local.set as unknown) = (items: Record<string, unknown>) => { writes++; return set(items); };
    expect(await pin.syncPinUrl(7, "https://elsewhere.com", "Elsewhere")).toBeNull();
    expect(await pin.syncPinUrl(42, "https://a.com", `${pin.PIN_BADGE}A`)).toEqual(entry());
    expect(writes).toBe(0);
  });
});

describe("lock list writes", () => {
  it("does not launder a failed write into storage on the next write", async () => {
    stub.failWrites = true;
    await expect(pin.pinTab("https://a.com", "Work", 0)).rejects.toThrow();
    stub.failWrites = false;

    await pin.pinTab("https://b.com", "Work", 0);

    expect((stub.localData.pinnedTabs as { url: string }[]).map((p) => p.url)).toEqual(["https://b.com"]);
  });

  // The worker, the popup and the side panel all write these lists. Mutating localData
  // directly models another context's write landing just before this one's.
  it("does not revert a lock another context has just written", async () => {
    await pin.pinTab("https://a.com", "Work", 0, "A", 42);
    stub.localData.pinnedTabs = [...(stub.localData.pinnedTabs as object[]), entry({ id: "sib", url: "https://sib.com", tabId: 43, position: 1 })];

    await pin.pinTab("https://c.com", "Work", 2);

    const urls = (stub.localData.pinnedTabs as { url: string }[]).map((p) => p.url);
    expect(urls).toEqual(["https://a.com", "https://sib.com", "https://c.com"]);
  });

  it("does not revert another context's lock when syncing a navigated tab", async () => {
    await pin.pinTab("https://a.com", "Work", 0, "A", 42);
    stub.localData.pinnedTabs = [...(stub.localData.pinnedTabs as object[]), entry({ id: "sib", url: "https://sib.com", tabId: 43, position: 1 })];

    await pin.syncPinUrl(42, "https://a.com/next", "Next");

    const urls = (stub.localData.pinnedTabs as { url: string }[]).map((p) => p.url);
    expect(urls).toEqual(["https://a.com/next", "https://sib.com"]);
  });

  it("does not revert another context's group lock on the next group lock", async () => {
    await pin.pinGroup("Work", 0);
    stub.localData.pinnedGroups = [...(stub.localData.pinnedGroups as object[]), { id: "sib", groupTitle: "Reading", position: 1 }];

    await pin.pinGroup("Zeta", 2);

    const titles = (stub.localData.pinnedGroups as { groupTitle: string }[]).map((p) => p.groupTitle);
    expect(titles).toEqual(["Work", "Reading", "Zeta"]);
  });
});
