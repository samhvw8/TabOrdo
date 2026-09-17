---
type: Invariant
title: Single tab-close path
description: closeTabs in lib/tabs/close.ts is the only caller of chrome.tabs.remove; it snapshots for undo, removes per id, and separates already-gone tabs from refused ones.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/close.ts
tags: [invariant, closing, undo, chrome-api]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T00:16:05Z }
sources:
  - id: close-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/close.ts
    title: lib/tabs/close.ts
    last_modified: 2026-09-17
  - id: close-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/close.test.ts
    title: lib/tabs/close.test.ts
    last_modified: 2026-09-17
  - id: undo-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.ts
    title: lib/undo.ts
    last_modified: 2026-09-17
  - id: workspace-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/workspace.ts
    title: lib/workspace.ts
    last_modified: 2026-09-17
  - id: workspace-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/workspace.test.ts
    title: lib/workspace.test.ts
    last_modified: 2026-09-17
  - id: background
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: Background service worker
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Popup and side panel component
    last_modified: 2026-09-17
  - id: bulklock-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bulklock.ts
    title: lib/bulklock.ts
    last_modified: 2026-08-15
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md
    last_modified: 2026-09-17
  - id: commit-acffcde
    resource: https://github.com/samhvw8/TabOrdo/commit/acffcdec370d1728026ba62b3f88fabc5599a55b
    title: "fix: close the other duplicates when one tab id has already gone (0.7.2)"
    last_modified: 2026-08-23
  - id: commit-54b3787
    resource: https://github.com/samhvw8/TabOrdo/commit/54b378798cb1ef0c79012d5ebb8e42a4968678ff
    title: "fix: route every tab close through one path, and undo only what closed"
    last_modified: 2026-09-17
---

# Overview

Every tab TabOrdo closes goes through `closeTabs(tabIds, opts)` in `lib/tabs/close.ts`. It is the only production caller of `chrome.tabs.remove`, and a test fails the build if a second one appears.[^close-ts][^close-test] The function owns the three things that used to drift apart across call sites: the undo snapshot, the removal, and the count.

```ts
closeTabs(tabIds: number[], opts: { snapshot?: boolean } = {}): Promise<number>
// resolves to the number of ids no longer open; throws if Chrome refused any
```

# Invariants

1. **Nothing else removes a tab.** New closers call `closeTabs`, never `chrome.tabs.remove`.[^close-ts]
2. **Snapshot, then remove.** Unless `snapshot: false`, `snapshotBeforeClose(tabIds)` is awaited before any removal. `pushUndo` guarantees durability: a write it cannot make throws, and then **nothing** closes, whether one tab or fifty.[^close-ts][^undo-ts]
3. **Per id, never one array.** Each id gets its own `chrome.tabs.remove(id)`, settled together with `Promise.allSettled`. Given an array, Chromium removes ids in order and stops at the first failure, so one stale id used to leave every tab after it open.[^close-ts][^commit-54b3787]
4. **Two rejection classes, kept apart.**

   | Rejection | Meaning | Handling |
   |---|---|---|
   | Message starts with `No tab with id` | The tab went between the caller's scan and the call | Counts as closed, because the intent is satisfied |
   | Anything else (tab mid-drag, for example) | The tab is still there | Collected. After the whole batch has been attempted, throws `N tab(s) could not be closed: <first reason>` |

   One refused tab therefore neither hides behind "Closed 4" nor keeps the other three open.[^close-ts]
5. **Undo restores only what is gone.** The snapshot precedes the removal, so it can name a refused tab. `executeUndo` skips any record whose tab id is still open.[^undo-ts] See [undo stack](/architecture/undo-stack.md).
6. **Empty input is a no-op.** Nothing is removed and no undo entry is pushed. If every id is already gone, no entry is pushed either, and the call still resolves to the full count.[^close-test][^undo-ts]

# Callers

| Caller | Snapshot | Why |
|---|---|---|
| `closeTabsToLeft` / `closeTabsToRight` / `closeTabsSameSite` / `closeOldTabs` (close.ts) | yes | Bulk closes the user may want back[^close-ts] |
| `removeDuplicates` (dedup.ts), `/close`, `/archive`, the dashboard selection buttons, TabCard close, Ctrl+Delete on a result | yes | Same[^commit-54b3787][^popup-app] |
| `focusMode` (lib/workspace.ts) | **no** | The workspace stack it has just written is this close's recovery, and `/unfocus` reads it. A Ctrl+Z entry for the same tabs would let Ctrl+Z followed by `/unfocus` reopen each tab twice.[^workspace-ts] |
| Switch-to-existing bounce (background `tabs.onUpdated`) | **no** | The tab is a second old with no history, and its URL is live in the tab the user was just sent to. An entry would restore the very duplicate the bounce removes, and evict a real entry from the 20-slot stack.[^background] |

