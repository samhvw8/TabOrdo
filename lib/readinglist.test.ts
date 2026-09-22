import { describe, it, expect, beforeEach, vi } from "vitest";
import { addToReadingList, getReadingList, addTabsToReadingList } from "./readinglist.ts";

let entries: { url: string; title: string; hasBeenRead: boolean }[];

beforeEach(() => {
  entries = [];
  globalThis.chrome = {
    readingList: {
      addEntry: vi.fn(async (props: { url: string; title: string; hasBeenRead: boolean }) => {
        if (entries.some((e) => e.url === props.url)) throw new Error("duplicate");
        entries.push({ url: props.url, title: props.title, hasBeenRead: props.hasBeenRead });
      }),
      query: vi.fn(async () => entries),
    },
  } as unknown as typeof chrome;
});

describe("addToReadingList", () => {
  it("adds an entry with hasBeenRead=false", async () => {
    await addToReadingList("https://example.com", "Example");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ url: "https://example.com", title: "Example", hasBeenRead: false });
  });
});

describe("getReadingList", () => {
  it("returns all entries", async () => {
    entries.push({ url: "https://a.com", title: "A", hasBeenRead: false });
    entries.push({ url: "https://b.com", title: "B", hasBeenRead: true });
    const result = await getReadingList();
    expect(result).toHaveLength(2);
  });
});

describe("addTabsToReadingList", () => {
  it("adds multiple valid tabs, skips chrome:// URLs", async () => {
    const tabs = [
      { url: "https://a.com", title: "A" },
      { url: "chrome://settings", title: "Settings" },
      { url: "chrome-extension://abc/popup.html", title: "Ext" },
      { url: "https://b.com", title: "B" },
    ];
    const count = await addTabsToReadingList(tabs);
    expect(count).toBe(2);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.url)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("skips tabs with empty URLs", async () => {
    const count = await addTabsToReadingList([{ url: "", title: "Empty" }]);
    expect(count).toBe(0);
  });

  it("sends the adds together rather than one after another", async () => {
    const add = chrome.readingList.addEntry;
    let inFlight = 0;
    let most = 0;
    chrome.readingList.addEntry = (async (props: chrome.readingList.AddEntryOptions) => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      return add(props);
    }) as typeof chrome.readingList.addEntry;
    await addTabsToReadingList([{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }]);
    expect(most).toBe(2);
  });

  it("keeps adding past a rejected tab and counts only what was added", async () => {
    entries.push({ url: "https://b.com", title: "B", hasBeenRead: false });
    const count = await addTabsToReadingList([
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: "B" },
      { url: "https://c.com", title: "C" },
    ]);
    expect(count).toBe(2);
    expect(entries.map((e) => e.url).sort()).toEqual(["https://a.com", "https://b.com", "https://c.com"]);
  });

  it("silently handles duplicate errors", async () => {
    entries.push({ url: "https://a.com", title: "A", hasBeenRead: false });
    const count = await addTabsToReadingList([{ url: "https://a.com", title: "A" }]);
    expect(count).toBe(0);
  });
});
