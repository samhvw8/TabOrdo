---
type: Reference
title: Chrome API stub
description: lib/testing/chrome-stub.ts is the repo's executable model of Chrome tab, group, window and storage semantics for vitest, with failure-injection knobs; its fidelity decides what the tests can prove.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/testing/chrome-stub.ts
tags: [testing, vitest, chrome-api]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T12:00:00Z }
sources:
  - id: stub
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/testing/chrome-stub.ts
    title: lib/testing/chrome-stub.ts
    last_modified: 2026-09-17
  - id: vitest-config
    resource: https://github.com/samhvw8/TabOrdo/blob/main/vitest.config.ts
    title: vitest.config.ts
    last_modified: 2026-08-02
  - id: undo-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.test.ts
    title: lib/undo.test.ts
    last_modified: 2026-09-17
  - id: undo-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.ts
    title: lib/undo.ts
    last_modified: 2026-09-17
  - id: rules-cache-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/rules-cache.test.ts
    title: lib/rules-cache.test.ts
    last_modified: 2026-07-27
  - id: workspace-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/workspace.test.ts
    title: lib/workspace.test.ts
    last_modified: 2026-09-17
  - id: commit-3431468
    resource: https://github.com/samhvw8/TabOrdo/commit/34314682268915f701ab683590a45f2f4a7c20c6
    title: "fix: AI-progress lease, listener crash guards, stricter chrome stub"
    last_modified: 2026-08-02
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

`installChromeStub()` replaces `globalThis.chrome` with an in-memory model of the APIs `lib/` uses and returns a `ChromeStub` handle. The handle holds the state (`openTabs`, `groups`, `windows`, `currentWindowId`, `localData`, `sessionData`), the recorders, and the failure knobs.[^stub] Treat it as the repo's executable claim about how Chrome behaves. A test can only prove what the stub models faithfully, and a stub that disagrees with Chromium lets a wrong fix pass green.

# What it models deliberately

| API | Modelled behaviour |
|---|---|
| `tabs.query` | Filters by `windowId`, `groupId`, `currentWindow`/`lastFocusedWindow` (both mean `currentWindowId`), `active` and `pinned`. Ignoring `active` once made every "active tab" query return the first tab, so close/unite/isolate tests asserted nothing.[^stub] |
| `tabs.move` | Moves ids in the order given. A tab crossing windows **loses its group**. **Reflows** indices so each window stays `0..n-1`. Modelling only the group drop had left ordering assertions vacuous: reversing or deleting the sort in `carryGroups` still passed all 9 merge tests.[^stub] |
| `tabGroups.move` | Same window only. As Chromium's `TabGroupsMoveFunction::MoveGroup`: `index` is where the group's first tab lands once the group is lifted out, in either direction, and the group keeps its id. Recorded in `groupMoves`.[^stub] |
| `tabs.group` | **Rejects ids that span windows** ("Tabs can only be grouped in the same window."). Creates the group in `groups` when no `groupId` is given, and pulls members contiguous.[^stub][^commit-3431468] |
| `tabs.remove` | As Chromium's `TabsRemoveFunction`: removes ids **in order and rejects at the first failure**, so earlier ids are gone. An id not in `openTabs` rejects with `No tab with id: N.` An id in `failRemoveIds` rejects with "Tabs cannot be edited right now…".[^stub] |
| `tabs.update` | Applies `pinned`, `url`, `highlighted`, `muted` and `active`, and records each call in `tabUpdates`.[^stub] |
| `windows.create({ tabId })` | Detaching a tab into a new window drops its group, like a cross-window move.[^stub] |
| `storage.local` / `storage.session` | `get(null)` returns the whole area (recorded as `"*"`). `getKeys` (Chrome 130+) returns names only (recorded as `"<keys>"`). `set` structured-clones. `onChanged` listeners are called on a microtask, not inline.[^stub] |

# Knobs and recorders

| Knob | Effect |
|---|---|
| `failWrites` | Every `storage.set` rejects, in both areas. Drives `pushUndo` durability tests.[^stub] |
| `failRemoveIds` | Open tabs `tabs.remove` refuses. To simulate an already-gone id, leave it out of `openTabs`.[^stub] |
| `failGroup` | `tabs.group` rejects.[^stub] |
| `failCreateUrls` | `tabs.create` rejects for those URLs.[^stub] |
| `failScriptingIds` | `scripting.executeScript` rejects, as it does without host permissions.[^stub] |