# Tests that guard it

- `chrome.tabs.remove` "is called from closeTabs and nowhere else": walks `lib`, `entrypoints` and `components` (skipping `lib/testing` and `*.test.ts`), ignores lines starting with `//`, `*` or `<!--`, and expects exactly one match of `/chrome\.tabs\.remove\s*\(/`, located in `lib/tabs/close.ts`.[^close-test]
- "every bulk closer" runs `closeTabsToLeft`, `closeTabsToRight`, `closeTabsSameSite`, `closeOldTabs` and `removeDuplicates` through two cases. With `failWrites` set, each closes nothing. With one id in `failRemoveIds`, each closes the rest, throws `could not be closed`, and undo reopens only the rest.[^close-test]
- `closeTabs` unit cases cover the stale id in the middle (`[1, 999, 3]` resolves to 3), the refused tab, and `snapshot: false`.[^close-test]

# Gotchas

- The source-scan test matches text, so it catches direct calls only. An aliased or destructured `chrome.tabs.remove` would slip past it.[^close-test]
- The removals are fired concurrently rather than awaited one by one. "Per id" is about avoiding Chromium's array semantics, not about ordering.[^close-ts]
- `lib/workspace.test.ts` builds its own `chrome` fake whose `remove` always succeeds, so `focusMode`'s close is not exercised against the stub's rejection model.[^workspace-test]

# History

- **0.7.0–0.7.2** each shipped a `/dedup` fix: position-locked tabs survive (0.7.0), exactly one copy is kept when several are pinned (0.7.1), and the other duplicates close when one id has already gone (0.7.2).[^changelog]
- **0.7.2** (`acffcde`) moved dedup onto the per-id `closeTabs`, on the belief that Chrome "rejects that call outright on the first id it cannot resolve — removing nothing". It changed the stub to match that belief, and `closeTabs` counted only fulfilled removals.[^commit-acffcde] The belief was wrong: Chromium removes in order and stops at the first failure, so the release was validated against a stub that disagreed with Chromium. Separately, counting only fulfilled removals turned a refusal into "No duplicates found".[^commit-54b3787][^changelog]
- **`54b3787`** unified the five closers. `/closeleft`, `/closeright`, `/closesite` and `/closeold` still handed Chrome one array after snapshotting. A refused tab stopped the batch, the error invited Ctrl+Z, and undo recreated every snapshotted tab, the refused one included, so the user got a duplicate of the tab they were trying to close. The same commit found that the dashboard's selection Archive button took no snapshot at all.[^commit-54b3787][^changelog]

# Known gaps, deliberately not fixed

These come from the design review of the single close path.

1. **A beforeunload prompt can hang the close.** If a page's "Leave site?" prompt is dismissed with *Stay*, `chrome.tabs.remove` can stay pending forever, so `closeTabs` never settles. In the palette and dashboard paths, `busy` is cleared and the lease released only in `finally` blocks that are never reached. The popup stays busy, and the UI lease (60 s) holds suppression until it expires.[^popup-app][^bulklock-ts] A per-id timeout was rejected: it would add a tuning knob for a hang nobody has reported. This is a hang, not a rejection, so the refused-tab error path never sees it; the `closeTabs` doc comment says so.[^close-ts]
2. **Undo does not survive a restart; focus mode does.** The undo stack lives in `chrome.storage.session` and is lost when the browser restarts.[^undo-ts] The focus-mode workspace stack lives in `chrome.storage.local` and survives.[^workspace-ts]

# Related

- [Undo stack](/architecture/undo-stack.md)
- [Chrome stub](/testing/chrome-stub.md)
- [Dedup](/features/dedup.md)
- [Focus workspaces](/features/focus-workspaces.md)
- [Bulk lock](/architecture/bulk-lock.md)

[^close-ts]: lib/tabs/close.ts
[^close-test]: lib/tabs/close.test.ts
[^undo-ts]: lib/undo.ts
[^workspace-ts]: lib/workspace.ts
[^workspace-test]: lib/workspace.test.ts
[^background]: entrypoints/background/index.ts
[^popup-app]: entrypoints/popup/App.svelte
[^bulklock-ts]: lib/bulklock.ts
[^changelog]: CHANGELOG.md
[^commit-acffcde]: Commit acffcde
[^commit-54b3787]: Commit 54b3787
