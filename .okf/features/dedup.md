---
type: Feature
title: Duplicate tab removal
description: How /dedup decides two tabs are the same page, which copy survives, where it is triggered from, why the dupe badge and @d agree with it, and how those rules changed between 0.6.0 and the unreleased single close path.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/dedup.ts
tags: [dedup, tabs, position-locks]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T05:55:38Z }
sources:
  - id: dedup-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/dedup.ts
    title: Duplicate finding and removal
    last_modified: 2026-09-22
  - id: close-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/close.ts
    title: closeTabs
    last_modified: 2026-09-17
  - id: pin-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pin.ts
    title: Position lock registry
    last_modified: 2026-08-03
  - id: actions-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: /dedup handler
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Dashboard tile, @d view and dupe badge
    last_modified: 2026-09-22
  - id: background
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: Action context menu
    last_modified: 2026-09-17
  - id: dedup-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/dedup.test.ts
    title: Dedup tests
    last_modified: 2026-09-22
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG
    last_modified: 2026-09-17
  - id: commit-7e3e91a
    resource: https://github.com/samhvw8/TabOrdo/commit/7e3e91a
    title: "refactor: split lib/tabs, extract action and dashboard registries"
    last_modified: 2026-07-29
  - id: commit-1e5a1df
    resource: https://github.com/samhvw8/TabOrdo/commit/1e5a1df
    title: "fix: dedup identity, undo close fidelity, ignore-list reach in lib"
    last_modified: 2026-08-02
  - id: commit-ea3fc3c
    resource: https://github.com/samhvw8/TabOrdo/commit/ea3fc3c
    title: "fix: keep tabs held by a position pin when deduplicating"
    last_modified: 2026-08-21
  - id: commit-013f617
    resource: https://github.com/samhvw8/TabOrdo/commit/013f617
    title: "fix: keep exactly one copy when deduplicating pinned tabs"
    last_modified: 2026-08-22
  - id: commit-acffcde
    resource: https://github.com/samhvw8/TabOrdo/commit/acffcde
    title: "fix: close the other duplicates when one tab id has already gone"
    last_modified: 2026-08-23
  - id: commit-54b3787
    resource: https://github.com/samhvw8/TabOrdo/commit/54b3787
    title: "fix: route every tab close through one path"
    last_modified: 2026-09-17
---

# Overview

`removeDuplicates()` reads every tab in every window, buckets them by normalised URL with `findDuplicateGroups`, keeps one tab per bucket and hands the rest to `closeTabs`. It returns how many are no longer open.[^dedup-ts] Closing, undo snapshots and refusal handling belong to [tab closing](/architecture/tab-closing.md); this concept covers identity and the survivor.

# URL identity (`normalizeUrl`)

| Part of the URL | Treatment[^dedup-ts] |
|-----------------|-----------|
| Protocol, host (with port), path | Kept |
| Query string | Kept, minus any `utm_*` key, `fbclid` and `gclid` |
| Hash | Kept |
| `chrome:` and `chrome-extension:` pages | Never treated as duplicates |
| Unparseable URL | Never treated as duplicates |

So `youtube.com/watch?v=A` and `?v=B` are different pages, while a link shared with `?utm_source=x` still matches the original. Tracking parameters "identify the click, not the page".[^dedup-ts][^dedup-test]

`findDuplicateGroups(tabs)` is the one place this rule is applied. It is pure and takes anything with a `url`, so `/dedup` runs it over `TabInfo`s and the popup's "N dupes" badge and `@d` view run it over search rows. A copy the badge counts is one `/dedup` acts on, and the reverse.[^dedup-ts][^popup-app][^dedup-test]

# Survivor policy

```ts
const rank = (t) => (t.pinned || positionPinned.has(t.id) ? 1 : 0);
[...tabs].sort((a, b) => rank(b) - rank(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
// index 0 survives, everything after it closes
```

- Exactly one copy survives each bucket.[^dedup-ts]
- A Chrome pin and a [position lock](/features/position-locks.md) rank equal, and either outranks an unpinned copy however recently that copy was used.[^dedup-ts][^changelog]
- A pin decides the survivor; it is not an exemption. Two pinned copies of one page are still duplicates, and the less recently used one closes, or `/dedup` would never clean the tabs a user curates most.[^dedup-ts]
- Buckets span windows, so the survivor may be in a window other than the one you are looking at.[^dedup-ts]

## `pinnedTabIds`: one tab per lock entry

For each lock entry, look only at the bucket's tabs whose group title equals the entry's `groupName`, then take the tab whose id matches the entry's `tabId`, else the first whose URL equals its `url`.[^dedup-ts][^pin-ts] Resolving to a set of ids, at most one per entry, is load-bearing: two identical copies inside one locked group both match the entry by URL, and treating both as locked would leave nothing to close. The lock registry is read only when duplicates exist.[^dedup-ts][^commit-ea3fc3c]

# Entry points

