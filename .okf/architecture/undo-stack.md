---
type: Module
title: Undo stack
description: lib/undo.ts keeps a 20-entry close/group undo stack in chrome.storage.session, with durable serialised pushes shared across the popup, side panel and background realms.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.ts
tags: [undo, storage, realms]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T00:16:05Z }
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

`lib/undo.ts` records a snapshot before a destructive tab action and replays it on Ctrl+Z. The stack is persisted under `tabOrdo_undoStack` (`UNDO_KEY`) in `chrome.storage.session`, capped at 20 entries (`MAX_STACK`). Pushing past the cap drops the oldest entry.[^undo-ts][^undo-test] Each module instance keeps an in-memory `stack` mirror so `peekUndo()` can stay synchronous for the UI's `canUndo` binding.[^undo-ts]

# Entry types

| `type` | Written by | `data` |
|---|---|---|
| `close` | `snapshotBeforeClose(tabIds)`, called only by [`closeTabs`](/architecture/tab-closing.md) | `ClosedTabData[]`: `url`, `pinned`, `windowId`, plus optional `id`, `index`, `groupId`, `groupTitle`, `groupColor` |
| `group` | `snapshotBeforeGroup()`, called by the group, ungroup, branch, sort, merge, shuffle and split handlers, their dashboard tiles, and `startAIGroup` | `GroupAssignment[]` for every unpinned tab: `tabId`, `groupId`, `groupTitle`, `groupColor`, plus optional `windowId` and `index` |

The optional fields exist because entries persisted by older versions lack them, and restore code must tolerate their absence.[^undo-ts] `executeUndo` returns `"Unknown undo type"` for any other type.[^undo-test]

# API

| Function | Contract |
|---|---|
| `pushUndo(entry)` | Durable. Awaits the storage write and **rejects if it fails**. Callers must abandon the destructive action rather than proceed without a snapshot.[^undo-ts] |
| `popUndo()` | Syncs, pops, persists. A failed persist is swallowed, because the entry is already out of the mirror and failing would only cost the user their undo.[^undo-ts] |
| `peekUndo()` / `undoStackSize()` | Synchronous reads of the mirror.[^undo-ts] |
| `loadUndoStack()` | Loads the mirror. The popup calls it on mount.[^popup-app] |
| `snapshotBeforeClose(ids)` | Records only ids that are still open. Pushes nothing when none are, since an empty entry would burn the slot under it.[^undo-ts][^undo-test] |
| `executeUndo()` | Pops and restores. Returns a status string.[^undo-ts] |

# Why it is this way

- **Durability before closing.** Chrome tears the popup down on any focus loss, so a fire-and-forget persist could lose the snapshot for anything that hands off to the background, such as `/aigroup`.[^undo-ts] A rejected session write used to let the caller close tabs it had no snapshot for.[^undo-test][^changelog]
- **`syncFromStorage` before every mutation.** The popup and side panel are one component in two realms, each with its own mirror over one persisted stack. Pushing onto a mirror loaded at mount time overwrote whatever the other surface had recorded since.[^undo-ts][^changelog] The background is a third writer: the context-menu dedup goes through `closeTabs`.[^background]
- **`writeChain` serialises pushes.** Each push is a read-modify-write of one shared array, and `syncFromStorage` rewrites that array in place. Without the chain, two back-to-back snapshots each reloaded the same pre-write state and the first entry vanished.[^undo-ts][^undo-test] Added in `1e5a1df`.[^commit-1e5a1df]

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

- `writeChain` covers `pushUndo` only, and only within one realm. `popUndo` is outside it, and there is no compare-and-swap across realms. `syncFromStorage` narrows the cross-realm window but does not close it.[^undo-ts]
- `persistStack` uses `chrome.storage.session?.set`, so the rejection contract assumes the session area exists.[^undo-ts]
- The stack is lost on browser restart, unlike the focus-mode workspace stack in `chrome.storage.local`. See the [known gaps](/architecture/tab-closing.md).
- The popup runs `executeUndo` inside `withBulkLock` behind the `busy` flag. It updates `canUndo` from `storage.onChanged` on `UNDO_KEY`, so another realm's push lights the button.[^popup-app]
- Tests share the module-level mirror, so `beforeEach` drains it with `popUndo()` after installing a fresh stub.[^undo-test]

# Tests that guard it

`lib/undo.test.ts` covers the cap, cross-realm pickup, push durability, overlapping pushes, close restore (window, index, group rejoin and rebuild, still-open skip, legacy entries) and group restore (scoping, relocation, window-separated buckets, partial failure).[^undo-test] `lib/tabs/close.test.ts` covers undo after a refused close.

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
