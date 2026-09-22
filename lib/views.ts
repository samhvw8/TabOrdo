// The palette's prefix views: which rows /w, /p, /g, /re, /rl, /rc and every @ triage view
// show for a query, and what to say when a view has nothing in it.
//
// Pure functions of the tabs the popup already loaded, so each view is testable without
// mounting the component. The Chrome reads a few views need (Reading List, recently closed,
// the branch outline, tab groups) stay in App.svelte, which passes their results in.

import { findDuplicateGroups } from "./tabs/index.ts";
import { regexSearch, type SearchResult } from "./search.ts";
import type { TabSearch } from "./tabsearch.ts";
import type { ReadingListEntry } from "./readinglist.ts";
import { ACTION_COMMANDS } from "./commands.ts";

/** What a view is resolved against: the popup's last tab load, plus whatever that view read. */
export interface ViewContext {
  /** The search over every open tab. Its `items` are the rows the tab views select from. */
  search: TabSearch;
  currentWindowId: number;
  /** Group of the current window's active tab, -1 when it is ungrouped. */
  activeGroupId: number;
  /** @b: the active tab's branch in tree order, the root first at depth 0. */
  branch?: { id: number; depth: number }[];
  /** @shared: every tab group, with Chrome's flag for one shared with other people. */
  groups?: { id: number; shared?: boolean }[];
  /** /rl and /rc: the whole list, read once per visit to the view. */
  source?: SearchResult[];
}

export interface View {
  rows: SearchResult[];
  /** Status line for a view with nothing in it. */
  empty?: string;
}

export const ACTION_PREFIXES = new Set(ACTION_COMMANDS.map((c) => c.prefix));

interface TriageCategory {
  prefix: string;
  id: string;
  title: string;
  tabs: (ctx: ViewContext) => SearchResult[];
  /** Status line when the dedicated @-view comes back empty. */
  empty?: string;
  /** Whether the bare "@" overview lists this category, and with what (shorter) list. */
  overviewTabs?: (ctx: ViewContext) => SearchResult[];
}

const tabsWhere = (keep: (t: SearchResult) => boolean | undefined) =>
  (ctx: ViewContext) => ctx.search.items.filter(keep);

// Triage views are table-driven: they only differ by which tabs they select, and hand-copied
// switch arms are what let a broken "@shared" hide. One definition per category drives both
// the dedicated "@x" view and the bare "@" overview, whose order follows this list.
const TRIAGE_CATEGORIES: TriageCategory[] = [
  { prefix: "@a", id: "div-triage-audio", title: "Playing Audio",
    tabs: tabsWhere((t) => t.audible), overviewTabs: tabsWhere((t) => t.audible) },
  { prefix: "@m", id: "div-triage-muted", title: "Muted",
    tabs: tabsWhere((t) => t.muted), overviewTabs: tabsWhere((t) => t.muted) },
  { prefix: "@d", id: "div-triage-dupes", title: "Duplicates",
    tabs: (ctx) => duplicateTabs(ctx.search.items), overviewTabs: (ctx) => duplicateTabs(ctx.search.items) },
  // The dedicated view goes deeper than the overview section, which is one of six.
  { prefix: "@r", id: "div-triage-recent", title: "Recently Active",
    tabs: (ctx) => mostRecentTabs(ctx.search.items, 20), overviewTabs: (ctx) => mostRecentTabs(ctx.search.items, 15) },
  // "Unloaded" is what /discard produces: dropped from memory, reloads when you return.
  // "Paused by Chrome" is Chrome's own Memory Saver freeze — TabOrdo never sets it, so this
  // view is an observation, not a result of anything the user did here.
  { prefix: "@s", id: "div-triage-suspended", title: "Unloaded",
    tabs: tabsWhere((t) => t.discarded), overviewTabs: tabsWhere((t) => t.discarded) },
  { prefix: "@f", id: "div-triage-frozen", title: "Paused by Chrome", empty: "Chrome hasn't paused any tabs",
    tabs: tabsWhere((t) => t.frozen), overviewTabs: tabsWhere((t) => t.frozen) },
  { prefix: "@u", id: "div-triage-ungrouped", title: "Ungrouped", empty: "All tabs are grouped",
    tabs: tabsWhere((t) => !t.groupId || t.groupId === -1) },
  // What /branch would gather, before gathering it — and the place to see why it grabbed
  // (or missed) a tab. Contextual like @u, so it stays out of the bare "@" overview.
  { prefix: "@b", id: "div-triage-branch", title: "Branch", empty: "No tabs were opened from this one",
    tabs: branchTabs },
  { prefix: "@shared", id: "div-triage-shared", title: "Shared Groups", empty: "No shared group tabs",
    tabs: sharedGroupTabs },
];

