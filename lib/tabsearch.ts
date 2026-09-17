import { rankedSearch, recencyOrder, buildHaystacks, buildSearchHaystack, subHaystack, warmHaystack, type SearchResult } from "./search.ts";

/**
 * The palette's search over one load of the tab list: the rows, the recency and priority
 * arrays ranking reads beside them, and the two haystacks, built on first use.
 *
 * Building both haystacks up front was 2.0 ms of the 2.8 ms of script the popup ran before
 * its first paint at 1000 tabs, although the dashboard it paints doesn't search until a key
 * is pressed. The popup warms this at idle once it has painted; a key that beats the idle
 * callback builds it on the spot and gets the same results.
 *
 * Never changed after creation, for the same reason search.ts keys its caches on array
 * identity: a different tab list gets a new TabSearch.
 */
export interface TabSearch {
  readonly items: SearchResult[];
  readonly recency: number[];
  /** The full haystack (title, URL, group, folded and pinyin forms), built on first call. */
  haystack(): string[];
  isBuilt(): boolean;
  /** Build both haystacks and their lower-case caches now, rather than on the first keystroke. */
  warm(): void;
  /**
   * The palette's ranking of every row against `query`: the top `limit` rows, best first.
   * Asking again for the last query returns the same array, so callers must not mutate it.
   */
  rank(query: string, limit?: number): SearchResult[];
  /**
   * Rank a view's rows (a triage list, the tabs in one window) against `query` exactly as
   * `rankedSearch(buildSearchHaystack(rows), query, limit)` does: no title haystack, recency
   * or priority, and the first `limit` rows as given for an empty query.
   *
   * The popup asks for the view's rows afresh on every keystroke, so the haystack is kept
   * under `key` for as long as those rows are the same objects in the same order. Rows this
   * search already holds reuse their built entries and lower-case caches; others (Reading
   * List entries, the retitled rows of @b) are built once per change of rows.
   */
  rankView(key: string, rows: SearchResult[], query: string, limit?: number): SearchResult[];
  /** This search without the row `id`, keeping recency and priority in step with the rows. */
  without(id: string): TabSearch;
}

export function createTabSearch(items: SearchResult[], recency: number[], priority: number[]): TabSearch {
  let built: { haystack: string[]; titleHaystack: string[] } | null = null;
  const haystacks = () => (built ??= buildHaystacks(items));
  // The bookmark and history lookup settles 200 ms after the last keystroke and ranks the tabs
  // again for the query the keystroke just ranked: 1.33 ms at 1000 tabs to rebuild a list
  // already on screen. One remembered query covers it; a reload makes a new TabSearch, so a
  // stale answer can't outlive the tabs it was ranked from.
  let last: { query: string; limit: number; rows: SearchResult[] } | null = null;
  const views = new Map<string, { rows: SearchResult[]; haystack: string[] }>();
  let positions: Map<SearchResult, number> | null = null;

  function viewHaystack(key: string, rows: SearchResult[]): string[] {
    const cached = views.get(key);
    if (cached && sameRows(cached.rows, rows)) return cached.haystack;
    let haystack: string[] | null = null;
    // Only borrow from the full haystack once something has built it; building all of it for
    // a view of three tabs would cost more than building the three.
    if (built) {
      positions ??= new Map(items.map((row, i) => [row, i]));
      const at: number[] = [];
      for (const row of rows) {
        const i = positions.get(row);
        if (i === undefined) break;
        at.push(i);
      }
      if (at.length === rows.length) haystack = subHaystack(built.haystack, at);
    }
    haystack ??= buildSearchHaystack(rows);
    views.set(key, { rows, haystack });
    return haystack;
  }

  return {
    items,
    recency,
    haystack: () => haystacks().haystack,
    isBuilt: () => built !== null,
    warm() {
      const h = haystacks();
      warmHaystack(h.haystack);
      warmHaystack(h.titleHaystack);
    },
    rank(query, limit = 50) {
      if (last && last.query === query && last.limit === limit) return last.rows;
      let indices: number[];
      if (!query.trim()) {
        // An empty query only reads the row count, so the most-recent list the popup opens
        // with (Cmd+E, Enter) needs no haystack at all.
        indices = recencyOrder(items.length, recency, limit);
      } else {
        const h = haystacks();
        indices = rankedSearch(h.haystack, query, limit, recency, h.titleHaystack, priority);
      }
      const rows = indices.map((i) => items[i]);
      last = { query, limit, rows };
      return rows;
    },
    rankView(key, rows, query, limit = 50) {
      if (!query.trim()) return rows.slice(0, limit);
      return rankedSearch(viewHaystack(key, rows), query, limit).map((i) => rows[i]);
    },
    without(id) {
      const keep: number[] = [];
      for (let i = 0; i < items.length; i++) if (items[i].id !== id) keep.push(i);
      return createTabSearch(keep.map((i) => items[i]), keep.map((i) => recency[i]), keep.map((i) => priority[i]));
    },
  };
}

function sameRows(a: SearchResult[], b: SearchResult[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
