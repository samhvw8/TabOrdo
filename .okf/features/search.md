---
type: Feature
title: Ranked search
description: How lib/search.ts ranks tabs for the palette (literal tiers before approximate ones, title over URL, pinned and current-window then recency), plus regex, pinyin, Vietnamese, the non-tab sources, and the caching that keeps typing fast.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/search.ts
tags: [search, palette, performance, i18n]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T09:50:38Z }
sources:
  - id: search-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/search.ts
    title: Search engine
    last_modified: 2026-09-17
  - id: tabsearch-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabsearch.ts
    title: Popup search over one tab load
    last_modified: 2026-09-17
  - id: tabsearch-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabsearch.test.ts
    title: TabSearch tests
    last_modified: 2026-09-17
  - id: pinyin-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pinyin.ts
    title: Pinyin variants
    last_modified: 2026-07-17
  - id: rules-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/rules.ts
    title: hasNestedQuantifier
    last_modified: 2026-08-05
  - id: sessions-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/sessions.ts
    title: Recently closed sessions
    last_modified: 2026-07-24
  - id: readinglist-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/readinglist.ts
    title: Reading List access
    last_modified: 2026-07-24
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Popup search wiring
    last_modified: 2026-09-17
  - id: search-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/search.test.ts
    title: Search tests
    last_modified: 2026-09-17
  - id: pinyin-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pinyin.test.ts
    title: Pinyin and unicode query tests
    last_modified: 2026-07-17
  - id: highlight-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/highlight.test.ts
    title: Highlight tests
    last_modified: 2026-07-17
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG
    last_modified: 2026-09-17
  - id: commit-9d70207
    resource: https://github.com/samhvw8/TabOrdo/commit/9d70207
    title: "perf: keep popup search arrays off the $state proxy"
    last_modified: 2026-08-21
  - id: commit-057dc57
    resource: https://github.com/samhvw8/TabOrdo/commit/057dc57
    title: "perf: cache lowercased and word-split haystacks between keystrokes"
    last_modified: 2026-08-21
---

# Overview

The palette ranks tabs with `rankedSearch`, a single ordered search that replaced user-selected fuzzy/exact/prefix/regex modes in 0.5.0.[^changelog] The older `search(haystack, needle, mode)` survives for `/re`. Ranking runs over parallel string arrays ("haystacks"). The popup holds one `TabSearch` per tab load (`lib/tabsearch.ts`), which carries the rows, recency and priority, and builds the haystacks on first use.[^tabsearch-ts][^popup-app] What the palette does with a `/command` is covered in [command palette](/features/command-palette.md).

# Haystacks

| Builder | Each entry contains[^search-ts] |
|---------|-------------------|
| `buildSearchHaystack` | `title url [groupTitle]`, then a diacritic-stripped copy when it differs, then pinyin of title and group title |
| `buildTitleHaystack` | `title [groupTitle]`, stripped copy, pinyin; no URL |

Group titles sit in both haystacks, so a group-name hit ranks as a title hit, and `/archive Work` reaches every tab in the "Work" group.[^search-ts][^changelog]

`buildHaystacks` produces both in one pass, running pinyin and diacritic stripping once per label. The single builders share the same per-item code. The strings are identical to stripping each whole entry, because stripping works per character and every join is a space; a test pins this with Vietnamese, Korean, CJK and leading-combining-mark input.[^search-ts][^search-test]

# Ranking

`rankedSearch(haystack, needle, limit = 50, recency, titleHaystack, priority)`:[^search-ts]

| Bucket | Tier, in order | Ordered by |
|--------|----------------|------------|
| Literal | 1. Word prefix on title haystack | Priority, then recency |
| | 2. Word prefix on full haystack | Priority, then recency |
| | 3. Substring on title haystack | Priority, then recency |
| | 4. Substring on full haystack | Priority, then recency |
| Approximate | 5. uFuzzy on full haystack | uFuzzy relevance |
| | 6. In-order subsequence on title haystack | Tightest window |
| | 7. In-order subsequence on full haystack | Tightest window |

