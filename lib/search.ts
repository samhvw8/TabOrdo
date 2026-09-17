import uFuzzy from "@leeoniya/ufuzzy";
import type { TabInfo } from "./tabs/index.ts";
import { pinyinVariants, hasChinese } from "./pinyin.ts";
import { hasNestedQuantifier } from "./rules.ts";
import { TRIAGE_COMMANDS } from "./commands.ts";

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
  frozen?: boolean;
  muted?: boolean;
}

export type SearchMode = "fuzzy" | "exact" | "regex" | "prefix";

const fuzzy = new uFuzzy({
  intraMode: 1,
  intraIns: 1,
  interIns: 3,
  unicode: true,
});

export interface MatchRange {
  start: number;
  end: number;
}

// Highlight ranges for a piece of DISPLAYED text (e.g. a tab's title), computed independently
// from the internal search haystack (which mixes in URL/pinyin variants a user never sees).
// Prefers a contiguous substring match; falls back to a greedy in-order character match so
// fuzzy-tier hits still show something, at the cost of a scattered rather than solid highlight.
export function matchRanges(text: string, needle: string): MatchRange[] {
  const q = needle.trim();
  if (!q || !text) return [];
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();

  const idx = lower.indexOf(qLower);
  if (idx !== -1) return [{ start: idx, end: idx + q.length }];

  const ranges: MatchRange[] = [];
  let ti = 0;
  for (let qi = 0; qi < qLower.length; qi++) {
    const ch = qLower[qi];
    while (ti < lower.length && lower[ti] !== ch) ti++;
    if (ti >= lower.length) return []; // needle not fully found in order — don't show a partial/misleading highlight
    const last = ranges[ranges.length - 1];
    if (last && last.end === ti) last.end = ti + 1;
    else ranges.push({ start: ti, end: ti + 1 });
    ti++;
  }
  return ranges;
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

export function highlightSegments(text: string, needle: string): HighlightSegment[] {
  const ranges = matchRanges(text, needle);
  if (ranges.length === 0) return [{ text, matched: false }];
  const segments: HighlightSegment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) segments.push({ text: text.slice(pos, r.start), matched: false });
    segments.push({ text: text.slice(r.start, r.end), matched: true });
    pos = r.end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), matched: false });
  return segments;
}

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
    return recencyOrder(haystack.length, recency, limit);
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

/**
 * What an empty needle returns: the first `limit` indices of a `length`-entry haystack, most
 * recent first. It reads nothing but the length, so the popup can list its most-recent tabs
 * before any haystack exists.
 */
export function recencyOrder(length: number, recency?: number[], limit = length): number[] {
  return sortByRecency(Array.from({ length }, (_, i) => i), recency).slice(0, limit);
}

// exact/prefix/regex matches carry no relevance score, so most-recently-used is the ranking.
// An optional priority (e.g. pinned / current-window) sorts first, recency only breaks ties within it.
function sortByRecency(indices: number[], recency?: number[], priority?: number[]): number[] {
  if (!recency && !priority) return indices;
  return [...indices].sort((a, b) => {
    if (priority) {
      const p = (priority[b] ?? 0) - (priority[a] ?? 0);
      if (p !== 0) return p;
    }
    return (recency?.[b] ?? 0) - (recency?.[a] ?? 0);
  });
}