Recorders: `created`, `removedIds`, `ungroupedIds`, `discardedIds`, `reloadedIds`, `scriptedIds`, `moves`, `groupMoves`, `groupUpdates`, `tabUpdates`, `storageReads`, `changeListeners`.[^stub]

# The 0.7.2 lesson

`acffcde` changed `tabs.remove` to reject the whole array and remove nothing, "the way Chrome does", and shipped `/dedup`'s fix validated against that model.[^commit-acffcde] Chromium actually removes in order and stops at the first failure. `54b3787` corrected the stub and added the refused-tab knob. A hand-patched `remove` in `query.test.ts` went away in the same change.[^commit-54b3787] Before encoding a Chrome behaviour in the stub, check it against Chromium's source or a real browser. The corrected `remove` comment names the Chromium function it follows.

# How tests use it

- Call `stub = installChromeStub()` in `beforeEach`. Each install starts clean, and so does the undo stack, which lives only in the stub's session area.[^stub][^undo-test] Module-level state in the code under test is **not** reset.
- A module that touches `chrome` at import time needs the stub first. `rules.ts` registers `storage.onChanged` at module scope, so `rules-cache.test.ts` installs, calls `vi.resetModules()`, and re-imports per test.[^rules-cache-test] `pin.ts` does the same for its lock-list cache, and `pin-cache.test.ts` follows the same pattern. Every other test imports these modules before any stub exists, so their caches stay unarmed there and a direct write to `stub.localData` is always read back.
- APIs the stub lacks (`sessions`, `readingList`, `sidePanel`) are assigned onto `globalThis.chrome` ad hoc in the test.
- `lib/workspace.test.ts` and `lib/sessions.test.ts` build their own `chrome` fake instead. The workspace fake's `remove` always succeeds.[^workspace-test]
- `vitest.config.ts` includes `{lib,entrypoints,components}/**/*.test.ts`, widened from `lib/**/*.test.ts` in `3431468`. There are no setup files, so every test installs what it needs.[^vitest-config][^commit-3431468] No test files currently exist under `entrypoints/` or `components/`.

# Not modelled (known blind spots)

- `tabs.create` ignores `windowId` and `index`: new tabs land in window 1 with no index. Assert on `created` instead.[^stub]
- `tabs.remove` neither reindexes the remaining tabs nor drops an emptied group. Undo tests clear `groups` by hand.[^stub][^undo-test]
- `tabs.move` of several ids removes them all and inserts them at `index`. Chromium places them one after another (`TabsMoveFunction::MoveTab`), which gives a different strip when a tab travels rightward. The stub also never applies `TabStripModel::GetGroupToAssign`: in Chrome a tab moved away from its group leaves it, and a tab dropped between two tabs of one group joins it. `tabs.ungroup` does not move the tab out to the group's edge the way Chrome does. `executeUndo`'s order restore only issues moves where both models agree.[^stub][^undo-ts]
- No `tabs.get`, `tabGroups.get`, tab events, `runtime`, `alarms` or `contextMenus`. The background service worker, the main user of these, has no tests.[^stub]
- `tabGroups.update` never rejects (for example on Chrome's saved groups), and `discard`/`reload` only record.[^stub]

# Rule of thumb for adding fidelity

Add fidelity when a test can pass for the wrong reason, and write the comment that says which wrong reason. That is the pattern in most modelled rows above: the `active` filter, the `move` reflow, the cross-window group rejection and the in-order `remove` each exist because a looser stub let an assertion pass vacuously or let a wrong fix pass.[^stub][^commit-54b3787] Knobs are opt-in (all off by default), so an uninstrumented test runs the happy path.

# Related

- [Tab closing](/architecture/tab-closing.md)
- [Undo stack](/architecture/undo-stack.md)
- [Bulk lock](/architecture/bulk-lock.md)
- [Release process](/processes/release.md)

[^stub]: lib/testing/chrome-stub.ts
[^vitest-config]: vitest.config.ts
[^undo-test]: lib/undo.test.ts
[^undo-ts]: lib/undo.ts
[^rules-cache-test]: lib/rules-cache.test.ts
[^workspace-test]: lib/workspace.test.ts
[^commit-3431468]: Commit 3431468
[^commit-acffcde]: Commit acffcde
[^commit-54b3787]: Commit 54b3787
