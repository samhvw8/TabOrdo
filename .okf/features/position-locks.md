---
type: Feature
title: Position locks
description: /lock, /unlock, /lockgroup and /unlockgroup hold a tab at a slot in its group or a group at a slot in its window; internally they are still "pins" (lib/pin.ts), re-applied after grouping and sorting and marked with a 📌 title badge.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pin.ts
tags: [locks, pins, tab-order, sorting, title-badge]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T00:16:05Z }
sources:
  - id: pin
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pin.ts
    title: lib/pin.ts
    last_modified: 2026-08-03
  - id: lock
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/lock.ts
    title: lib/tabs/lock.ts
    last_modified: 2026-08-03
  - id: sort
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort.ts
    title: lib/tabs/sort.ts
    last_modified: 2026-08-03
  - id: group
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/group.ts
    title: lib/tabs/group.ts
    last_modified: 2026-08-15
  - id: pins-panel
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/PinsPanel.svelte
    title: components/PinsPanel.svelte
    last_modified: 2026-08-05
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
    last_modified: 2026-09-17
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
    last_modified: 2026-08-03
  - id: sort-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/sort.test.ts
    title: lib/tabs/sort.test.ts
    last_modified: 2026-08-05
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

# Behaviour

**Identity.** A tab lock resolves `tabId` first, then URL, in `getPinForTab`, `unpinTab`, `applyPinsToGroup`, `pinAwareSortTabs` and dedup.[^pin][^sort][^dedup] Tracking `tabId` lets a lock follow a tab through navigation, which is the novel- and manga-reading case.[^commit-panel] The background's pin URL sync rewrites the entry's `url` and `title` when that tab navigates.[^bg-index]

**Where positions are re-applied.**

| Path | Tab locks | Group locks |
|------|-----------|-------------|
| `sortTabsInWindow` (`/sort`, Sort button, auto-sort, context menu) | `organizeWindow` → `pinAwareSortTabs` | `applyGroupPinsToWindow` |
| `sortTabsInGroup` (per-group Sort) | `pinAwareSortTabs` | none |
| `groupTabsByDomain` (Group, Regroup) | `organizeWindow` for every window | `applyAllGroupPins` |
| `/lock`, `/lockgroup` | `applyPinsToGroup` | `applyGroupPinsToWindow` |
| Locks panel drag / reopen | `applyPinsToGroup` (drag debounced 500 ms) | none |

Sources: [^sort][^group][^lock][^pins-panel]. Group locks survive Group and Sort because both call the group-lock applier after rearranging.[^commit-grouppins]

`pinAwareSortTabs` puts locked tabs at their slots and flows sorted unlocked tabs around them. A slot past the end of the group is appended.[^sort] `applyPinsToGroup` re-reads indices after every move, because stale indices put locks 2..n in the wrong place, and it re-groups the tabs at the end.[^pin] A lock beats a [sort priority](/features/sort-priority.md) rule.[^sort-test]

# Title badge

`setTitleBadge` injects `📌 ` (`PIN_BADGE`) into `document.title` through `chrome.scripting.executeScript`, with a `MutationObserver` that keeps it in place across in-page title changes. Unlocking removes it.[^lock] The badge was built on `activeTab` + `scripting` with no new permissions,[^commit-badge] so it is bound by the [no-host-permissions decision](/decisions/no-host-permissions.md). Injection failures are logged, never thrown.[^lock]

- A full navigation destroys the badge. The background re-applies it on `status: "complete"` for any tab a lock tracks.[^bg-index]
- `stripPinBadge` removes the prefix before a title is stored. Otherwise the badge's own title echo would write "📌 Title" into the entry.[^pin]
- Tab ids do not survive a restart and get reused, so `onStartup` runs `clearPinTabIds`. The Locks panel's load then matches locks back to tabs by URL, backfills the id and re-applies the badge.[^pin][^pins-panel]

# Locks panel (`components/PinsPanel.svelte`)

This is the sidebar's "Locks" section. It shows [Sort Priority](/features/sort-priority.md) (labelled "Not locks"), Locked Groups, and Locked Tabs grouped by group name. Loading normalises positions to 0..n-1 and syncs `tabId`, `title` and `url` from open tabs. Rows drag to reorder. Clicking a row switches to the tab, or reopens a closed one, puts it back in its group and re-applies the locks. "Clean N closed" drops locks whose tab is gone.[^pins-panel]

# Relation to Chrome's pin

- Chrome-pinned tabs are never moved by a sort. `organizeWindow` starts laying tabs out after them.[^sort]
- [Dedup](/features/dedup.md) ranks a locked tab and a Chrome-pinned tab equally. Either outranks an unpinned copy, and among equals the most recently used copy survives. Each lock resolves to at most one tab, so two copies inside a locked group still dedupe.[^dedup]
- The "Pin" automation toggle (pin follow) syncs **Chrome's** pin state. It is not about locks; see [background automation](/features/background-automation.md).

# Gotchas

- **A bare `/lock` does not hold the tab where it is.** It uses `position = existingPins.length` (append after the group's existing locks) and then moves the tab there.[^lock] Commit 82ee4fc intended that ("defaults to appending at end of pin list"),[^commit-panel] but the README's tile table says "Hold at current position".[^readme]
- Locks are keyed by group title. Renaming a group orphans its locks, and every group with that title in any window obeys them. A tab outside a titled group cannot be locked ("Group has no title").[^lock][^pin]
- The lock vocabulary change is incomplete. Status messages say "Pinned at position…" and "Usage: /pin", and the panel's empty states and buttons still say `/pin`, `/pingroup` and "unpin".[^lock][^pins-panel]

# Tests that guard it

- `lib/pin.test.ts`: `groupStartIndex` slot maths, `buildGroupOrder`, `unpinTab` by tabId after the URL moved, `syncPinUrl` strips the badge, `clearPinTabIds`.[^pin-test]
- `lib/tabs/sort.test.ts` "sortTabsInWindow with position locks" (held slot, sorting around it, holding by tabId after navigation) and "still yields to a position lock".[^sort-test]
- `lib/tabs/dedup.test.ts` has the position-pin cases; see [dedup](/features/dedup.md).
- Nothing tests `pinCurrentTab`, `applyPinsToGroup` or `setTitleBadge` directly.

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
[^dedup]: lib/tabs/dedup.ts
[^readme]: README.md
[^changelog]: CHANGELOG.md
[^pin-test]: lib/pin.test.ts
[^sort-test]: lib/tabs/sort.test.ts
[^commit-panel]: commit 82ee4fc
[^commit-badge]: commit 0225013
[^commit-shift]: commit e25abd6
[^commit-grouppins]: commit 734f183
