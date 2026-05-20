import uFuzzy from "@leeoniya/ufuzzy";
import type { TabInfo } from "./tabs.ts";

export interface SearchResult {
  type: "tab" | "bookmark" | "history";
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  tabId?: number;
  groupTitle?: string;
  groupColor?: string;
  pinned?: boolean;
  audible?: boolean;
}

export interface Command {
  prefix: string;
  name: string;
  description: string;
  execute: (query: string) => Promise<void>;
}

const fuzzy = new uFuzzy({
  intraMode: 1,
  intraIns: 1,
  interIns: 3,
});

export function fuzzySearch(
  haystack: string[],
  needle: string,
  limit = 50
): number[] {
  if (!needle.trim()) return haystack.map((_, i) => i).slice(0, limit);

  const [idxs, info, order] = fuzzy.search(haystack, needle);
  if (!idxs || !order) return [];

  return order.slice(0, limit).map((i) => (info ? info.idx[i] : idxs[i]));
}

export function tabsToSearchItems(tabs: TabInfo[]): SearchResult[] {
  return tabs.map((tab) => ({
    type: "tab",
    id: `tab-${tab.id}`,
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    tabId: tab.id,
    groupTitle: tab.groupTitle,
    groupColor: tab.groupColor,
    pinned: tab.pinned,
    audible: tab.audible,
  }));
}

export async function searchBookmarks(
  query: string,
  limit = 20
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const results = await chrome.bookmarks.search(query);
  return results.slice(0, limit).map((b) => ({
    type: "bookmark",
    id: `bookmark-${b.id}`,
    title: b.title || "",
    url: b.url || "",
  }));
}

export async function searchHistory(
  query: string,
  limit = 20
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const results = await chrome.history.search({
    text: query,
    maxResults: limit,
  });
  return results.map((h) => ({
    type: "history",
    id: `history-${h.id}`,
    title: h.title || "",
    url: h.url || "",
  }));
}

export function parseCommand(input: string): {
  prefix: string | null;
  query: string;
} {
  const match = input.match(/^\/(\w+)\s*(.*)/);
  if (match) {
    return { prefix: match[1], query: match[2] };
  }
  return { prefix: null, query: input };
}
