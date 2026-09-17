---
type: Feature
title: Domain sort and sort priority
description: How a domain sort lays out a window, and the per-domain sort priority rules (first domains, segment-aware anchored path patterns, cross-rule tiers) that change its order without ever overriding a position lock.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort.ts
tags: [sorting, sort-priority, path-patterns, tab-order]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T09:52:43Z }
sources:
  - id: sort
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort.ts
    title: lib/tabs/sort.ts
    last_modified: 2026-09-17
  - id: rules
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/rules.ts
    title: lib/rules.ts (SortRule, pathMatches, buildSortRanker)
    last_modified: 2026-08-05
  - id: pins-panel
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/PinsPanel.svelte
    title: components/PinsPanel.svelte (Sort Priority section)
    last_modified: 2026-08-05
  - id: readme
    resource: https://github.com/samhvw8/TabOrdo/blob/main/README.md
    title: README.md "Sort Priority"
    last_modified: 2026-08-21
  - id: actions
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: lib/actions.ts (sort handler)
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: entrypoints/popup/App.svelte (per-group Sort button)
    last_modified: 2026-09-17
  - id: url
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/url.ts
    title: lib/url.ts
    last_modified: 2026-08-02
  - id: sort-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort.test.ts
    title: lib/tabs/sort.test.ts
    last_modified: 2026-09-17
  - id: sort-endstate-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort-endstate.test.ts
    title: lib/tabs/sort-endstate.test.ts
    last_modified: 2026-09-17
  - id: rules-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/rules.test.ts
    title: lib/rules.test.ts
    last_modified: 2026-08-05
  - id: commit-sortrules
    resource: https://github.com/samhvw8/TabOrdo/commit/6ddc216b9e6f922a01c6ef430584347cd0a732fa
    title: "feat: implement domain-based sorting rules with path ordering and test coverage"
    last_modified: 2026-08-03
  - id: commit-tiers
    resource: https://github.com/samhvw8/TabOrdo/commit/a539f1a0c98d39d77f747cc6a15588d33188d2ed
    title: "fix: linear glob matching, cross-rule sort tiers, sort-priority feedback"
    last_modified: 2026-08-04
  - id: commit-segments
    resource: https://github.com/samhvw8/TabOrdo/commit/a205238e1ea14b10a806b42082383b5b878ed86a
    title: "feat: segment-aware path patterns for sort rules"
    last_modified: 2026-08-05
---

# Overview

`sortTabsInWindow(windowId, by = "domain")` rearranges one window. **Sort priority** is a list of per-domain `SortRule`s, edited in the Locks panel, that changes what a *domain* sort produces. Nothing is held at a fixed slot, so a [position lock](/features/position-locks.md) still wins.[^rules][^readme] Sort rules were added on 2026-08-03[^commit-sortrules] and path patterns became segment-aware on 2026-08-05.[^commit-segments]

# Window layout

`organizeWindow` works in this order:[^sort]

1. Chrome-pinned tabs are left in place, and the layout starts after them.
2. Groups come next, ordered **by title**. Each group's tabs are sorted with the comparator, with locks placed by `pinAwareSortTabs`.
3. Ungrouped tabs come last, sorted with the comparator.
4. A group lock moves its group to the slot `applyGroupPinsToWindow` would drag it to, when that result is settled. `sortTabsInWindow` then runs `applyGroupPinsToWindow` anyway, and it normally finds nothing left to move ([position locks](/features/position-locks.md)).

That order is the *target*. `planLayout` turns it into moves by walking the blocks (each group, then the loose tabs) against a local copy of the strip and skipping every block whose tabs already sit at its index in order, so a window that is already sorted costs no `tabs.move` or `tabs.group` call at all. It used to move and regroup every block on every run: 121 calls on a 1000-tab sorted window. Blocks are placed front to back, so every move is leftward. That is the only direction a multi-tab `tabs.move` lands contiguously, because Chrome moves the ids one at a time. A block that does move is still regrouped. A loose tab stranded ahead of the groups (a link opened from a Chrome-pinned tab lands right after the pins) would push every block one slot off, so the planner also costs a variant that first appends such tabs to the end of the window, and keeps whichever plan makes fewer calls.[^sort]

The domain comparator compares in this order:[^sort]

1. `rank.domain`: position among `first` domains, else `UNRANKED`.
2. The registrable domain from `tldts`, alphabetical. This keeps each domain's tabs together.
3. `rank.path`: the cross-rule path tier.
4. The title.

Title and URL sorts get `noSortRanking`, which also skips a storage read on the auto-sort path.[^sort]

# Schema

`rulesConfig.sortRules: SortRule[]`, stored with the rest of the [rules config](/features/grouping-rules.md):[^rules]

| Field | Meaning |
|-------|---------|
| `id` | Stable id; badges and tiers key on it |
| `domain` | Hostname pattern matched with `domainMatches`, so it covers subdomains |
| `rankFirst` | `first`: the domain goes ahead of every unlisted domain, in list order |
| `patterns` | Ordered path patterns; the first match is the tab's tier |
| `enabled` | Off drops the rule from the ranker without deleting it |

# Path patterns

Patterns are matched against `pathname + search`, with no host and no hash.[^rules]

