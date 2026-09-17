---
type: Feature
title: Focus mode and workspace files
description: /focus and /unfocus park the current window's tabs on a LIFO stack in chrome.storage.local and bring them back, while /save and /load export and import tab lists as text files.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/workspace.ts
tags: [workspace, focus-mode, import-export]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T00:16:05Z }
sources:
  - id: workspace-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/workspace.ts
    title: Workspace stack and text export
    last_modified: 2026-09-17
  - id: close-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/close.ts
    title: closeTabs snapshot option
    last_modified: 2026-09-17
  - id: actions-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: /focus, /unfocus, /save, /load handlers
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Focus tile, file picker
    last_modified: 2026-09-17
  - id: workspace-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/workspace.test.ts
    title: Workspace tests
    last_modified: 2026-09-17
  - id: actions-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.test.ts
    title: Handler tests
    last_modified: 2026-08-21
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG
    last_modified: 2026-09-17
  - id: commit-831b77c
    resource: https://github.com/samhvw8/TabOrdo/commit/831b77c
    title: "Fix focusMode data loss: stack workspaces instead of overwriting single slot"
    last_modified: 2026-07-17
  - id: commit-1e5a1df
    resource: https://github.com/samhvw8/TabOrdo/commit/1e5a1df
    title: "fix: dedup identity, undo close fidelity, ignore-list reach in lib"
    last_modified: 2026-08-02
  - id: commit-54b3787
    resource: https://github.com/samhvw8/TabOrdo/commit/54b3787
    title: "fix: route every tab close through one path"
    last_modified: 2026-09-17
---

# Overview

Two separate ways to set tabs aside, both in `lib/workspace.ts`:[^workspace-ts]

| Feature | Stores | Restores |
|---------|--------|----------|
| `/focus`, `/unfocus` | A stack of workspaces in `chrome.storage.local` | The newest workspace, into the current window |
| `/save`, `/load` | A downloaded `.txt` file | A new window |

# Focus stack

Storage:[^workspace-ts]

| Key | Value |
|-----|-------|
| `tabOrdo_workspaces` | `SavedWorkspace[]`, oldest first: `{ tabs: { url, pinned }[], savedAt }` |
| `tabOrdo_workspace` | Legacy single slot, folded into the stack on read |

`/focus` (`focusMode`):[^workspace-ts]

1. Take the current window's tabs, skipping `chrome://` and `chrome-extension://` pages, which stay open.
2. None left: return 0 ("No tabs to save") and write nothing.
3. Push the workspace and **persist the stack**.
4. Open a new active tab.
5. `closeTabs(ids, { snapshot: false })`.

`/unfocus` (`unfocusMode`): pop the newest workspace; create each tab inactive with its pinned state, logging and skipping any URL Chrome refuses; **persist the stack whatever happened**; report how many came back.[^workspace-ts]

# Invariants

- The workspace is on disk before any tab closes.[^workspace-ts][^workspace-test]
- Workspaces restore last in, first out.[^workspace-test][^changelog]
- A restore consumes its workspace, even a partial one.[^workspace-ts]
- Only `url` and `pinned` are kept: no titles, groups or source window.[^workspace-ts]

# Why it is this way

- **A stack**: saving a second workspace while one was saved overwrote the single slot, after the first workspace's tabs had already closed. Fixed in 0.5.0.[^changelog][^commit-831b77c]
- **Persist before closing**: a failure mid-close can then never lose tabs.[^workspace-ts]
- **Consume on partial restore**: one URL Chrome refuses to open (`file://`, `view-source:`) used to throw out of the loop before the popped stack was saved, so a retry reopened every tab that had already come back.[^workspace-ts][^commit-1e5a1df]
- **No undo snapshot**: the stack just written is this close's recovery, and `/unfocus` reads it. A Ctrl+Z entry for the same tabs would let Ctrl+Z followed by `/unfocus` reopen each tab twice.[^workspace-ts][^close-ts] Focus mode used to call `chrome.tabs.remove` directly and so never snapshotted; since `closeTabs` became the only close path, the opt-out is an explicit `snapshot: false`, and the close now goes tab by tab like every other.[^commit-54b3787] See [tab closing](/architecture/tab-closing.md) and [undo stack](/architecture/undo-stack.md).