- An index appears once, in its first tier. Words split on `[\s/.:_-]+`.
- The literal bucket keeps `limit - min(approximate.length, 10)` slots and approximate hits fill the rest, so fuzzy hits cannot be crowded out. Before 0.6.0 all tiers shared one budget and fuzzy results were computed then discarded.[^search-ts][^changelog]
- The popup sets priority to 1 for Chrome-pinned tabs and tabs in the current window, and recency to `lastAccessed` except the active tab, which gets 0.[^popup-app]
- Empty needle: every tab by recency. With the active tab sunk, row 0 is the previous tab, so `Cmd+E` then `Enter` works like alt-tab.[^popup-app][^changelog]
- uFuzzy runs with `intraMode: 1` (one error per term), `intraIns: 1`, `interIns: 3`, `unicode: true`. It cannot turn `yt` into `youtube` (two insertions), which is why the subsequence tier exists; needles under 2 characters skip it.[^search-ts]
- uFuzzy splits terms at every character that is not an ASCII letter, digit or apostrophe, whatever `unicode` says (that option only adds the `/u` flag), so it gets the needle with diacritics stripped, and is skipped when that folded needle is under 2 characters. Before, `hư` reached it as the term `h` and matched all 1000 tabs of a test fixture; now 477 rows match. A one-letter needle gained nothing from it, because the substring tier already holds every row containing the letter.[^search-ts][^search-test]
- Highlighting (`matchRanges`) runs on the displayed title, not the haystack: a contiguous match, else a greedy in-order match, else nothing.[^search-ts]

# Regex, CJK, pinyin, Vietnamese

- **`/re`**: `search(…, "regex", 50, recency)`, case-insensitive, over the full haystack. Patterns over 100 characters, nested quantifiers (`hasNestedQuantifier`, a best-effort heuristic from `lib/rules.ts`) and invalid patterns return nothing; a 50 ms deadline is checked between entries.[^search-ts][^rules-ts][^popup-app]
- **CJK needles** (U+3400–4DBF, U+4E00–9FFF) skip every tier but substring, because uFuzzy's term matching only handles space-delimited scripts.[^pinyin-ts][^search-ts]
- **Pinyin** (tiny-pinyin) adds spaced syllables, the joined form and initials for title and group title only. "知乎 - 首页" gains `zhi hu shou ye zhihushouye zhsy`, so `zhihu` and `zh` both find it.[^pinyin-ts]
- **Vietnamese**: `stripDiacritics` applies NFD, drops U+0300–036F and maps `đ`/`Đ` to `d`. The literal and subsequence tiers match the needle as typed against a haystack that holds both forms; only the uFuzzy tier folds the needle too. `tieng viet` and `tiếng` both find "Tiếng Việt", and `hư` also fuzzy-matches ASCII rows containing `hu` ("Hugo", "github").[^search-ts][^pinyin-test][^search-test]

# Non-tab sources

| Source | Reached by | Ranking |
|--------|-----------|---------|
| Bookmarks | Plain query of 2+ chars: 5 results after a 200 ms debounce, appended under a divider. `/b`: up to 20 | Chrome's `bookmarks.search` order[^popup-app][^search-ts] |
| History | Same, via `history.search`. `/h`: up to 20 | Chrome's order[^popup-app] |
| Reading List (`/rl`) | `readingList.query({})`; read items prefixed `✓ ` | `rankView`: `rankedSearch`, no recency[^popup-app][^readinglist-ts] |
| Recently closed (`/rc`, `/recent`) | `sessions.getRecentlyClosed` (25), window sessions flattened | `rankView`[^sessions-ts][^popup-app] |
| `/w`, `/p`, `/g` | Current window, Chrome-pinned, active group (or ungrouped) | `rankView`: `rankedSearch`, no recency or priority; an empty query lists the first 50[^popup-app][^tabsearch-ts] |

The debounced merge drops its result if the query changed meanwhile, and takes the tab rows from `tabSearch.rank`, which remembers its last query: re-ranking there cost 1.1 to 1.6 ms at 1000 tabs to rebuild a list already on screen. A reload creates a new `TabSearch`, so the remembered rows never outlive their tabs.[^popup-app][^tabsearch-ts]

# Performance decisions

