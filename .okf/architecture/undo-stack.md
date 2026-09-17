---
type: Module
title: Undo stack
description: lib/undo.ts keeps a 20-entry close/group undo stack in chrome.storage.session, one key per entry plus a metadata key, with durable pushes shared across the popup, side panel and background realms.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.ts
tags: [undo, storage, realms, performance]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T09:52:34Z }
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

`lib/undo.ts` records a snapshot before a destructive tab action and replays it on Ctrl+Z. The stack lives in `chrome.storage.session`, capped at 20 entries (`MAX_STACK`). Pushing past the cap drops the oldest entry.[^undo-ts][^undo-test] Each module instance keeps an in-memory `mirror` of entry **metadata only**, so `peekUndo()` can stay synchronous for the UI's `canUndo` binding without holding any snapshot.[^undo-ts]

# Storage layout

| Key | Value | Read by |
|---|---|---|
| `tabOrdo_undo:<id>` | The whole `UndoEntry`, snapshot included | `popUndo`, for the top entry only; `peekUndoEntry` |
| `tabOrdo_undoMeta:<id>` | `{ type, label, timestamp }` | Mirror refreshes, only for ids the realm has not seen |

A push writes both keys in one `set()`. `<id>` is a 16-digit zero-padded timestamp plus a random suffix, so key order is stack order. A realm always stamps above the newest entry it has seen. Two surfaces pushing in the same millisecond order arbitrarily, and both entries survive.[^undo-ts] Entries are listed by name with `storage.session.getKeys()`, which returns no values, and evicted with `remove`. Chrome builds without `getKeys` (before 130) fall back to `get(null)`, the same fallback as the [bulk lock](/architecture/bulk-lock.md).[^undo-ts][^undo-test]

Measured at 1000 tabs with a full stack of 20 group snapshots, using the chrome stub with byte meters:

