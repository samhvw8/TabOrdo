---
type: Module
title: Undo stack
description: lib/undo.ts keeps a 20-entry close/group undo stack in chrome.storage.session, one key per entry, with durable pushes shared across the popup, side panel and background realms.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.ts
tags: [undo, storage, realms, performance]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T12:00:00Z }
sources:
  - id: undo-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.ts
    title: lib/undo.ts
    last_modified: 2026-09-17
  - id: undo-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.test.ts
    title: lib/undo.test.ts
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Popup and side panel component
    last_modified: 2026-09-17
  - id: background
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: Background service worker
    last_modified: 2026-09-17
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md
    last_modified: 2026-09-17
  - id: commit-1e5a1df
    resource: https://github.com/samhvw8/TabOrdo/commit/1e5a1dfae06048f8cb248b25a4c7b64faebbf745
    title: "fix: dedup identity, undo close fidelity, ignore-list reach in lib"
    last_modified: 2026-08-02
  - id: commit-54b3787
    resource: https://github.com/samhvw8/TabOrdo/commit/54b378798cb1ef0c79012d5ebb8e42a4968678ff
    title: "fix: route every tab close through one path, and undo only what closed"
    last_modified: 2026-09-17
---

# Overview

`lib/undo.ts` records a snapshot before a destructive tab action and replays it on Ctrl+Z. The stack lives in `chrome.storage.session`, capped at 20 entries (`MAX_STACK`). Pushing past the cap drops the oldest entry.[^undo-ts][^undo-test] Nothing about the stack is held in memory. Whether the Undo button lights is `hasUndo()`, a names-only listing of the session area.[^undo-ts][^popup-app]

# Storage layout

| Key | Value | Read by |
|---|---|---|
| `tabOrdo_undo:<id>` | The whole `UndoEntry`, snapshot included | `popUndo`, for the top entry only; `peekUndoEntry` |

`<id>` is a 16-digit zero-padded timestamp plus a random suffix, so key order is stack order. A push lists the entry keys, stamps above the newest one listed and above its own realm's last push (`lastStamp`), and writes one key. Two surfaces pushing in the same millisecond order arbitrarily, and both entries survive.[^undo-ts] After the write it lists again and evicts everything below the newest 20, so a push another surface made meanwhile counts toward the cap and neither push evicts the other.[^undo-ts][^undo-test] Entries are listed by name with `storage.session.getKeys()`, which returns no values, and evicted with `remove`.[^undo-ts][^undo-test]

Measured at 1000 tabs with a full stack of 20 group snapshots, using the chrome stub with byte meters:

