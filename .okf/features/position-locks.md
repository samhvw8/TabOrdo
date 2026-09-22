---
type: Feature
title: Position locks
description: /lock, /unlock, /lockgroup and /unlockgroup hold a tab at a slot in its group or a group at a slot among its window's groups; internally they are still "pins" (lib/pin.ts), placed by every sort and by the lock commands, and marked with a 📌 title badge.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pin.ts
tags: [locks, pins, tab-order, sorting, title-badge]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T21:00:00Z }
sources:
  - id: pin
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pin.ts
    title: lib/pin.ts
    last_modified: 2026-09-22
  - id: lock
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/lock.ts
    title: lib/tabs/lock.ts
    last_modified: 2026-08-03
  - id: sort
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort.ts
    title: lib/tabs/sort.ts
    last_modified: 2026-09-22
  - id: group
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/group.ts
    title: lib/tabs/group.ts
    last_modified: 2026-09-22
  - id: pins-panel
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/PinsPanel.svelte
    title: components/PinsPanel.svelte
    last_modified: 2026-09-22
  - id: pin-writes-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pin-writes.test.ts
    title: lib/pin-writes.test.ts
    last_modified: 2026-09-17
  - id: commands
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/commands.ts
    title: lib/commands.ts
    last_modified: 2026-08-21
  - id: actions
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: lib/actions.ts
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: entrypoints/popup/App.svelte (Lock Tab tile)
    last_modified: 2026-09-17
  - id: bg-index
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: entrypoints/background/index.ts
    last_modified: 2026-09-22
  - id: locksync
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/locksync.ts
    title: lib/locksync.ts (lock URL sync, restart reconcile)
    last_modified: 2026-09-22
  - id: locksync-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/locksync.test.ts
    title: lib/locksync.test.ts
    last_modified: 2026-09-22
  - id: dedup
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/dedup.ts
    title: lib/tabs/dedup.ts
    last_modified: 2026-09-17
  - id: readme
    resource: https://github.com/samhvw8/TabOrdo/blob/main/README.md
    title: README.md
    last_modified: 2026-08-21
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md (0.6.0 Renamed)
    last_modified: 2026-09-17
  - id: pin-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pin.test.ts
    title: lib/pin.test.ts
    last_modified: 2026-09-22
  - id: sort-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort.test.ts
    title: lib/tabs/sort.test.ts
    last_modified: 2026-09-22
  - id: sort-invariants-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort-invariants.test.ts
    title: lib/tabs/sort-invariants.test.ts
    last_modified: 2026-09-22
  - id: order
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/order.ts
    title: lib/tabs/order.ts (/movegroup)
    last_modified: 2026-09-22
  - id: order-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/order.test.ts
    title: lib/tabs/order.test.ts
    last_modified: 2026-09-22
  - id: commit-panel
    resource: https://github.com/samhvw8/TabOrdo/commit/82ee4fc033b7f09b57923b60ef44b851530f0598
    title: Add Pins debug panel with drag-reorder, tab tracking, and sort-aware pinning
    last_modified: 2026-06-14
  - id: commit-badge
    resource: https://github.com/samhvw8/TabOrdo/commit/022501311e7dd1f00aa22e98ea4c7d43f85e929f
    title: Add pin title badge and shift-click to reopen closed pins
    last_modified: 2026-06-16
  - id: commit-shift
    resource: https://github.com/samhvw8/TabOrdo/commit/e25abd640bc7b63117bbecc94dcffc0a429051ad
    title: "Fix position conflicts: shift existing pins when inserting at a taken slot"
    last_modified: 2026-05-29
  - id: commit-grouppins
    resource: https://github.com/samhvw8/TabOrdo/commit/734f1839e7fc017122b0d3e8e142e3c79cbba659
    title: Fix group pins lost after Group+/Sort
    last_modified: 2026-05-29
---

# Overview

A position lock holds a tab at a slot inside its tab group, or holds a group at a slot among the window's groups. It is TabOrdo's own concept and has nothing to do with Chrome's tab pinning. The feature shipped as `/pin` and was renamed "lock" in 0.6.0, because "pin" collided with Chrome's pin and people typing `/pin` expected Chrome's behaviour.[^changelog] The code still says pin everywhere (`lib/pin.ts`, `pinCurrentTab`, the `pinnedTabs` key).[^pin]

| Command | Handler | Argument |
|---------|---------|----------|
| `/lock` (alias `/pin`) | `pinCurrentTab` | `^` first, `$` last, `N` 1-based, empty = append after existing locks |
| `/unlock` (alias `/unpin`) | `unpinCurrentTab` | none |
| `/lockgroup` (alias `/pingroup`) | `pinCurrentGroup` | `^`, `$`, `N`, empty = the group's current slot |
| `/unlockgroup` (alias `/unpingroup`) | `unpinCurrentGroup` | none |