// One ranked search replacing user-selected modes: word-prefix matches first, then substring,
// then fuzzy — each tier recency-ordered where it has no relevance score of its own.
export function rankedSearch(
  haystack: string[],
  needle: string,
  limit = 50,
  recency?: number[],
  titleHaystack?: string[],
  priority?: number[]
): number[] {
  if (!needle.trim()) {
    return recencyOrder(haystack.length, recency, limit);
  }
  if (hasChinese(needle)) {
    return sortByRecency(exactSearch(haystack, needle, haystack.length), recency, priority).slice(0, limit);
  }
  const seen = new Set<number>();
  // Split into two buckets rather than one flat list. A single shared slice(0, limit) at the end
  // meant the approximate tiers were dead weight on any query the literal tiers matched broadly:
  // prefix/substring filled all `limit` slots and the fuzzy hits below them were computed and
  // then discarded. Reserving a slice keeps them reachable.
  const literal: number[] = [];
  const approximate: number[] = [];
  const take = (bucket: number[], indices: number[]) => {
    for (const i of indices) {
      if (!seen.has(i)) {
        seen.add(i);
        bucket.push(i);
      }
    }
  };
  // A title/group-name hit is a stronger signal than a URL-only hit (e.g. "com" inside every
  // domain), so it's ranked first when a title-only view of the haystack is supplied.
  const titleHay = titleHaystack ?? haystack;
  take(literal, sortByRecency(prefixSearch(titleHay, needle, titleHay.length), recency, priority));
  take(literal, sortByRecency(prefixSearch(haystack, needle, haystack.length), recency, priority));
  take(literal, sortByRecency(exactSearch(titleHay, needle, titleHay.length), recency, priority));
  take(literal, sortByRecency(exactSearch(haystack, needle, haystack.length), recency, priority));
  // Bounded by the haystack, not by `limit`, exactly as the literal tiers above are: truncating
  // to `limit` here would spend the whole quota on indices the literal tiers already claimed,
  // and dedup afterwards would leave nothing.
  //
  // uFuzzy splits terms on [^A-Za-z\d']+ even with `unicode: true`, which only adds the /u
  // flag, so "hư" reached it as the lone term "h" and pulled in every tab with an h: 861 rows
  // at 1000 tabs that matched nothing the user typed. Every haystack entry already carries a
  // diacritic-stripped copy, so fold the needle to meet it. A one-letter needle is skipped
  // outright: any entry uFuzzy matches contains that letter, which the substring tier has
  // already claimed (a lone "ư" folds to "u", and those extra hits are the junk above). At
  // 1000 tabs the call found nothing new for 0.98 ms of a 1.69 ms keystroke.
  const fuzzyNeedle = stripDiacritics(needle);
  if (fuzzyNeedle.trim().length >= 2) take(approximate, fuzzySearch(haystack, fuzzyNeedle, haystack.length));
  take(approximate, subsequenceSearch(titleHay, needle, titleHay.length));
  take(approximate, subsequenceSearch(haystack, needle, haystack.length));

  const reserved = Math.min(approximate.length, APPROXIMATE_RESERVE);
  return [...literal.slice(0, Math.max(0, limit - reserved)), ...approximate].slice(0, limit);
}

/** Slots held back from the literal tiers so approximate matches always have somewhere to land. */
const APPROXIMATE_RESERVE = 10;

function fuzzySearch(haystack: string[], needle: string, limit: number): number[] {
  const [idxs, info, order] = fuzzy.search(haystack, needle);
  if (!idxs || !order) return [];
  return order.slice(0, limit).map((i) => (info ? info.idx[i] : idxs[i]));
}

/**
 * Per-haystack preprocessing, cached by array identity.
 *
 * The literal tiers used to lower-case every entry — and prefixSearch re-split it into words —
 * on every keystroke: at 1000 tabs that was 1.9 ms of a 3.3 ms search, paid again for each
 * character typed although the haystack had not changed. The popup builds a haystack once per
 * load and then searches it dozens of times, so the first search pays here and the rest hit.
 *
 * Keyed on the array, not its contents: callers must replace the haystack rather than mutate
 * it in place, which is what every builder in this file already does (map → new array). The
 * WeakMap lets a discarded haystack take its cache with it.
 */
interface PreparedHaystack {
  lower: string[];
  words: string[][];
}

const WORD_SPLIT = /[\s/.:_-]+/;
const prepared = new WeakMap<string[], PreparedHaystack>();

function prepare(haystack: string[]): PreparedHaystack {
  let p = prepared.get(haystack);
  if (!p) {
    const lower = haystack.map((h) => h.toLowerCase());
    p = { lower, words: lower.map((h) => h.split(WORD_SPLIT)) };
    prepared.set(haystack, p);
  }
  return p;
}

