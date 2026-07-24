export interface ReadingListEntry {
  url: string;
  title: string;
  hasBeenRead: boolean;
  creationTime: number;
  lastUpdateTime: number;
}

export function isReadingListAvailable(): boolean {
  return typeof chrome !== "undefined" && !!chrome.readingList;
}

export async function addToReadingList(url: string, title: string): Promise<void> {
  if (!isReadingListAvailable()) return;
  await chrome.readingList.addEntry({ url, title, hasBeenRead: false });
}

export async function getReadingList(): Promise<ReadingListEntry[]> {
  if (!isReadingListAvailable()) return [];
  return chrome.readingList.query({});
}

export async function removeFromReadingList(url: string): Promise<void> {
  if (!isReadingListAvailable()) return;
  await chrome.readingList.removeEntry({ url });
}

export async function markAsRead(url: string): Promise<void> {
  if (!isReadingListAvailable()) return;
  await chrome.readingList.updateEntry({ url, hasBeenRead: true });
}

export async function addTabsToReadingList(tabs: { url: string; title: string }[]): Promise<number> {
  if (!isReadingListAvailable()) return 0;
  let added = 0;
  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) continue;
    try {
      await addToReadingList(tab.url, tab.title || tab.url);
      added++;
    } catch {}
  }
  return added;
}