| Trigger | Path | Status text |
|---------|------|-------------|
| `/dedup` in the palette | `ACTION_HANDLERS.dedup` → `removeDuplicates`, inside the bulk lock, no confirmation | "Removed N duplicate(s)" / "No duplicates found"[^actions-ts] |
| Dashboard Dedup tile, More panel row | `handleOverflowAction("dedup")` → `removeDuplicates`, needs a second click | "N removed" / "No dupes"[^popup-app] |
| Action context menu "Remove duplicate tabs" | Background `contextMenus.onClicked` → `withBulkLock(removeDuplicates)` | None; errors go to the console[^background] |

All three reach `closeTabs`, so all three get an undo snapshot and per-tab closing. Text after `/dedup` is ignored; the handler takes no arguments.[^actions-ts]

# Gotchas

- The "N dupes" badge counts every copy, the survivors included, while `/dedup` reports how many it closed. Two copies of one page show "2 dupes" and then "1 removed".[^popup-app][^actions-ts]
- A lock entry matched by URL compares the stored raw URL, not the normalised one.[^dedup-ts]
- When Chrome refuses a duplicate (a tab being dragged, for instance), the rest still close and the command then throws, so the palette shows `Error: N tab(s) could not be closed: …`.[^dedup-test][^close-ts][^popup-app]

# History

| Version | Commit | Change |
|---------|--------|--------|
| 0.6.0 | `7e3e91a` | The undo snapshot moved inside deduplication: callers had recorded a *group* snapshot, so undo never reopened anything, and the context menu recorded none. The context menu also gained the bulk lock.[^commit-7e3e91a][^changelog] |
| 0.6.0 | `1e5a1df` | Identity moved from path alone to the full URL minus `utm_*`, `fbclid`, `gclid`, and Chrome-pinned tabs were never closed.[^commit-1e5a1df][^changelog] |
| 0.7.0 | `ea3fc3c` | Position locks became keeps alongside Chrome pins; one entry protects one tab.[^commit-ea3fc3c] |
| 0.7.1 | `013f617` | A pin picks the survivor instead of exempting the copy: exactly one copy stays, Chrome pin and lock ranked equal, most recent among equals. This replaced 0.6.0's "never closes a Chrome-pinned tab".[^commit-013f617][^changelog] |
| 0.7.2 | `acffcde` | The kill list went through `closeTabs` per id instead of one `tabs.remove(array)`, and the count became what actually closed.[^commit-acffcde] |
| Unreleased | `54b3787` | The snapshot moved from `removeDuplicates` into `closeTabs`; a refused tab is an error again (0.7.2 reported "No duplicates found"); undo restores only tabs that are actually gone.[^commit-54b3787][^changelog] |
| Unreleased | | The badge and `@d` group through `findDuplicateGroups`. They had compared raw URLs, so the badge could report "2 dupes" for copies differing only by tracking parameters, then `/dedup` closed them, or count duplicate `chrome://` pages that `/dedup` answered "No dupes" to.[^dedup-ts][^popup-app] |

`54b3787` also corrected 0.7.2's diagnosis. `acffcde` said Chrome rejects an id array outright and removes nothing. Chromium in fact removes in order and stops at the first failure; the test stub had modelled the wrong behaviour and 0.7.2 was validated against it.[^commit-acffcde][^commit-54b3787] See [chrome stub](/testing/chrome-stub.md).

# Tests that guard it

`lib/tabs/dedup.test.ts` covers:[^dedup-test]

- Identity: query strings and hashes distinguish pages; tracking-only differences do not.
- Grouping: `findDuplicateGroups` leaves single tabs, browser pages and unparseable URLs out, and finds exactly the copies `removeDuplicates` closes.
- Survivor: most recent copy when none is pinned; a pinned copy beats a more recent unpinned one; most recent when all are pinned; a Chrome pin and a lock tie and recency settles it; lock resolved by tab id when its URL is stale; a second copy inside the locked group still closes; a lock in another group is ignored.
- Closing: a close snapshot that undo reopens; no snapshot when nothing closes; the rest close when one id has already gone; a refused duplicate throws after the rest close.

# Related

- [Tab closing](/architecture/tab-closing.md), [undo stack](/architecture/undo-stack.md), [bulk lock](/architecture/bulk-lock.md)
- [Position locks](/features/position-locks.md), [command palette](/features/command-palette.md)

[^dedup-ts]: lib/tabs/dedup.ts
[^close-ts]: lib/tabs/close.ts
[^pin-ts]: lib/pin.ts
[^actions-ts]: lib/actions.ts
[^popup-app]: entrypoints/popup/App.svelte
[^background]: entrypoints/background/index.ts
[^dedup-test]: lib/tabs/dedup.test.ts
[^changelog]: CHANGELOG.md
[^commit-7e3e91a]: commit 7e3e91a
[^commit-1e5a1df]: commit 1e5a1df
[^commit-ea3fc3c]: commit ea3fc3c
[^commit-013f617]: commit 013f617
[^commit-acffcde]: commit acffcde
[^commit-54b3787]: commit 54b3787
