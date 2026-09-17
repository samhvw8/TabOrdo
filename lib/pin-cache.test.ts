import { describe, it, expect, beforeEach, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";

let stub: ChromeStub;
let pin: typeof import("./pin.ts");

// pin.ts registers its storage.onChanged listener at module scope, so the stub has to exist
// before the module is evaluated. Reset and re-import per test, as rules-cache.test.ts does.
beforeEach(async () => {
  stub = installChromeStub();
  vi.resetModules();
  pin = await import("./pin.ts");
});

/** Let queued onChanged callbacks run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const entry = (over: Partial<import("./pin.ts").PinnedTabEntry> = {}) => ({
  id: "p1", url: "https://a.com", title: "A", tabId: 42, groupName: "Work", position: 0, ...over,
});

describe("lock list cache", () => {
  it("serves a second read of either list from cache instead of storage", async () => {
    await pin.getPinnedTabs();
    await pin.getPinnedGroups();
    stub.storageReads.length = 0;
    await pin.getPinnedTabs();
    await pin.getPinnedGroups();
    expect(stub.storageReads).toEqual([]);
  });

  it("hands out copies, so a caller editing its list does not edit the cache", async () => {
    stub.localData.pinnedTabs = [entry()];
    const first = await pin.getPinnedTabs();
    first[0].position = 7;
    first.push(entry({ id: "p2" }));
    expect(await pin.getPinnedTabs()).toEqual([entry()]);
  });

  it("drops the cache when another context writes the list", async () => {
    await pin.pinTab("https://a.com", "Work", 0, "A", 42);
    expect(await pin.getPinnedTabs()).toHaveLength(1);

    // Another realm writes directly, then its onChanged is delivered.
    await chrome.storage.local.set({ pinnedTabs: [] });
    await chrome.storage.local.set({ pinnedGroups: [{ id: "g", groupTitle: "Work", position: 0 }] });
    await settle();

    expect(await pin.getPinnedTabs()).toEqual([]);
    expect(await pin.getPinnedGroups()).toEqual([{ id: "g", groupTitle: "Work", position: 0 }]);
  });
});

describe("lock list cache — syncPinUrl", () => {
  beforeEach(async () => {
    stub.localData.pinnedTabs = [entry()];
    await pin.getPinnedTabs(); // warm
    stub.storageReads.length = 0;
  });

  // The background calls this for every url, title and status event of every tab.
  it("makes no storage read for a tab no lock tracks", async () => {
    expect(await pin.syncPinUrl(7, "https://elsewhere.com", "Elsewhere")).toBeNull();
    expect(stub.storageReads).toEqual([]);
  });

  it("makes no storage read for a locked tab whose url and title have not changed", async () => {
    expect(await pin.syncPinUrl(42, "https://a.com", `${pin.PIN_BADGE}A`)).toEqual(entry());
    expect(stub.storageReads).toEqual([]);
  });

  it("still follows a locked tab that navigated", async () => {
    const synced = await pin.syncPinUrl(42, "https://a.com/next", "Next");
    expect(synced).toMatchObject({ url: "https://a.com/next", title: "Next" });
    expect(stub.localData.pinnedTabs).toEqual([entry({ url: "https://a.com/next", title: "Next" })]);
  });
});

describe("lock list cache — failed writes", () => {
  it("does not leave a phantom list cached when the write rejects", async () => {
    await pin.getPinnedTabs();
    await pin.getPinnedGroups();
    stub.failWrites = true;

    await expect(pin.pinTab("https://a.com", "Work", 0)).rejects.toThrow();
    await expect(pin.pinGroup("Work", 0)).rejects.toThrow();

    // The writes never landed, so no onChanged will arrive to invalidate a cache primed ahead
    // of them. The next reads must go to storage and report the truth.
    stub.failWrites = false;
    expect(await pin.getPinnedTabs()).toEqual([]);
    expect(await pin.getPinnedGroups()).toEqual([]);
  });

  it("does not launder a failed write into storage on the next write", async () => {
    stub.failWrites = true;
    await expect(pin.pinTab("https://a.com", "Work", 0)).rejects.toThrow();
    stub.failWrites = false;

    await pin.pinTab("https://b.com", "Work", 0);

    expect((stub.localData.pinnedTabs as { url: string }[]).map((p) => p.url)).toEqual(["https://b.com"]);
  });
});

describe("lock list cache — cross-context writes", () => {
  // Mutating localData directly models the window where a sibling's write has landed but its
  // onChanged has not been delivered here yet. Each test warms this context's cache first, once
  // its own write's onChanged has come back — so a writer that read the cache would see a copy
  // without the sibling's entry.
  const warm = async () => {
    await settle();
    await pin.getPinnedTabs();
    await pin.getPinnedGroups();
  };

  it("does not revert a sibling context's lock that has not been delivered yet", async () => {
    await pin.pinTab("https://a.com", "Work", 0, "A", 42);
    await warm();
    stub.localData.pinnedTabs = [...(stub.localData.pinnedTabs as object[]), entry({ id: "sib", url: "https://sib.com", tabId: 43, position: 1 })];

    await pin.pinTab("https://c.com", "Work", 2);

    const urls = (stub.localData.pinnedTabs as { url: string }[]).map((p) => p.url);
    expect(urls).toEqual(["https://a.com", "https://sib.com", "https://c.com"]);
  });

  it("does not revert a sibling's lock when syncing a navigated tab", async () => {
    await pin.pinTab("https://a.com", "Work", 0, "A", 42);
    await warm();
    stub.localData.pinnedTabs = [...(stub.localData.pinnedTabs as object[]), entry({ id: "sib", url: "https://sib.com", tabId: 43, position: 1 })];

    await pin.syncPinUrl(42, "https://a.com/next", "Next");

    const urls = (stub.localData.pinnedTabs as { url: string }[]).map((p) => p.url);
    expect(urls).toEqual(["https://a.com/next", "https://sib.com"]);
  });

  it("does not revert a sibling's group lock on the next group lock", async () => {
    await pin.pinGroup("Work", 0);
    await warm();
    stub.localData.pinnedGroups = [...(stub.localData.pinnedGroups as object[]), { id: "sib", groupTitle: "Reading", position: 1 }];

    await pin.pinGroup("Zeta", 2);

    const titles = (stub.localData.pinnedGroups as { groupTitle: string }[]).map((p) => p.groupTitle);
    expect(titles).toEqual(["Work", "Reading", "Zeta"]);
  });
});