// A Map, not an object literal: an object lookup would hit Object.prototype, so a command
// like /constructor or /toString would resolve to a truthy non-category and throw.
const TRIAGE_BY_PREFIX = new Map(TRIAGE_CATEGORIES.map((c) => [c.prefix, c]));
const TRIAGE_OVERVIEW = TRIAGE_CATEGORIES.filter((c) => c.overviewTabs);

/**
 * The rows `prefix` shows for the text `q` typed after it, and the status line when the view
 * itself is empty. /b and /h are not views: the popup looks those up in Chrome, debounced.
 *
 * Every view ranks through search.rankView, keyed by the view, which keeps the view's haystack
 * until its rows change. Building one per keystroke is diacritic stripping and pinyin for every
 * row: 2.6 ms a key for "@u" at 1000 tabs.
 */
export function resolveView(prefix: string, q: string, ctx: ViewContext): View {
  const view = resolveRows(prefix, q, ctx);
  return q ? view : capped(view);
}

/**
 * Rows a view lists before anything is typed. The views with no limit of their own (a triage
 * view, the bare "@" overview, /rl and /rc) listed every match: 817 rows for "@" at 1000 tabs,
 * all built in the frame of that keystroke. Past this many, typing narrows faster than scrolling.
 */
export const VIEW_ROW_CAP = 100;

function capped(view: View): View {
  if (view.rows.length <= VIEW_ROW_CAP) return view;
  const rows = view.rows.slice(0, VIEW_ROW_CAP);
  // A section header cut off from its rows would label nothing.
  while (rows.at(-1)?.type === "divider") rows.pop();
  const tabRows = (rs: SearchResult[]) => rs.filter((r) => r.type !== "divider").length;
  rows.push({ type: "divider", id: "div-view-cap", title: `Showing ${tabRows(rows)} of ${tabRows(view.rows)}, type to narrow`, url: "" });
  return { ...view, rows };
}

function resolveRows(prefix: string, q: string, ctx: ViewContext): View {
  const { search } = ctx;
  const triage = TRIAGE_BY_PREFIX.get(prefix);
  if (triage) {
    const viewTabs = triage.tabs(ctx);
    return {
      rows: q ? search.rankView(prefix, viewTabs, q) : viewTabs,
      empty: viewTabs.length === 0 ? triage.empty : undefined,
    };
  }

  switch (prefix) {
    // /w and /g slice the loaded tabs rather than ask Chrome: a tabs.query over every window,
    // tabGroups.query and windows.getCurrent per keystroke, for a subset of what the popup holds.
    case "w":
      return { rows: search.rankView("w", search.items.filter((t) => t.windowId === ctx.currentWindowId), q) };
    case "p":
      return { rows: search.rankView("p", search.items.filter((t) => t.pinned), q) };
    case "g": {
      const groupTabs = ctx.activeGroupId !== -1
        ? search.items.filter((t) => t.groupId === ctx.activeGroupId)
        : search.items.filter((t) => !t.groupId || t.groupId === -1);
      return { rows: search.rankView("g", groupTabs, q) };
    }
    case "@":
      return triageOverview(q, ctx);
    case "rl":
      return sourceView("rl", q, ctx, "Reading List is empty");
    case "rc":
      return sourceView("rc", q, ctx, "No recently closed tabs");
    case "re":
      return { rows: regexSearch(search.haystack(), q, 50, search.recency).map((i) => search.items[i]) };
    default:
      // An action's rows preview the tabs it will act on, so a bare action lists none.
      if (ACTION_PREFIXES.has(prefix)) return { rows: q ? search.rank(q) : [] };
      return { rows: search.rank(`/${prefix} ${q}`) };
  }
}

