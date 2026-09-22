---
type: Architecture
title: Architecture overview
description: How TabOrdo's MV3 entrypoints, lib modules, command dispatch and storage areas fit together, and which realm owns what.
tags: [architecture, mv3, storage, realms]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T21:00:00Z }
sources:
  - id: wxt-config
    resource: https://github.com/samhvw8/TabOrdo/blob/main/wxt.config.ts
    title: WXT config and manifest
    last_modified: 2026-07-27
  - id: background
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: Background service worker
    last_modified: 2026-09-22
  - id: automation-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/automation.ts
    title: The worker's tab automations
    last_modified: 2026-09-22
  - id: locksync-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/locksync.ts
    title: The worker's lock sync and restart reconcile
    last_modified: 2026-09-22
  - id: menus-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/menus.ts
    title: Action-icon menu
    last_modified: 2026-09-22
  - id: arrange-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/arrange.ts
    title: Group and Sort shared by tiles and menu
    last_modified: 2026-09-22
  - id: aigroup-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/aigroup.ts
    title: The /aigroup runner
    last_modified: 2026-09-22
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Popup and side panel component
    last_modified: 2026-09-22
  - id: sidepanel-main
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/sidepanel/main.ts
    title: Side panel mount
    last_modified: 2026-07-27
  - id: tabs-barrel
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/index.ts
    title: lib/tabs barrel
    last_modified: 2026-08-15
  - id: actions-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: Action and tile handlers
    last_modified: 2026-09-22
  - id: search-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/search.ts
    title: Search and parseCommand
    last_modified: 2026-08-21
  - id: tree-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/tree.ts
    title: Tab lineage map
    last_modified: 2026-08-21
  - id: undo-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.ts
    title: Undo stack
    last_modified: 2026-09-17
  - id: pin-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/pin.ts
    title: Lock lists
    last_modified: 2026-09-17
  - id: group-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/group.ts
    title: Creating and rebuilding tab groups
    last_modified: 2026-09-22
  - id: url-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/url.ts
    title: URL helpers
    last_modified: 2026-09-22
  - id: commit-7e3e91a
    resource: https://github.com/samhvw8/TabOrdo/commit/7e3e91acea53a8c29ffe62bb2ed40367d17bab09
    title: "refactor: split lib/tabs, extract action and dashboard registries"
    last_modified: 2026-07-29
---

# Overview

TabOrdo is a Chrome MV3 extension built with WXT, Svelte 5 and TypeScript. Four entrypoints run in separate JavaScript realms and share state only through `chrome.storage` and `chrome.runtime` messages. Almost all behaviour lives in `lib/`, so it can be unit-tested against the [chrome stub](/testing/chrome-stub.md) without mounting a component.

# Entrypoints

| Entrypoint | Realm | Role |
|---|---|---|
| `entrypoints/background/index.ts` | Service worker | Wiring only. Registers the tab listeners (auto-group, auto-sort, auto-ungroup, switch-to-existing, pin follow, lock sync, lineage), the context menu, the auto-discard alarm and the `/aigroup` runner, and hands each event to a lib function. Only the lineage listeners keep their bodies inline.[^background] |
| `entrypoints/popup/` | Action popup, 450x600 | Mounts `App.svelte`. Chrome tears it down on any focus loss.[^popup-app] `RulesEditor`, `PinsPanel` and `SettingsPanel` are dynamic imports in their own chunks (75 KB of the 391 KB App chunk), started in `requestIdleCallback` after first paint so a panel opens from a settled promise with no blank frame.[^popup-app] |
| `entrypoints/sidepanel/` | Side panel | Mounts the **same** `popup/App.svelte` with `fluid: true`.[^sidepanel-main] Declared as `side_panel.default_path` in the manifest.[^wxt-config] |
| `entrypoints/archive/` | Extension tab page | Browses and restores archived tabs; opened via `chrome.runtime.getURL("/archive.html")`.[^popup-app] |

Every background listener is registered through `register()`, so one throwing registration (for example an absent `chrome.commands`) costs only that feature instead of aborting the rest of the worker script.[^background]

# lib layout

