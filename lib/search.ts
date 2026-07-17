import uFuzzy from "@leeoniya/ufuzzy";
import type { TabInfo } from "./tabs.ts";
import { pinyinVariants, hasChinese } from "./pinyin.ts";

export interface SearchResult {
  type: "tab" | "bookmark" | "history" | "divider";
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  tabId?: number;
  windowId?: number;
  groupId?: number;
  groupTitle?: string;
  groupColor?: string;
  pinned?: boolean;
  audible?: boolean;
  lastAccessed?: number;
  discarded?: boolean;
  muted?: boolean;
}

export type SearchMode = "fuzzy" | "exact" | "regex" | "prefix";

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
  limit = 50,
  recency?: number[]
): number[] {
  if (!needle.trim()) {
    return sortByRecency(haystack.map((_, i) => i), recency).slice(0, limit);
  }

  // With recency, scan the full haystack so a recent match past the limit window isn't cut off.
  const scanLimit = recency ? haystack.length : limit;

  switch (mode) {
    case "fuzzy":
      // uFuzzy's term matching only handles space-delimited scripts; CJK needles use substring matching.
      if (hasChinese(needle)) {
        return sortByRecency(exactSearch(haystack, needle, scanLimit), recency).slice(0, limit);
      }
      return fuzzySearch(haystack, needle, limit);
    case "exact":
      return sortByRecency(exactSearch(haystack, needle, scanLimit), recency).slice(0, limit);
    case "prefix":
      return sortByRecency(prefixSearch(haystack, needle, scanLimit), recency).slice(0, limit);
    case "regex":
      return sortByRecency(regexSearch(haystack, needle, scanLimit), recency).slice(0, limit);
  }
}

// exact/prefix/regex matches carry no relevance score, so most-recently-used is the ranking.
function sortByRecency(indices: number[], recency?: number[]): number[] {
  if (!recency) return indices;
  return [...indices].sort((a, b) => (recency[b] ?? 0) - (recency[a] ?? 0));
}

// One ranked search replacing user-selected modes: word-prefix matches first, then substring,
// then fuzzy — each tier recency-ordered where it has no relevance score of its own.
export function rankedSearch(
  haystack: string[],
  needle: string,
  limit = 50,
  recency?: number[],
  titleHaystack?: string[]
): number[] {
  if (!needle.trim()) {
    return sortByRecency(haystack.map((_, i) => i), recency).slice(0, limit);
  }
  if (hasChinese(needle)) {
    return sortByRecency(exactSearch(haystack, needle, haystack.length), recency).slice(0, limit);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  const take = (indices: number[]) => {
    for (const i of indices) {
      if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
  };
  // A title/group-name hit is a stronger signal than a URL-only hit (e.g. "com" inside every
  // domain), so it's ranked first when a title-only view of the haystack is supplied.
  const titleHay = titleHaystack ?? haystack;
  take(sortByRecency(prefixSearch(titleHay, needle, titleHay.length), recency));
  take(sortByRecency(prefixSearch(haystack, needle, haystack.length), recency));
  take(sortByRecency(exactSearch(titleHay, needle, titleHay.length), recency));
  take(sortByRecency(exactSearch(haystack, needle, haystack.length), recency));
  take(fuzzySearch(haystack, needle, limit));
  return out.slice(0, limit);
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
  if (needle.length > 100) return [];
  let re: RegExp;
  try {
    re = new RegExp(needle, "i");
  } catch {
    return [];
  }
  const results: number[] = [];
  const deadline = Date.now() + 50;
  for (let i = 0; i < haystack.length && results.length < limit; i++) {
    if (re.test(haystack[i])) results.push(i);
    if (Date.now() > deadline) break;
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
    groupId: tab.groupId,
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

export function buildSearchHaystack(items: { title: string; url: string; groupTitle?: string }[]): string[] {
  return items.map((t) => {
    const original = `${t.title} ${t.url}${t.groupTitle ? ` ${t.groupTitle}` : ""}`;
    const stripped = stripDiacritics(original);
    let hay = original === stripped ? original : `${original} ${stripped}`;
    const pin = pinyinVariants(t.groupTitle ? `${t.title} ${t.groupTitle}` : t.title);
    if (pin) hay = `${hay} ${pin}`;
    return hay;
  });
}

// Title + group name only, no URL — used to rank a real title/label match above a URL-only
// hit (e.g. "com" matching every domain) instead of treating both as equally relevant.
export function buildTitleHaystack(items: { title: string; groupTitle?: string }[]): string[] {
  return items.map((t) => {
    const label = t.groupTitle ? `${t.title} ${t.groupTitle}` : t.title;
    const stripped = stripDiacritics(label);
    let hay = label === stripped ? label : `${label} ${stripped}`;
    const pin = pinyinVariants(label);
    if (pin) hay = `${hay} ${pin}`;
    return hay;
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