/**
 * In-order character match, the way fzf and most command palettes behave: "yt" reaches
 * "YouTube" because y precedes t. uFuzzy can't do this — it runs in SingleError mode, and
 * "yt" → "youtube" needs two inserted characters.
 *
 * Ranked by the tightest window that contains the needle, so "yt" scores "YouTube" (span 4)
 * far above a title where a y and a t happen to sit thirty characters apart.
 */
function subsequenceSearch(haystack: string[], needle: string, limit: number): number[] {
  // One-character needles match nearly everything and carry no signal.
  const q = needle.toLowerCase().replace(/\s+/g, "");
  if (q.length < 2) return [];
  const { lower } = prepare(haystack);
  const scored: { i: number; span: number }[] = [];
  for (let i = 0; i < lower.length; i++) {
    const span = subsequenceSpan(lower[i], q);
    if (span >= 0) scored.push({ i, span });
  }
  scored.sort((a, b) => a.span - b.span);
  return scored.slice(0, limit).map((s) => s.i);
}

/** Width of the tightest window containing `q` as an in-order subsequence of `text`, or -1. */
function subsequenceSpan(text: string, q: string): number {
  let best = -1;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== q[0]) continue;
    let qi = 1;
    let ti = start + 1;
    while (ti < text.length && qi < q.length) {
      if (text[ti] === q[qi]) qi++;
      ti++;
    }
    if (qi < q.length) break; // no completion from here, and later starts can only do worse
    const span = ti - start;
    if (best < 0 || span < best) best = span;
    if (best === q.length) break; // contiguous — nothing tighter exists
  }
  return best;
}

function exactSearch(haystack: string[], needle: string, limit: number): number[] {
  const q = needle.toLowerCase();
  const { lower } = prepare(haystack);
  const results: number[] = [];
  for (let i = 0; i < lower.length && results.length < limit; i++) {
    if (lower[i].includes(q)) results.push(i);
  }
  return results;
}

function prefixSearch(haystack: string[], needle: string, limit: number): number[] {
  const q = needle.toLowerCase();
  const { words } = prepare(haystack);
  const results: number[] = [];
  for (let i = 0; i < words.length && results.length < limit; i++) {
    if (words[i].some((w) => w.startsWith(q))) results.push(i);
  }
  return results;
}