The aliases are hidden from the browse list but still resolve.[^commands][^actions] The dashboard's Lock Tab tile toggles: it unlocks a locked tab, and Alt/Ctrl-click locks at `^`.[^popup-app]

# Schema

`chrome.storage.local` holds two keys, both keyed by group **title**:[^pin]

| Key | Entry | Fields |
|-----|-------|--------|
| `pinnedTabs` | `PinnedTabEntry` | `id`, `url`, `title?`, `tabId?`, `groupName`, `position` (0-based within the group) |
| `pinnedGroups` | `PinnedGroupEntry` | `id`, `groupTitle`, `position` (0-based among the window's groups) |

Locking at a slot that is already taken shifts every lock at or after it up by one, so the new lock wins the slot.[^pin][^commit-shift] Re-locking an existing entry only updates its position.

**Reads.** `getPinnedTabs` and `getPinnedGroups` read storage every time, like the [rules config](/features/grouping-rules.md). A read costs about 0.15–0.2 ms in the worker, and the worker, the popup and the side panel all write both lists, so every read-modify-write sees the other contexts' latest writes.[^pin][^pin-writes-test] `syncPinUrl`, which runs on every url, title and status event of every tab, pays one read per event and writes only when a tracked lock's url or title changed.[^pin] A per-context read cache used to answer those events from memory; it needed a fresh-read rule on every write path and was removed for costing more to keep right than the reads it saved.

# Behaviour

**Identity.** A tab lock resolves `tabId` first, then URL, in `getPinForTab`, `unpinTab`, `pinAwareSortTabs` (which `applyPinsToGroup` runs) and dedup.[^pin][^dedup] Tracking `tabId` lets a lock follow a tab through navigation, which is the novel- and manga-reading case.[^commit-panel] The worker's lock URL sync (`syncLockedTab`) rewrites the entry's `url` and `title` when that tab navigates.[^locksync]

**Where positions are applied.**

| Path | Tab locks | Group locks |
|------|-----------|-------------|
| `sortTabsInWindow` (`/sort`, Sort button, auto-sort, context menu) | `organizeWindow` → `pinAwareSortTabs` | `organizeWindow` → `lockedGroupOrder` |
| `sortTabsInGroup` (per-group Sort) | `pinAwareSortTabs` | none |
| `groupTabsByDomain` (Group, Regroup) | `organizeWindow` for every window | `organizeWindow` for every window |
| `/lock`, `/lockgroup` | `applyPinsToGroup` | `applyGroupPinsToWindow` |
| Locks panel drag / reopen | `applyPinsToGroup` (drag debounced 500 ms) | none |

Sources: [^sort][^group][^lock][^pins-panel]. Group locks survive Group and Sort because both lay the window out through `organizeWindow`, which places them. Before 734f183 both lost them.[^commit-grouppins]

**Tab placement.** `pinAwareSortTabs` puts locked tabs at their slots and flows the unlocked tabs around them in comparator order. A slot past the end of the group is appended. When two tab locks ask for one slot, the tab with the higher id holds it and the other goes to the end of the group. The tie used to follow strip order, so the pair traded places on every sort.[^pin] `applyPinsToGroup` runs the same placement with the tabs' current order as the comparator and lays it down in one `tabs.move` plus a regroup. It used to place one lock at a time with a query after each, and each move could shift a lock placed before it off its slot.[^pin][^pin-test]

**Group placement.** `lockedGroupOrder(groups, pins)` is the one rule for where locked groups go. It takes the locked groups out of the order the groups would otherwise have, and puts each back at `min(position, groups - 1)`. The rest keep their order around them.[^pin]

- Locks that ask for one slot take it in turn: the lower position asked for first, then title order, then the order given. Clamping makes this common when there are more locks than groups. A lock that finds its slot taken takes the next free one, and past the last slot they back up leftward.
- A lock's title matches every group with that title in the window, and those groups sit side by side.
- A slot counts groups only. A group locked last sits after the other groups and ahead of the loose tabs.
- The rule maps its own output to itself, so running it on a strip it produced moves nothing.

A sort runs it on the groups in title order and lays the result down as its block order, followed by the loose tabs. `planLayout` skips every block already in place, so a sorted window with group locks makes no calls.[^sort] `/lockgroup` runs it on the groups in strip order and moves only the locked groups. Each goes with `tabGroups.move` to right after the group before it, or right after the Chrome-pinned tabs when it leads, planned on one query of the window. That is where the sort puts it, so the auto-sort after a lock finds nothing to move.[^pin][^sort-invariants-test] `tabGroups.move` keeps a group whole in either direction and reads its index with the group lifted out of the strip. A multi-tab `tabs.move` going right lands scattered, because Chrome places the ids one at a time. `/movegroup N` uses the same call, with the index from `groupStartIndex`, counted the same way.[^order][^order-test]

This replaced a lock pass that ran after every sort and dragged each locked group from its alphabetical slot to its locked one. The pass counted a rightward move's index with the group still in the strip, so a group locked to a slot on its right landed past it. Two locks clamped to one slot traded places on every sort. f9ff08b replayed the pass on a copy to skip its no-op moves while keeping its end state, bugs included. Both bugs are gone, and the pass with them.[^sort][^pin]

A lock beats a [sort priority](/features/sort-priority.md) rule.[^sort-test]

# Title badge

`setTitleBadge` injects `📌 ` (`PIN_BADGE`) into `document.title` through `chrome.scripting.executeScript`, with a `MutationObserver` that keeps it in place across in-page title changes. Unlocking removes it.[^lock] The badge was built on `activeTab` + `scripting` with no new permissions,[^commit-badge] so it is bound by the [no-host-permissions decision](/decisions/no-host-permissions.md). Injection failures are logged, never thrown.[^lock]

- A full navigation destroys the badge. The worker re-applies it on `status: "complete"` for any tab a lock tracks.[^locksync]
- `stripPinBadge` removes the prefix before a title is stored. Otherwise the badge's own title echo would write "📌 Title" into the entry.[^pin]
- After a restart the worker matches locks back to their tabs and badges them; see below.[^locksync]

# After a browser restart

Tab ids do not survive a restart, and the new session reuses them, so a stored id would land on an unrelated tab. `onStartup` runs `clearPinTabIds`, then `reconcilePins` matches the locks to the restored tabs by URL. Session restore creates tabs after `onStartup` has fired, so the worker also reconciles whenever a tab is created, navigates or finishes loading at the URL of a lock with no tab. That check reads the cached lock list, so it costs nothing while no lock is waiting.[^bg-index] The pass waits until a second has gone by with no new trigger, so it sees a restored window's tabs in their titled groups, and badges each tab it matched. A restored tab that has not loaded yet refuses the injection; it gets the badge when it loads, because the URL sync now finds its lock by id.[^locksync][^pin]

The URL sync and every reconcile wait for the startup reset. Both are listeners Chrome does not await, and a sync that read the list before the reset landed would match last session's id to whatever tab holds it now, then write the id back after the reset.[^locksync][^locksync-test]

`reconcilePins(pins, tabs, groups)` is the matching rule, pure so the worker and the Locks panel share it. A lock whose tab is open keeps it and takes on its URL and title. A lock with no open tab takes a tab with its URL: one in a group titled like the lock's group first, any other after that, never one another lock holds. Only a URL match assigns an id.[^pin]

Before, only the Locks panel's load matched locks back, and it ignored groups and could give one tab to two locks. Until the panel was opened, a locked tab that navigated left its lock behind, because the URL sync matches by id alone, and its badge stayed off.[^pins-panel][^locksync]

# Locks panel (`components/PinsPanel.svelte`)

This is the sidebar's "Locks" section. It shows [Sort Priority](/features/sort-priority.md) (labelled "Not locks"), Locked Groups, and Locked Tabs grouped by group name. Loading normalises positions to 0..n-1 and matches locks to the open tabs with `reconcilePins`, the worker's rule, badging any tab it newly matches. Rows drag to reorder. Clicking a row switches to the tab, or reopens a closed one, puts it back in its group and re-applies the locks. "Clean N closed" drops locks whose tab is gone.[^pins-panel]

# Relation to Chrome's pin

- Chrome-pinned tabs are never moved by a sort. `organizeWindow` starts laying tabs out after them.[^sort]
- [Dedup](/features/dedup.md) ranks a locked tab and a Chrome-pinned tab equally. Either outranks an unpinned copy, and among equals the most recently used copy survives. Each lock resolves to at most one tab, so two copies inside a locked group still dedupe.[^dedup]
- The "Pin" automation toggle (pin follow) syncs **Chrome's** pin state. It is not about locks; see [background automation](/features/background-automation.md).

# Gotchas

- **A bare `/lock` does not hold the tab where it is.** It uses `position = existingPins.length` (append after the group's existing locks) and then moves the tab there.[^lock] Commit 82ee4fc intended that ("defaults to appending at end of pin list"),[^commit-panel] but the README's tile table says "Hold at current position".[^readme]
- **`/movegroup $` and a group locked last end up in different places when loose tabs trail the groups.** `/movegroup $` moves the group to the very end of the window, past them. A lock's last slot counts groups only, so the next sort puts the locked group back ahead of them.[^order][^pin]
- Which of two tab locks on one slot holds it follows the tab ids, and tab ids change across a browser restart. The pair can swap once after one.[^pin]
- The restart match prefers the copy of a URL inside the lock's group only among the tabs open when the pass runs. If another copy was matched first and the in-group copy was restored more than a second later, the lock keeps the first one.[^locksync]
- Locks are keyed by group title. Renaming a group orphans its locks, and every group with that title in any window obeys them. A tab outside a titled group cannot be locked ("Group has no title").[^lock][^pin]
- The lock vocabulary change is incomplete. Status messages say "Pinned at position…" and "Usage: /pin", and the panel's empty states and buttons still say `/pin`, `/pingroup` and "unpin".[^lock][^pins-panel]

# Tests that guard it

- `lib/pin.test.ts`: `groupStartIndex` slot maths (counted with the group lifted out), `buildGroupOrder`, `unpinTab` by tabId after the URL moved, `syncPinUrl` strips the badge, `clearPinTabIds`.[^pin-test]
- `lib/pin.test.ts` "reconcilePins": a lock with no tab takes its URL's tab, the in-group copy first, a fallback outside the group, two locks on one URL each get their own tab, a held tab is never handed to a second lock, a closed lock's tab is re-matched, a held tab's URL and title come across without the badge, and no change is reported when nothing moved.[^pin-test]
- `lib/locksync.test.ts`: the lock follows navigation and is re-badged on load; after a restart each lock finds its restored tab and is badged, then follows it; a sync racing the reset never pulls the lock onto the unrelated tab holding last session's id; a tab restored after the first pass is matched when created or when it finishes loading; a burst is matched in one pass; no query while no lock is waiting.[^locksync-test]
- `lib/pin.test.ts` "lockedGroupOrder": slots on either side, clamping, the tie-break order, two groups under one title, a shared slot spilling, and the rule mapping its own output to itself.[^pin-test]
- `lib/pin.test.ts` "applyGroupPinsToWindow": `tabGroups.move` only, planned on one query, rightward and last-slot locks, only the locked group moves, a multi-tab group stays whole, no calls when everything is in place. "applyPinsToGroup": two locks the one-at-a-time version misplaced land in one move, and no move when nothing is out of place.[^pin-test]
- `lib/tabs/sort.test.ts` "sortTabsInWindow with position locks" (held slot, sorting around it, holding by tabId after navigation, two tab locks on one slot staying put) and "still yields to a position lock".[^sort-test]
- `lib/tabs/sort.test.ts` "sortTabsInWindow with group locks": one lock, two locks, a lock to the right, the last slot ahead of the loose tabs, and two locks clamped to one slot. Each lands in its slot and a second sort makes no calls.[^sort-test]
- `lib/tabs/sort-invariants.test.ts`: 1000 seeded windows (tab locks, group locks, sort rules, duplicate titles, two windows). A sort and `/lockgroup`'s pass each put every locked group at its clamped slot, left or right of where it started. Doing either again moves nothing, the pass moves only locked groups and never with `tabs.move`, and after a sort the pass finds nothing to move.[^sort-invariants-test]
- `lib/tabs/order.test.ts` "moveGroup": a move to a slot on the right lands in it, with one `tabGroups.move`.[^order-test]
- `lib/pin-writes.test.ts`: `syncPinUrl` follows a navigated lock and writes nothing for an untracked or unchanged tab, no failed write laundered into the next one, and no revert of another context's lock (`pinTab`, `syncPinUrl`, `pinGroup`).[^pin-writes-test]
- `lib/tabs/dedup.test.ts` has the position-pin cases; see [dedup](/features/dedup.md).
- Nothing tests `pinCurrentTab`, `pinCurrentGroup` or `setTitleBadge` directly.

# Related

[Sort priority](/features/sort-priority.md) · [Dedup](/features/dedup.md) · [Background automation](/features/background-automation.md) · [No host permissions](/decisions/no-host-permissions.md)

[^pin]: lib/pin.ts
[^lock]: lib/tabs/lock.ts
[^sort]: lib/tabs/sort.ts
[^group]: lib/tabs/group.ts
[^pins-panel]: components/PinsPanel.svelte
[^commands]: lib/commands.ts
[^actions]: lib/actions.ts
[^popup-app]: entrypoints/popup/App.svelte
[^bg-index]: entrypoints/background/index.ts
[^locksync]: lib/locksync.ts
[^locksync-test]: lib/locksync.test.ts
[^dedup]: lib/tabs/dedup.ts
[^readme]: README.md
[^changelog]: CHANGELOG.md
[^pin-test]: lib/pin.test.ts
[^pin-writes-test]: lib/pin-writes.test.ts
[^sort-test]: lib/tabs/sort.test.ts
[^sort-invariants-test]: lib/tabs/sort-invariants.test.ts
[^order]: lib/tabs/order.ts
[^order-test]: lib/tabs/order.test.ts
[^commit-panel]: commit 82ee4fc
[^commit-badge]: commit 0225013
[^commit-shift]: commit e25abd6
[^commit-grouppins]: commit 734f183