- `prepare()` caches lower-cased entries and their word splits in a `WeakMap` keyed by the haystack **array**. The first search per load pays; later keystrokes hit. Contract: replace a haystack, never mutate it in place.[^search-ts]
- `App.svelte` keeps `allTabs`, `results`, `windows`, `dashboardTabs` and `pinnedTabs` as `$state.raw`, and `tabSearch` (which holds the haystack, recency and priority arrays ranking reads) as a plain `let`. A deep `$state` proxy traps every element read, and ranking does thousands per keystroke inside loops and sort comparators.[^popup-app]
- Nothing is built before the dashboard paints. `loadTabs` only creates the `TabSearch`; an empty query (the most-recent list the popup opens with) reads just the row count via `recencyOrder`. A `requestIdleCallback` (timeout 1 s) then builds both haystacks and their `prepare()` caches, unless a newer load replaced that search. A key pressed first builds synchronously and gets the same results.[^tabsearch-ts][^popup-app]
- Measured in Node at 1000 tabs: search work before first paint 3.20 ms to 0.24 ms; the idle warm-up costs 3.04 ms after paint; the first `g` then takes 0.42 ms instead of 3.35 ms. One pass over both haystacks costs 1.65 ms where two builders cost 2.82 ms.[^tabsearch-ts]
- Views (`@` triage, the bare `@` overview, `/w`, `/p`, `/g`, `/rl`, `/rc`) rank through `tabSearch.rankView(key, rows, query)`, which returns what `rankedSearch(buildSearchHaystack(rows), query)` would. The popup derives a view's rows afresh on each keystroke, so the view's haystack is kept under its key while the rows are the same objects in the same order. Rows the tab search holds are taken from the built full haystack by `subHaystack`, which also copies their `prepare()` entries; other rows (Reading List, recently closed, @b's retitled copies) are built once per change. Before, each keystroke rebuilt the view's haystack and missed `prepare()` because the array was new: `@u github` took about 2.5 ms a key at 1000 tabs (720 ungrouped), now 0.8 to 0.9 ms after the idle warm-up and 1.1 ms before it, with identical results.[^tabsearch-ts][^popup-app]
- Measured per keystroke: `9d70207` took 8.46 ms to 3.27 ms at 1000 tabs,[^commit-9d70207] and `057dc57` took 3.27 ms to 1.69 ms.[^commit-057dc57] CHANGELOG 0.7.0 rounds the pair to 2.4 ms to 0.5 ms at 300 tabs and 8.5 ms to 1.7 ms at 1000.[^changelog]

# Gotchas

- Mutating a haystack in place (`push`, `splice`) keeps serving the cached lower-cased copy. A `TabSearch` is never changed after creation: `loadTabs` makes a new one, and `handleClose` swaps in `tabSearch.without(id)`, which also keeps recency and priority aligned with the remaining rows.[^search-ts][^tabsearch-ts][^popup-app]
- `tabSearch` is a plain `let` and not reactive; a template that starts reading it will not update.[^popup-app]
- Approximate tiers ignore priority and recency, so a pinned tab gets no boost there.[^search-ts]
- `/re` tests the combined string, so `$` anchors to whatever was appended last (group title, stripped copy or pinyin), and to the URL only when nothing was.[^search-ts]
- Selecting a bookmark, history, Reading List or recently closed row opens its URL in a new tab. For `/rc` that is not a session restore; `/restore` does that.[^popup-app]
- No test pins the `WeakMap` identity contract.

# Tests that guard it

| File | Guards |
|------|--------|
| `lib/search.test.ts` | Tier order, title over URL, priority boost, abbreviations, reserved approximate budget, accented and one-letter needles, `parseCommand`, regex ReDoS guard[^search-test] |
| `lib/tabsearch.test.ts` | Lazy build ranks exactly as eager haystacks; empty query builds nothing; last query remembered; `rankView` matches a rebuilt haystack for subsets, reorders, foreign rows and changed rows; `without` keeps arrays aligned[^tabsearch-test] |
| `lib/pinyin.test.ts` | Pinyin variants, CJK queries, Vietnamese with and without diacritics[^pinyin-test] |
| `lib/highlight.test.ts` | `matchRanges` and `highlightSegments`[^highlight-test] |

# Related

- [Command palette](/features/command-palette.md), [archive](/features/archive.md) (the archive page has its own plain substring filter)
- [Architecture overview](/architecture/overview.md)

[^search-ts]: lib/search.ts
[^tabsearch-ts]: lib/tabsearch.ts
[^tabsearch-test]: lib/tabsearch.test.ts
[^pinyin-ts]: lib/pinyin.ts
[^rules-ts]: lib/rules.ts
[^sessions-ts]: lib/sessions.ts
[^readinglist-ts]: lib/readinglist.ts
[^popup-app]: entrypoints/popup/App.svelte
[^search-test]: lib/search.test.ts
[^pinyin-test]: lib/pinyin.test.ts
[^highlight-test]: lib/highlight.test.ts
[^changelog]: CHANGELOG.md
[^commit-9d70207]: commit 9d70207
[^commit-057dc57]: commit 057dc57