| Pattern | Matches |
|---------|---------|
| `*` | Exactly one segment, never crossing `/` |
| `**` | Any number of segments, including none |
| `/truyen/*` | `/truyen/9`, not `/truyen/x/y` |
| `/truyen/**` | `/truyen` and everything beneath it |
| `**/pulls/**` | `pulls` at any depth |

Both ends are anchored. The leading `/` is optional, a trailing `/` on the path is ignored, and matching is case-insensitive. Everything except a wildcard is literal, including `?`, so a pasted query string works.[^readme][^rules] Segment-awareness replaced a `*` that crossed slashes, which could not say "exactly this deep". The same change dropped prefix matching: `/inbox` no longer matches `/inbox/42`, and you write `/inbox/**` instead.[^commit-segments] `pathMatches` is a two-pointer walk with `**` standing in for the star, bounded by segments × patterns, with no recursion and no regex.[^rules]

# Invariants

- **The first matching rule wins**, so a specific `mail.google.com` rule listed above `google.com` takes precedence.[^rules]
- **Path tiers are numbered across all rules**, in rule order. Two rules can own hosts in the same registrable-domain block (`mail.` and `docs.google.com`). Per-rule indices ranked a later rule's first pattern above an earlier rule's second, and let the comparator form A<B<C<A cycles, which `Array.prototype.sort` does not handle.[^commit-tiers]
- **`rankPositionsOf` is shared** by the ranker and the panel's `#N` badges, so a badge cannot drift from the real order.[^rules][^commit-tiers]
- **Locks win.** `pinAwareSortTabs` places locked tabs before the comparator orders the rest.[^sort][^sort-test]
- `buildSortRanker` memoises per URL within one sort.[^rules]

# Where it applies

It applies to every domain sort: `/sort` (bare, or `/sort domain`), the dashboard Sort action, auto-sort, the context-menu Sort, and the `organizeWindow` pass inside Group and Regroup.[^actions][^sort] `/sort title` and `/sort url` ignore it.[^sort-test]

# Locks panel editor

The editor adds a domain (a pasted URL is reduced to its host, and a duplicate domain is rejected because it could never fire) or uses "This tab". Each rule has `first` and on/off buttons, drag to reorder, and up/down arrows for patterns. Every rule and pattern shows how many open tabs it matches, in red at zero, because a wrongly anchored pattern otherwise fails silently.[^pins-panel][^commit-tiers] Every change is saved immediately; there is no Save button.[^pins-panel]

# Gotchas

- **`first` leads a run, not the whole strip.** Groups always come before ungrouped tabs and are ordered by title, so a `first` domain only leads inside its group or inside the ungrouped run.[^sort][^sort-test]
- **The dashboard's per-group Sort button sorts by title.** It calls `sortTabsInGroup(groupId)`, whose default `by` is `"title"`, so sort priority does not apply there. Only `sortTabsInGroup(id, "domain")` uses it.[^popup-app][^sort]
- Rules match the full hostname, but blocks use the registrable domain, so rules for two subdomains of one site compare against each other through their tiers.[^rules][^url]
- Stale comments in `lib/rules.ts` still describe the old behaviour: above `pathSegments` ("anchor at the START and stay open at the end, so `/inbox` matches `/inbox/42`") and in the `globMatches` doc ("path rules match a prefix"). The code and tests are the segment-anchored version.[^rules][^rules-test]
- A pattern longer than 100 characters, or an empty one, never matches.[^rules]

# Tests that guard it

- `lib/rules.test.ts`: `pathMatches` (anchoring, `*` never crossing `/`, `**` including none, optional leading slash, trailing slash, literal `?`, length cap), `sortPathOf`, `buildSortRanker`, `rankPositionsOf`, "path tiers across rules".[^rules-test]
- `lib/tabs/sort.test.ts`: "with sort rules" (first domains in order, path order inside a domain, contiguous blocks, disabled rule, title sort untouched, inside a group, yields to a lock) and "two rules on one registrable domain".[^sort-test]
- `lib/tabs/sort.test.ts` "sortTabsInWindow call count": an already-sorted window makes no moves or regroups, one out-of-order loose tab or group costs one block, a tab stranded ahead of the groups goes to the tail in one call.[^sort-test]
- `lib/tabs/sort-endstate.test.ts` replays 160 seeded windows (locks, group locks, sort rules, two windows) and compares the end state with what the sort produced before it skipped no-op moves.[^sort-endstate-test]

# Related

[Position locks](/features/position-locks.md) · [Grouping rules](/features/grouping-rules.md) · [Background automation](/features/background-automation.md)

[^sort]: lib/tabs/sort.ts
[^rules]: lib/rules.ts
[^pins-panel]: components/PinsPanel.svelte
[^readme]: README.md
[^actions]: lib/actions.ts
[^popup-app]: entrypoints/popup/App.svelte
[^url]: lib/url.ts
[^sort-test]: lib/tabs/sort.test.ts
[^sort-endstate-test]: lib/tabs/sort-endstate.test.ts
[^rules-test]: lib/rules.test.ts
[^commit-sortrules]: commit 6ddc216
[^commit-tiers]: commit a539f1a
[^commit-segments]: commit a205238
