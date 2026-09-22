import { isSaveablePage } from "./url.ts";

export interface ReadingListEntry {
  url: string;
  title: string;
  hasBeenRead: boolean;
  creationTime: number;
  lastUpdateTime: number;
}

export async function addToReadingList(url: string, title: string): Promise<void> {
  await chrome.readingList.addEntry({ url, title, hasBeenRead: false });
}

export async function getReadingList(): Promise<ReadingListEntry[]> {
  return chrome.readingList.query({});
}

export async function addTabsToReadingList(tabs: { url: string; title: string }[]): Promise<number> {
  const saveable = tabs.filter((tab) => isSaveablePage(tab.url));
  // Each add is independent, so they go out together. A rejected one (already on the list) still
  // costs only itself, and is not counted.
  const results = await Promise.allSettled(saveable.map((tab) => addToReadingList(tab.url, tab.title || tab.url)));
  return results.filter((r) => r.status === "fulfilled").length;
}