- `lib/tabs/` holds one module per concern behind the `lib/tabs/index.ts` barrel: `types`, `query`, `sort`, `group`, `dedup`, `window`, `close`, `media`, `order`, `lock`, `tree`. Import sites use the barrel, so the split can move freely. It replaced a 971-line `lib/tabs.ts`.[^tabs-barrel][^commit-7e3e91a]
- Every group TabOrdo builds goes through `buildGroup` in `lib/tabs/group.ts`: join a live group, or create one in a window and set its title, colour and collapsed state. `gatherIntoGroup` first moves tabs sitting in other windows, because `chrome.tabs.group` rejects ids that span windows. Undo, the cross-window movers, domain grouping and `/branch` all use them.[^group-ts]
- `lib/url.ts` holds the two "is this a page" rules, kept apart on purpose. `isSaveablePage` leaves out `chrome://` and `chrome-extension://` pages, for focus mode, the Reading List and `/save`. `isReopenablePage` drops only an empty URL or `chrome://newtab/`, for undo and the archive.[^url-ts]
- `lib/tabs/tree.ts` write serialisation assumes the background is the only writer. The popup and side panel import the barrel too, so keep `recordOpener` and `forgetTab` calls in the background.[^tabs-barrel]
- The worker's listener bodies are lib modules: `automation.ts` (auto-group, auto-ungroup, auto-sort, switch-to-existing, pin follow), `locksync.ts`, `discard.ts`, `menus.ts`, `aigroup.ts`, and `selfwrite.ts` for the self-write ledger. They take the worker's in-memory state as a parameter, so tests call them against the stub ([background automation](/features/background-automation.md)).[^automation-ts][^background]
- `lib/arrange.ts` holds Group and Sort by domain for the dashboard tiles and the action-icon menu, each taking the undo snapshot, so the two surfaces cannot drift apart.[^arrange-ts]
- `lib/actions.ts` holds `ACTION_HANDLERS`, one async handler per slash command. `lib/commands.ts` is the command catalogue and `lib/dashboard.ts` the dashboard tile catalogue.[^actions-ts][^commit-7e3e91a]
- Cross-cutting modules: `undo.ts` ([undo stack](/architecture/undo-stack.md)), `bulklock.ts` ([bulk lock](/architecture/bulk-lock.md)), `rules.ts`, `pin.ts`, `archive.ts`, `workspace.ts`, `search.ts`, `ai.ts`, `actionLog.ts`, `url.ts`.

# How a command flows

1. **Palette.** On Enter, `parseCommand(query)` splits `/prefix rest` (or a known `@` triage prefix) into `{ prefix, query }`.[^search-ts] If the prefix is in `ACTION_PREFIXES` (built from `ACTION_COMMANDS`), `handleActionCommand` runs. Other prefixes are searches handled by `handlePrefixSearch`.[^popup-app]
2. `handleActionCommand` returns early while `busy` is set. It sends `/aigroup` to `startAIGroup()` **before** taking the lock. Everything else sets `busy` and runs `runAction(prefix, ctx)` inside `withBulkLock`.[^popup-app] `runAction` looks up `ACTION_HANDLERS[prefix]` and returns `null` when no handler exists.[^actions-ts]
3. The handler returns an `ActionResult`: `message`, `acted`, `workspaceChanged`, `results` or `closePopup`. The component turns that into a status flash, an undo-button refresh and a tab reload.[^actions-ts][^popup-app]
4. **Dashboard tiles** go through `dashAction(fn)`, which uses the same `busy` guard and `withBulkLock`. It refreshes `canUndo` and the tab list even when `fn` throws, because a partial close is a real outcome.[^popup-app] A tile click falls through `handleOverflowAction` to `dashTile(id)`, which runs `runTile(id, ctx)`: the tile's own handler from `TILE_HANDLERS` when the action table marks it `own` (Group+, Ungroup, Regroup), else the same `ACTION_HANDLERS` entry as the slash command, so the two share one handler and one status text.[^popup-app][^actions-ts] `dashCommand(prefix, query, tabs)` runs a command's handler directly, for the selection bar's Close, Archive and Discard and for alt-clicks that carry an argument. Only Focus, Lock Tab, AI Group, Recent and Archive keep a `case`, because each needs component state or leaves the dashboard.[^popup-app]
5. **Context menus** are served by the worker (`lib/menus.ts`). Group by domain, dedup and sort run inside `withBulkLock`, the same suppression the palette takes. Without it the automations react to the very mutations those entries make. Group and Sort call the same `lib/arrange.ts` functions as the dashboard tiles.[^menus-ts][^arrange-ts]
6. **`/aigroup`** is a `chrome.runtime.sendMessage({ type: "aigroup-start" })` to the background. `runAIGroup` (`lib/aigroup.ts`), run by the worker, holds and renews its own lease.[^aigroup-ts][^background] The AI Group tile takes the same path, also before the lock.[^popup-app]