function triageOverview(q: string, ctx: ViewContext): View {
  const rows: SearchResult[] = [];
  for (const cat of TRIAGE_OVERVIEW) {
    const catTabs = cat.overviewTabs!(ctx);
    if (catTabs.length === 0) continue;
    const matched = q ? ctx.search.rankView(cat.id, catTabs, q) : catTabs;
    if (matched.length === 0) continue;
    rows.push({ type: "divider", id: cat.id, title: `${cat.title} (${matched.length})`, url: "" });
    rows.push(...matched);
  }
  if (rows.length > 0) return { rows };
  return { rows, empty: q ? "No triage matches" : "All clear — no tabs need attention" };
}

/** Reading List and recently closed: the list the view opened with, re-ranked per keystroke. */
function sourceView(key: string, q: string, ctx: ViewContext, empty: string): View {
  const rows = ctx.source ?? [];
  return {
    rows: q ? ctx.search.rankView(key, rows, q) : rows,
    empty: rows.length === 0 ? empty : undefined,
  };
}

/**
 * Reading List entries as /rl rows. The popup maps them inside its one read per visit, so
 * every keystroke ranks the same row objects and rankView keeps their haystack.
 */
export function readingListRows(entries: ReadingListEntry[]): SearchResult[] {
  return entries.map((item, i) => ({
    type: "bookmark" as const, id: `rl-${i}`, title: `${item.hasBeenRead ? "✓ " : ""}${item.title}`, url: item.url,
  }));
}

/** Every copy in each duplicate group, by the rule /dedup closes by. */
export function duplicateTabs(tabs: SearchResult[]): SearchResult[] {
  return [...findDuplicateGroups(tabs).values()].flat();
}

function mostRecentTabs(tabs: SearchResult[], limit: number): SearchResult[] {
  return [...tabs]
    .filter((t) => t.type === "tab")
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .slice(0, limit);
}

/**
 * The active tab's branch as an outline: the root first, everything opened from it indented
 * beneath, in tree order. Depth is drawn into the title with a non-breaking indent — the
 * row component has no notion of nesting, and this is a view, not a data change.
 */
function branchTabs(ctx: ViewContext): SearchResult[] {
  const outline = ctx.branch ?? [];
  // A lone root is not a branch; let the empty message say so.
  if (outline.length < 2) return [];
  const byId = new Map(ctx.search.items.filter((t) => t.tabId !== undefined).map((t) => [t.tabId!, t]));
  const rows: SearchResult[] = [];
  for (const { id, depth } of outline) {
    const t = byId.get(id);
    if (!t) continue;
    rows.push(depth === 0 ? t : { ...t, title: `${"  ".repeat(depth - 1)}↳ ${t.title || "Untitled"}` });
  }
  return rows;
}

function sharedGroupTabs(ctx: ViewContext): SearchResult[] {
  const sharedIds = new Set((ctx.groups ?? []).filter((g) => g.shared === true).map((g) => g.id));
  return ctx.search.items.filter((t) => t.groupId && sharedIds.has(t.groupId));
}

/**
 * Where the highlight starts on a fresh list: its first real row. Dividers aren't selectable,
 * and @triage and a bookmarks-only match both open on one.
 */
export function firstSelectable(rows: SearchResult[]): number {
  const i = rows.findIndex((r) => r.type !== "divider");
  return i < 0 ? 0 : i;
}

/**
 * Step the palette selection one row in `dir`, stepping over the divider rows that the
 * bookmark/history tail and the @triage overview interleave. Dividers aren't selectable —
 * landing on one hides the highlight and makes Enter a no-op — so walk past them, and at
 * either end stay on a real row rather than come to rest on a label.
 */
export function nextSelectable(rows: SearchResult[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < rows.length; i += dir) {
    if (rows[i].type !== "divider") return i;
  }
  if (rows[from]?.type !== "divider") return from;
  // Already parked on a divider (a triage list opens on one) with nothing past it — take
  // the nearest real row the other way instead of sitting there.
  for (let i = from - dir; i >= 0 && i < rows.length; i -= dir) {
    if (rows[i].type !== "divider") return i;
  }
  return from;
}