| Operation | Single array (before) | Per-entry keys |
|---|---|---|
| Push onto a full stack | reads 1.25 MB, writes 1.19 MB, 2.44 MB to `onChanged` | reads 0, writes 0.2 KB, 63 KB to `onChanged` (the evicted entry's old value) |
| Popup open (`loadUndoStack`) | reads 1.25 MB | reads 1.3 KB of metadata |
| Pop | reads 1.25 MB, writes 1.19 MB | reads 63 KB (the top entry) |

`tabOrdo_undoStack`, the single-array key of earlier versions, is migrated to per-entry keys and removed if a refresh finds it. Chrome clears the session area when an extension updates or reloads, so this should never fire. Detecting it costs nothing, because it is a name in a listing the refresh makes anyway.[^undo-ts][^undo-test]

# Entry types

| `type` | Written by | `data` |
|---|---|---|
| `close` | `snapshotBeforeClose(tabIds)`, called only by [`closeTabs`](/architecture/tab-closing.md) | `ClosedTabData[]`: `url`, `pinned`, `windowId`, plus optional `id`, `index`, `groupId`, `groupTitle`, `groupColor` |
| `group` | `snapshotBeforeGroup()`, called by the group, ungroup, branch, sort, merge, shuffle and split handlers, their dashboard tiles, and `startAIGroup` | `GroupAssignment[]` for every unpinned tab: `tabId`, `groupId`, `groupTitle`, `groupColor`, plus optional `windowId` and `index` |

The optional fields exist because entries persisted by older versions lack them, and restore code must tolerate their absence.[^undo-ts] `executeUndo` returns `"Unknown undo type"` for any other type.[^undo-test]

# API

| Function | Contract |
|---|---|
| `pushUndo(entry)` | Durable. Awaits the storage write and **rejects if it fails**. Callers must abandon the destructive action rather than proceed without a snapshot. Eviction after the write is housekeeping, and its failure is swallowed.[^undo-ts] |
| `popUndo()` | Refreshes the mirror, reads the top entry's payload, removes both of its keys. A failed remove is swallowed, because the entry is already out of the mirror and failing would only cost the user their undo. A payload that is already gone was popped by the other surface, so it takes the next one.[^undo-ts][^undo-test] |
| `peekUndo()` / `undoStackSize()` | Synchronous reads of the mirror. `peekUndo()` returns `UndoMeta` (`id`, `type`, `label`, `timestamp`), never `data`.[^undo-ts] |
| `peekUndoEntry()` | The top entry with its snapshot. Reads one payload. Tests use it; the UI has no reason to.[^undo-ts] |
| `loadUndoStack()` | Refreshes the mirror from key names plus unseen metadata. The popup calls it on mount and on every undo key change.[^popup-app] |
| `touchesUndoStack(changes)` | Whether a `storage.onChanged` batch touched a meta key (or the legacy key).[^undo-ts] |
| `snapshotBeforeClose(ids)` | Records only ids that are still open. Pushes nothing when none are, since an empty entry would burn the slot under it.[^undo-ts][^undo-test] |
| `executeUndo()` | Pops and restores. Returns a status string.[^undo-ts] |

# Why it is this way

- **Durability before closing.** Chrome tears the popup down on any focus loss, so a fire-and-forget persist could lose the snapshot for anything that hands off to the background, such as `/aigroup`.[^undo-ts] A rejected session write used to let the caller close tabs it had no snapshot for.[^undo-test][^changelog]
- **One key per entry.** The stack was one array under `tabOrdo_undoStack`, so every push read and rewrote all twenty snapshots, and `onChanged` delivered old and new copies to the service worker and every open surface. Every popup open read the whole array to light one button.[^undo-ts] Per-entry keys also remove the lost-update race the array had: writers only add or remove their own keys, the pattern the [bulk lock](/architecture/bulk-lock.md) moved to for its leases.
- **Refresh before every mutation.** The popup and side panel are one component in two realms, each with its own mirror over one persisted stack. Pushing onto a mirror loaded at mount time overwrote whatever the other surface had recorded since.[^undo-ts][^changelog] The background is a third writer: the context-menu dedup goes through `closeTabs`.[^background] A refresh is a names-only listing plus a read of metadata the realm has not seen.
- **`writeChain` serialises pushes, pops and reloads within a realm.** Storage writes no longer race, but mirror refreshes could: a slow one landing after a newer one would roll `canUndo` back. The chain was added in `1e5a1df`, when two back-to-back snapshots on the array layout each reloaded the same pre-write state and the first entry vanished.[^undo-ts][^undo-test][^commit-1e5a1df]

# executeUndo: close

1. Collect open window ids and live tab ids. If the live-tab query fails, every record is restored, as before ids were recorded. If the window query fails, restored tabs land in the focused window.[^undo-ts]
2. For each record, skip it when `url` is empty or `chrome://newtab/`, or when `id` is set and that id is still open. That last check is how a close Chrome refused avoids coming back as a second copy. Tab ids are unique for the browser session, and so is this stack. Legacy records without `id` are restored.[^undo-ts][^undo-test][^commit-54b3787]
3. `chrome.tabs.create({ url, pinned, active: false })`. `windowId` and `index` are passed only when the original window still exists, because an index means nothing in another window.[^undo-ts][^undo-test]
4. Regroup restored tabs, bucketed by window + title + colour. Rejoin a live group with the same window, title and colour when one exists, since closing one tab leaves its group standing. Otherwise create a group and set its title and colour. A regroup failure is logged and does not fail the reopen.[^undo-ts][^undo-test]
5. Return `Reopened N tab(s)`.

# executeUndo: group

1. Ungroup only current tabs the snapshot covers. Groups the user built after the snapshot are left alone.[^undo-ts][^undo-test]
2. Move tabs back to their snapshotted window and index, sorted by index, when that window still exists. `/aigroup` moves tabs across windows, and `chrome.tabs.group` rejects ids that span windows, so this has to happen first. Legacy entries without `windowId` are not relocated.[^undo-ts][^undo-test]
3. Rebuild groups bucketed by window + title + colour. Same-titled groups in one window merge. Same-titled groups in different windows stay apart. One group Chrome refuses does not abort the rest, and the status reports `N group(s) could not be rebuilt`.[^undo-ts][^undo-test]

# Gotchas

- `writeChain` is per realm, and there is no compare-and-swap across realms. Two surfaces popping at the same instant can both read the same top entry before either removes it, and both would replay it.[^undo-ts]
- `pushUndo` writes with `chrome.storage.session?.set`, so the rejection contract assumes the session area exists.[^undo-ts]
- `storage.onChanged` still delivers values, not just names: a push hands listeners the new entry, and eviction or a pop hands them the removed entry's old value. That is one snapshot per change instead of the whole stack twice.[^undo-ts]
- The stack is lost on browser restart, unlike the focus-mode workspace stack in `chrome.storage.local`. See the [known gaps](/architecture/tab-closing.md).
- The popup runs `executeUndo` inside `withBulkLock` behind the `busy` flag. On any `storage.onChanged` batch that `touchesUndoStack`, it reloads the mirror and sets `canUndo`, so another realm's push lights the button.[^popup-app]
- Tests share the module-level mirror, so `beforeEach` drains it with `popUndo()` after installing a fresh stub.[^undo-test]

# Tests that guard it

`lib/undo.test.ts` covers the cap, the per-entry layout, cross-realm pickup through a second module instance (`vi.resetModules`), two realms pushing onto a nearly full stack at once, a pop the other realm already took, storage cost (a push and a load read no payload, a pop reads only the top one), the `getKeys` fallback, legacy migration, push durability, overlapping pushes, close restore (window, index, group rejoin and rebuild, still-open skip, legacy entries) and group restore (scoping, relocation, window-separated buckets, partial failure).[^undo-test] `lib/tabs/close.test.ts` covers undo after a refused close.

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