# Storage: local vs session

| Area | Keys | Why this area |
|---|---|---|
| `chrome.storage.local` | `rulesConfig`, `pinnedTabs`, `pinnedGroups`, `tabOrdo_archive`, `tabOrdo_archiveCount`, `tabOrdo_actionLog`, `tabOrdo_workspaces`, and popup prefs `collapsedGroups`, `dashboardActionIds`, `onboardingDismissed` | User data and settings that must survive a browser restart. |
| `chrome.storage.session` | `tabOrdo_undo:<id>`, `bulkOpLock:<owner>`, `tabParents`, `tabOrdo_aiGroupProgress`, `openMode` | State keyed to tab ids or to live runs. Tab ids are per browser session, and the next session reuses the same small range, so a map that outlived the session would point at unrelated tabs.[^tree-ts][^undo-ts] |

Pins are the exception: they sit in `local` with a `tabId`, so the worker's `runtime.onStartup` clears those ids, and the worker then matches each lock to its restored tab by URL, once at startup and again as restored tabs are created and load ([position locks](/features/position-locks.md)).[^locksync-ts]

# Realms share storage, not memory

The popup and the side panel are the same component in two realms. Each has its own module instances (write chains, queues) over one shared storage area.[^undo-ts][^pin-ts] So:

- Shared state is read from storage, not kept in module memory. The undo stack lists storage each time (see [undo stack](/architecture/undo-stack.md)), and so do the config and lock-list readers ([position locks](/features/position-locks.md), [grouping rules](/features/grouping-rules.md)): a read costs about 0.15 ms, and a copy held in one realm goes stale when another writes.[^undo-ts][^pin-ts]
- `chrome.storage.session` has no compare-and-swap. A lock cannot be a refcount or a shared map, which is why the [bulk lock](/architecture/bulk-lock.md) uses one key per owner.
- The component subscribes to `chrome.storage.onChanged` for `rulesConfig`, the action log, AI progress and the undo stack's entry keys (`touchesUndoStack`), so a side panel left open stays current.[^popup-app][^undo-ts]
- The background also writes the undo stack: the context-menu dedup calls `closeTabs`, which snapshots, and the menu's Group and Sort snapshot through `lib/arrange.ts`.[^menus-ts][^arrange-ts]

# Related

- [Tab closing invariant](/architecture/tab-closing.md)
- [Command palette](/features/command-palette.md)
- [Background automation](/features/background-automation.md)
- [Product overview](/tabordo.md)

[^wxt-config]: wxt.config.ts
[^background]: entrypoints/background/index.ts
[^automation-ts]: lib/automation.ts
[^locksync-ts]: lib/locksync.ts
[^menus-ts]: lib/menus.ts
[^arrange-ts]: lib/arrange.ts
[^aigroup-ts]: lib/aigroup.ts
[^popup-app]: entrypoints/popup/App.svelte
[^sidepanel-main]: entrypoints/sidepanel/main.ts
[^tabs-barrel]: lib/tabs/index.ts
[^actions-ts]: lib/actions.ts
[^search-ts]: lib/search.ts
[^tree-ts]: lib/tabs/tree.ts
[^undo-ts]: lib/undo.ts
[^pin-ts]: lib/pin.ts
[^group-ts]: lib/tabs/group.ts
[^url-ts]: lib/url.ts
[^commit-7e3e91a]: Commit 7e3e91a