function regexSearch(haystack: string[], needle: string, limit: number): number[] {
  if (needle.length > 100) return [];
  // The deadline below only helps between tests — a single test on a nested quantifier such
  // as `(a+)+$` never returns to be timed. Best-effort heuristic; see rules.ts.
  if (hasNestedQuantifier(needle)) return [];
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
    frozen: tab.frozen,
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

export interface SearchItem {
  title: string;
  url: string;
  groupTitle?: string;
}

/**
 * The costly part of an item's haystack entries, computed once and shared by both of them.
 *
 * The two builders used to run separately over the same tabs, so every Chinese label went
 * through pinyin twice (0.63 ms each time at 1000 tabs) and every label was stripped of
 * diacritics twice, all before the popup could paint. Stripping works character by character
 * and every join below is a space, which canonical reordering never moves marks across, so
 * stripping the parts and joining them yields exactly the strings that stripping each whole
 * entry did.
 */
interface LabelParts {
  strippedTitle: string;
  strippedGroup: string;
  pinyin: string | null;
  /** The finished title-haystack entry. */
  titleEntry: string;
}

function labelParts(title: string, groupTitle: string | undefined): LabelParts {
  const label = groupTitle ? `${title} ${groupTitle}` : title;
  const strippedTitle = stripDiacritics(title);
  const strippedGroup = groupTitle ? stripDiacritics(groupTitle) : "";
  const strippedLabel = groupTitle ? `${strippedTitle} ${strippedGroup}` : strippedTitle;
  const pinyin = pinyinVariants(label);
  const entry = label === strippedLabel ? label : `${label} ${strippedLabel}`;
  return { strippedTitle, strippedGroup, pinyin, titleEntry: pinyin ? `${entry} ${pinyin}` : entry };
}

function fullEntry(t: SearchItem, parts: LabelParts): string {
  const original = t.groupTitle ? `${t.title} ${t.url} ${t.groupTitle}` : `${t.title} ${t.url}`;
  const strippedUrl = stripDiacritics(t.url);
  const stripped = t.groupTitle
    ? `${parts.strippedTitle} ${strippedUrl} ${parts.strippedGroup}`
    : `${parts.strippedTitle} ${strippedUrl}`;
  const hay = original === stripped ? original : `${original} ${stripped}`;
  return parts.pinyin ? `${hay} ${parts.pinyin}` : hay;
}

export function buildSearchHaystack(items: SearchItem[]): string[] {
  return items.map((t) => fullEntry(t, labelParts(t.title, t.groupTitle)));
}

// Title + group name only, no URL — used to rank a real title/label match above a URL-only
// hit (e.g. "com" matching every domain) instead of treating both as equally relevant.
export function buildTitleHaystack(items: { title: string; groupTitle?: string }[]): string[] {
  return items.map((t) => labelParts(t.title, t.groupTitle).titleEntry);
}

/** Both haystacks in one pass: identical to calling the two builders, at one pinyin per label. */
export function buildHaystacks(items: SearchItem[]): { haystack: string[]; titleHaystack: string[] } {
  const haystack: string[] = new Array(items.length);
  const titleHaystack: string[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const parts = labelParts(items[i].title, items[i].groupTitle);
    haystack[i] = fullEntry(items[i], parts);
    titleHaystack[i] = parts.titleEntry;
  }
  return { haystack, titleHaystack };
}

/**
 * The entries of `haystack` at `indices`, as a haystack of its own that starts out with the
 * parent's lower-cased and word-split copies rather than recomputing them.
 *
 * A view (the tabs in this window, the ungrouped ones) is a subset of the tab list. Rebuilding
 * its haystack on every keystroke, pinyin and diacritic stripping included, and then missing
 * the prepare() cache because the array was new each time, is what cost "@u github" 2.6 ms a
 * key at 1000 tabs.
 */
export function subHaystack(haystack: string[], indices: number[]): string[] {
  const sub = indices.map((i) => haystack[i]);
  const p = prepared.get(haystack);
  if (p) prepared.set(sub, { lower: indices.map((i) => p.lower[i]), words: indices.map((i) => p.words[i]) });
  return sub;
}

/** Fill a haystack's lower-case and word-split cache now, so the first keystroke doesn't. */
export function warmHaystack(haystack: string[]): void {
  prepare(haystack);
}

// Longest first, so "@shared" is tested before "@s" swallows it.
const TRIAGE_PREFIXES = TRIAGE_COMMANDS.map((c) => c.prefix).sort((a, b) => b.length - a.length);

export function parseCommand(input: string): {
  prefix: string | null;
  query: string;
} {
  if (input.startsWith("@")) {
    // Match the longest *known* prefix rather than a greedy \w*. Greedy fixes "@shared" but
    // breaks every one-letter view with an attached query: "@afoo" has always meant
    // "@a" + "foo", and \w* turns it into the unknown prefix "@afoo" with an empty query.
    for (const p of TRIAGE_PREFIXES) {
      if (input.startsWith(p)) {
        return { prefix: p, query: input.slice(p.length).trim() };
      }
    }
    // Unknown prefix — fall back to the original single-character split so anything that
    // isn't a real view behaves exactly as it did before.
    const atMatch = input.match(/^(@\w?)\s*(.*)/)!;
    return { prefix: atMatch[1], query: atMatch[2] };
  }
  const match = input.match(/^\/(\w+)\s*(.*)/);
  if (match) {
    return { prefix: match[1], query: match[2] };
  }
  return { prefix: null, query: input };
}