# Legacy single-slot migration

`getWorkspaceStack` reads both keys in one call. A non-empty legacy workspace goes to the **bottom** of the stack, so any newer focus pops first. `saveWorkspaceStack` writes the stack, then removes the legacy key, so the migration completes on the next `/focus` or `/unfocus`.[^workspace-ts][^workspace-test] The code comment calls these "pre-0.4.4" versions; the stack fix shipped in 0.5.0.[^workspace-ts][^changelog]

# Palette versus dashboard

- Typed `/focus` always pushes a new workspace; `/unfocus` pops. Both return `workspaceChanged`, so the popup re-reads `hasSavedWorkspace()`.[^actions-ts]
- The Focus tile is a toggle: with any workspace saved it runs `unfocusMode` and is labelled "Unfocus". It asks for a second click only in the focus direction, since unfocusing restores tabs.[^popup-app]
- So a second workspace can only be stacked by typing `/focus`.[^popup-app]

# `/save` and `/load`

| | Behaviour[^workspace-ts] |
|--|-----------|
| `/save` (`exportTabsToFile`) | Current window, minus `chrome://` and `chrome-extension://`, sorted by title, one `title<TAB>url` line each, downloaded as `tabs-YYYY-MM-DD.txt` |
| `/load` (`loadTabsFromText`) | Each non-blank line's last tab-separated field (or the whole line); keeps values starting with `http`; stops at 2 MiB of URL bytes but always keeps the first; opens a new window on the first URL and adds the rest inactive and discarded |

- The popup cannot load: the OS file picker takes focus, Chrome closes the popup, and the read dies. It says to use the side panel instead, where the picker works.[^popup-app][^changelog]
- `/load` returns `acted: false` and only opens the picker; the popup's file input handler reports "Loaded N tab(s) into new window".[^actions-ts][^popup-app]
- Save and Load are an alt-click pair on the dashboard ([command palette](/features/command-palette.md)).

# Gotchas

- `/unfocus` restores into the current window, not the one the tabs came from, and ungrouped.[^workspace-ts]
- Workspace files keep no pinned state; `/load` opens everything unpinned.[^workspace-ts]
- `exportTabsToFile` uses the callback form of `tabs.query` and returns before the download is built; `/save` reports "Exporting tabs..." with no count, and a failure there never reaches the status line.[^workspace-ts][^actions-ts]
- The legacy key lingers until the next stack write.[^workspace-ts]

# Tests that guard it

| File | Guards |
|------|--------|
| `lib/workspace.test.ts` | A second focus keeps the first; persist before close; pinned state; skipped pages; partial restore consumes; legacy key restores and sits below newer focuses; `loadTabsFromText` parsing, size cap, discard[^workspace-test] |
| `lib/actions.test.ts` | `/focus` and `/unfocus` flag `workspaceChanged`; `/load` opens the picker without counting as an action[^actions-test] |

# Related

- [Archive](/features/archive.md), the other way to set tabs aside, one entry per tab
- [Tab closing](/architecture/tab-closing.md), [undo stack](/architecture/undo-stack.md)

[^workspace-ts]: lib/workspace.ts
[^close-ts]: lib/tabs/close.ts
[^actions-ts]: lib/actions.ts
[^popup-app]: entrypoints/popup/App.svelte
[^workspace-test]: lib/workspace.test.ts
[^actions-test]: lib/actions.test.ts
[^changelog]: CHANGELOG.md
[^commit-831b77c]: commit 831b77c
[^commit-1e5a1df]: commit 1e5a1df
[^commit-54b3787]: commit 54b3787
