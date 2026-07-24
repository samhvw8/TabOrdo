import { describe, it, expect, beforeEach, vi } from "vitest";
import { addToReadingList, getReadingList, removeFromReadingList, markAsRead, addTabsToReadingList } from "./readinglist.ts";

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
      removeEntry: vi.fn(async (props: { url: string }) => {
        entries = entries.filter((e) => e.url !== props.url);
      }),
      updateEntry: vi.fn(async (props: { url: string; hasBeenRead: boolean }) => {
        const entry = entries.find((e) => e.url === props.url);
        if (entry) entry.hasBeenRead = props.hasBeenRead;
      }),
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

describe("removeFromReadingList", () => {
  it("removes entry by URL", async () => {
    entries.push({ url: "https://a.com", title: "A", hasBeenRead: false });
    await removeFromReadingList("https://a.com");
    expect(entries).toHaveLength(0);
  });
});

describe("markAsRead", () => {
  it("sets hasBeenRead to true", async () => {
    entries.push({ url: "https://a.com", title: "A", hasBeenRead: false });
    await markAsRead("https://a.com");
    expect(entries[0].hasBeenRead).toBe(true);
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

  it("silently handles duplicate errors", async () => {
    entries.push({ url: "https://a.com", title: "A", hasBeenRead: false });
    const count = await addTabsToReadingList([{ url: "https://a.com", title: "A" }]);
    expect(count).toBe(0);
  });
});
