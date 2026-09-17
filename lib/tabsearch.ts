import { rankedSearch, recencyOrder, buildHaystacks, warmHaystack, type SearchResult } from "./search.ts";

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
    without(id) {
      const keep: number[] = [];
      for (let i = 0; i < items.length; i++) if (items[i].id !== id) keep.push(i);
      return createTabSearch(keep.map((i) => items[i]), keep.map((i) => recency[i]), keep.map((i) => priority[i]));
    },
  };
}