| Operation | Single array (before) | Per-entry keys |
|---|---|---|
| Push onto a full stack | reads 1.25 MB, writes 1.19 MB, 2.44 MB to `onChanged` | reads 0, writes 0.2 KB, 63 KB to `onChanged` (the evicted entry's old value) |
| Popup open | reads 1.25 MB | reads no value: one `getKeys` |
| Pop | reads 1.25 MB, writes 1.19 MB | reads 63 KB (the top entry) |

The per-entry column was measured with a metadata key beside each entry, which the popup read on open (1.3 KB). The metadata key has since gone, and an open is now a names-only listing.

# Entry types

| `type` | Written by | `data` |
|---|---|---|
| `close` | `snapshotBeforeClose(tabIds)`, called only by [`closeTabs`](/architecture/tab-closing.md) | `ClosedTabData[]`: `url`, `pinned`, `windowId`, `id`, `index`, `groupId`, plus `groupTitle` and `groupColor` when the tab's group has them |
| `group` | `snapshotBeforeGroup()`, called by the group, ungroup, branch, sort, merge, shuffle and split handlers, their dashboard tiles, and `startAIGroup` | `GroupAssignment[]` for every unpinned tab: `tabId`, `groupId`, `windowId`, `index`, plus `groupTitle` and `groupColor` when the tab's group has them |

Chrome clears the session area when the extension updates, reloads or is disabled, and when the browser restarts, so every entry on the stack was written by the running version. Restore code reads no older entry shape, and there is no migration.[^undo-ts] `executeUndo` returns `"Unknown undo type"` for any other type.[^undo-test]

# API

| Function | Contract |
|---|---|
| `pushUndo(entry)` | Durable. Awaits the storage write and **rejects if it fails**, or if the listing before it fails. Callers must abandon the destructive action rather than proceed without a snapshot. Eviction after the write is housekeeping, and its failure is swallowed.[^undo-ts] |
| `popUndo()` | Lists the entry keys, reads the top entry's payload and removes its key. A failed remove is swallowed, because failing would only cost the user their undo. A payload that is already gone was popped by another surface, so it takes the next one. A failed listing rejects.[^undo-ts][^undo-test] |
| `hasUndo()` | Whether any entry key exists. One `getKeys` call, no value read. The popup asks on mount, after every action, and on every undo key change.[^undo-ts][^popup-app] |
| `peekUndoEntry()` | The top entry with its snapshot. Reads one payload. Tests use it; the UI has no reason to.[^undo-ts] |
| `touchesUndoStack(changes)` | Whether a `storage.onChanged` batch touched an entry key.[^undo-ts] |
| `snapshotBeforeClose(ids)` | Records only ids that are still open. Pushes nothing when none are, since an empty entry would burn the slot under it.[^undo-ts][^undo-test] |
| `executeUndo()` | Pops and restores. Returns a status string.[^undo-ts] |

# Why it is this way

- **Durability before closing.** Chrome tears the popup down on any focus loss, so a fire-and-forget persist could lose the snapshot for anything that hands off to the background, such as `/aigroup`.[^undo-ts] A rejected session write used to let the caller close tabs it had no snapshot for.[^undo-test][^changelog]
- **One key per entry.** The stack was one array under `tabOrdo_undoStack`, so every push read and rewrote all twenty snapshots, and `onChanged` delivered old and new copies to the service worker and every open surface. Every popup open read the whole array to light one button.[^undo-ts] Per-entry keys also remove the lost-update race the array had: writers only add or remove their own keys, the pattern the [bulk lock](/architecture/bulk-lock.md) moved to for its leases.
- **No copy in memory.** The popup and side panel are one component in two realms over one persisted stack, and the background is a third writer: the context-menu dedup goes through `closeTabs`.[^background] Each realm used to keep a mirror of entry metadata so `canUndo` could be read synchronously. That meant a metadata key per entry, a refresh before every mutation, and a per-realm `writeChain` so a slow refresh could not roll `canUndo` back. Every UI use of the mirror was one boolean, so `hasUndo()` asks storage instead. The popup's `refreshCanUndo` applies only the newest answer when several are in flight, which is the guarantee the chain gave.[^popup-app]
- **Push order without a chain.** A push stamps above the newest entry listed and above its realm's `lastStamp`, so two pushes that overlap in one realm still stack in call order. `writeChain` first went in for that (`1e5a1df`), when two back-to-back snapshots on the array layout each reloaded the same pre-write state and the first entry vanished.[^undo-ts][^undo-test][^commit-1e5a1df]

# executeUndo: close

1. Collect open window ids and live tab ids. If the live-tab query fails, every record is restored. If the window query fails, restored tabs land in the focused window.[^undo-ts]
2. For each record, skip it when `url` is empty or `chrome://newtab/`, or when its `id` is still open. That last check is how a close Chrome refused avoids coming back as a second copy. Tab ids are unique for the browser session, and so is this stack.[^undo-ts][^undo-test][^commit-54b3787]
3. `chrome.tabs.create({ url, pinned, active: false })`. `windowId` and `index` are passed only when the original window still exists, because an index means nothing in another window.[^undo-ts][^undo-test]
4. Regroup restored tabs, bucketed by window + title + colour. Rejoin a live group with the same window, title and colour when one exists, since closing one tab leaves its group standing. Otherwise create a group and set its title and colour. A regroup failure is logged and does not fail the reopen.[^undo-ts][^undo-test]
5. Return `Reopened N tab(s)`.

# executeUndo: group

1. Find **intact** groups (`findIntactGroups`): the live group with the snapshot's id holds exactly the snapshot's still-open members, in the same order, in the snapshot's window, in one contiguous block. Intact groups are never ungrouped or rebuilt, so they keep their id and collapsed state. A tab that joined the group since makes it not intact.[^undo-ts][^undo-test]
2. Ungroup the covered tabs that sit in any group that is not intact. Groups the user built after the snapshot, holding no covered tab, are left alone. If anything was ungrouped, query the tabs again, because Chrome moves an ungrouped tab to the edge of its old group.[^undo-ts][^undo-test]
3. Restore order per window (`restoreOrder`), for tabs whose snapshotted window still exists and that are not pinned now. `/aigroup` moves tabs across windows, and `chrome.tabs.group` rejects ids that span windows, so this has to happen before regrouping.[^undo-ts][^undo-test]
4. Rebuild the groups that are not intact, bucketed by window + title + colour. Same-titled groups in one window merge. Same-titled groups in different windows stay apart. One group Chrome refuses does not abort the rest, and the status reports `N group(s) could not be rebuilt`.[^undo-ts][^undo-test]
5. Restore the title and colour of an intact group that was only renamed, with one `tabGroups.update`.[^undo-ts][^undo-test]

## Order restore

Each window's target is a list of pieces in snapshot order: a single tab, or an intact group of two or more. Two plans run against an in-memory model of every window's strip, and the one with fewer calls wins. A tie goes to the plan that moves fewer tabs.[^undo-ts]

| Plan | How | Good at |
|---|---|---|
| From the front | Walk the pieces with a cursor and pull each one to it unless it is already there. Every move is leftward or from another window, so consecutive tabs batch into one `tabs.move`. A tab already in place mid-batch rides along, because Chrome skips a tab already at its index. | A `/shuffle`: one call per window |
| Around the longest run | Keep the longest run already in snapshot order where it is (longest increasing subsequence). Put every other piece right after its snapshot predecessor. | A few tabs pulled out of place, such as a `/group`: a handful of calls, however long the strip |

What a plan may ask of Chrome follows Chromium's source, not the stub:[^undo-ts]

- `tabs.move` places an id list one after another (`TabsMoveFunction::MoveTab`): each tab goes to `index`, then `index + 1`. That is exact only when every tab arrives from the right or from another window. A rightward move therefore goes alone in its own call.
- A tab moved away from the rest of its group leaves it, and a tab dropped between two tabs of one group joins it (`TabStripModel::GetGroupToAssign`). Intact groups of two or more move whole with `tabGroups.move`, whose index is the first tab's position after the move in either direction. Every tab lands right after a tab the snapshot put before it, which is never inside a group. A one-tab group keeps its group wherever it lands, so it moves as a tab.
- If a move call fails, the rest of that window is skipped, and the next window is planned against a fresh `tabs.query`.

Measured on the chrome stub at 1000 tabs, counting chrome calls, with wall time at 2 ms injected per call:

| Undo of | Before | After |
|---|---|---|
| `/shuffle`, one window | 1129 calls (988 `tabs.move`), 3.5 s | 144 calls (1 `tabs.move`), 0.36 s |
| `/group` of ≤50 tabs in window 1 of 7 | 272 calls (129 `tabs.move`, 69 groups rebuilt), 0.93 s | 31 calls (3 `tabs.move`, 2 `tabGroups.move`, 9 groups rebuilt), 0.08 s |

What remains after a shuffle is regrouping: a group whose tabs a shuffle scattered is rebuilt, at two calls per group.

# Gotchas

- Nothing serialises pops, and storage has no compare-and-swap. Two pops that overlap, in one realm or two, can both read the same top entry before either removes it, and both would replay it. The popup's `busy` flag keeps a surface from overlapping itself.[^undo-ts][^popup-app]
- `storage.onChanged` still delivers values, not just names: a push hands listeners the new entry, and eviction or a pop hands them the removed entry's old value. That is one snapshot per change instead of the whole stack twice.[^undo-ts]
- The stack is lost on browser restart, unlike the focus-mode workspace stack in `chrome.storage.local`. See the [known gaps](/architecture/tab-closing.md).
- The popup runs `executeUndo` inside `withBulkLock` behind the `busy` flag. On any `storage.onChanged` batch that `touchesUndoStack`, it asks `hasUndo()` again, so another realm's push lights the button.[^popup-app]
- The module holds no stack state, so a fresh stub per test is a fresh stack.[^undo-test]

# Tests that guard it

`lib/undo.test.ts` covers the cap, the per-entry layout, cross-realm pickup through a second module instance (`vi.resetModules`), two realms pushing onto a nearly full stack at once, a pop the other realm already took, storage cost (a push reads no payload, `hasUndo` reads key names only, a pop reads only the top one), push durability, overlapping pushes, close restore (window, index, group rejoin and rebuild, still-open skip) and group restore (scoping, relocation, window-separated buckets, partial failure). The order-restore tests cover a shuffle undone in at most one move per window with a tab opened since kept, a `/group` whose untouched groups get no ungroup, group or update call, an untouched group moved whole with `tabGroups.move`, a rename-only group restored without a rebuild, and tabs sent back rightward one call each around groups left in place.[^undo-test] `lib/tabs/close.test.ts` covers undo after a refused close.

# Related

- [Tab closing](/architecture/tab-closing.md)
- [Bulk lock](/architecture/bulk-lock.md)
- [AI grouping](/features/ai-grouping.md)
- [Architecture overview](/architecture/overview.md)

[^undo-ts]: lib/undo.ts
[^undo-test]: lib/undo.test.ts
[^popup-app]: entrypoints/popup/App.svelte
[^background]: entrypoints/background/index.ts
[^changelog]: CHANGELOG.md
[^commit-1e5a1df]: Commit 1e5a1df
[^commit-54b3787]: Commit 54b3787
