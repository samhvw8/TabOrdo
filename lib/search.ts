import uFuzzy from "@leeoniya/ufuzzy";
import type { TabInfo } from "./tabs.ts";

export interface SearchResult {
  type: "tab" | "bookmark" | "history" | "divider";
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  tabId?: number;
  windowId?: number;
  groupTitle?: string;
  groupColor?: string;
  pinned?: boolean;
  audible?: boolean;
  lastAccessed?: number;
  discarded?: boolean;
  muted?: boolean;
}

export type SearchMode = "fuzzy" | "exact" | "regex" | "prefix";

export const SEARCH_MODES: { mode: SearchMode; label: string; key: string }[] = [
  { mode: "fuzzy", label: "Fuzzy", key: "fzf" },
  { mode: "exact", label: "Exact", key: "exact" },
  { mode: "prefix", label: "Prefix", key: "pre" },
  { mode: "regex", label: "Regex", key: "re" },
];

const fuzzy = new uFuzzy({
  intraMode: 1,
  intraIns: 1,
  interIns: 3,
  unicode: true,
});

export function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d");
}

export function search(
  haystack: string[],
  needle: string,
  mode: SearchMode = "fuzzy",
  limit = 50
): number[] {
  if (!needle.trim()) return haystack.map((_, i) => i).slice(0, limit);

  switch (mode) {
    case "fuzzy":
      return fuzzySearch(haystack, needle, limit);
    case "exact":
      return exactSearch(haystack, needle, limit);
    case "prefix":
      return prefixSearch(haystack, needle, limit);
    case "regex":
      return regexSearch(haystack, needle, limit);
  }
}

function fuzzySearch(haystack: string[], needle: string, limit: number): number[] {
  const [idxs, info, order] = fuzzy.search(haystack, needle);
  if (!idxs || !order) return [];
  return order.slice(0, limit).map((i) => (info ? info.idx[i] : idxs[i]));
}

function exactSearch(haystack: string[], needle: string, limit: number): number[] {
  const lower = needle.toLowerCase();
  const results: number[] = [];
  for (let i = 0; i < haystack.length && results.length < limit; i++) {
    if (haystack[i].toLowerCase().includes(lower)) results.push(i);
  }
  return results;
}

function prefixSearch(haystack: string[], needle: string, limit: number): number[] {
  const lower = needle.toLowerCase();
  const results: number[] = [];
  for (let i = 0; i < haystack.length && results.length < limit; i++) {
    const words = haystack[i].toLowerCase().split(/[\s/.:_-]+/);
    if (words.some((w) => w.startsWith(lower))) results.push(i);
  }
  return results;
}

function regexSearch(haystack: string[], needle: string, limit: number): number[] {
  let re: RegExp;
  try {
    re = new RegExp(needle, "i");
  } catch {
    return [];
  }
  const results: number[] = [];
  for (let i = 0; i < haystack.length && results.length < limit; i++) {
    if (re.test(haystack[i])) results.push(i);
  }
  return results;
}

export function tabsToSearchItems(tabs: TabInfo[]): SearchResult[] {
  return tabs.map((tab) => ({
    type: "tab",
    id: `tab-${tab.id}`,
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    tabId: tab.id,
    windowId: tab.windowId,
    groupTitle: tab.groupTitle,
    groupColor: tab.groupColor,
    pinned: tab.pinned,
    audible: tab.audible,
    lastAccessed: tab.lastAccessed,
    discarded: tab.discarded,
    muted: tab.mutedInfo?.muted,
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

export function buildSearchHaystack(items: { title: string; url: string }[]): string[] {
  return items.map((t) => {
    const original = `${t.title} ${t.url}`;
    const stripped = stripDiacritics(original);
    return original === stripped ? original : `${original} ${stripped}`;
  });
}

export function parseCommand(input: string): {
  prefix: string | null;
  query: string;
} {
  const atMatch = input.match(/^(@\w?)\s*(.*)/);
  if (atMatch) {
    return { prefix: atMatch[1], query: atMatch[2] };
  }
  const match = input.match(/^\/(\w+)\s*(.*)/);
  if (match) {
    return { prefix: match[1], query: match[2] };
  }
  return { prefix: null, query: input };
}
