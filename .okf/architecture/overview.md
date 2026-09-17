---
type: Architecture
title: Architecture overview
description: How TabOrdo's MV3 entrypoints, lib modules, command dispatch and storage areas fit together, and which realm owns what.
tags: [architecture, mv3, storage, realms]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T09:56:23Z }
sources:
  - id: wxt-config
    resource: https://github.com/samhvw8/TabOrdo/blob/main/wxt.config.ts
    title: WXT config and manifest
    last_modified: 2026-07-27
  - id: background
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: Background service worker
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Popup and side panel component
    last_modified: 2026-09-17
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
    title: Palette action handlers
    last_modified: 2026-09-17
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
| `entrypoints/background/index.ts` | Service worker | Tab listeners (auto-group, auto-sort, auto-ungroup, switch-to-existing, pin follow, lineage), context menus, the auto-discard alarm, and the `/aigroup` runner.[^background] |
| `entrypoints/popup/` | Action popup, 450x600 | Mounts `App.svelte`. Chrome tears it down on any focus loss.[^popup-app] `RulesEditor`, `PinsPanel` and `SettingsPanel` are dynamic imports in their own chunks (75 KB of the 391 KB App chunk), started in `requestIdleCallback` after first paint so a panel opens from a settled promise with no blank frame.[^popup-app] |
| `entrypoints/sidepanel/` | Side panel | Mounts the **same** `popup/App.svelte` with `fluid: true`.[^sidepanel-main] Declared as `side_panel.default_path` in the manifest.[^wxt-config] |
| `entrypoints/archive/` | Extension tab page | Browses and restores archived tabs; opened via `chrome.runtime.getURL("/archive.html")`.[^popup-app] |

Every background listener is registered through `register()`, so one throwing registration (for example an absent `chrome.commands`) costs only that feature instead of aborting the rest of the worker script.[^background]

# lib layout

- `lib/tabs/` holds one module per concern behind the `lib/tabs/index.ts` barrel: `types`, `query`, `sort`, `group`, `dedup`, `window`, `close`, `media`, `order`, `lock`, `tree`. Import sites use the barrel, so the split can move freely. It replaced a 971-line `lib/tabs.ts`.[^tabs-barrel][^commit-7e3e91a]
- `lib/tabs/tree.ts` write serialisation assumes the background is the only writer. The popup and side panel import the barrel too, so keep `recordOpener` and `forgetTab` calls in the background.[^tabs-barrel]
- `lib/actions.ts` holds `ACTION_HANDLERS`, one async handler per slash command. `lib/commands.ts` is the command catalogue and `lib/dashboard.ts` the dashboard tile catalogue.[^actions-ts][^commit-7e3e91a]
- Cross-cutting modules: `undo.ts` ([undo stack](/architecture/undo-stack.md)), `bulklock.ts` ([bulk lock](/architecture/bulk-lock.md)), `rules.ts`, `pin.ts`, `archive.ts`, `workspace.ts`, `search.ts`, `ai.ts`, `actionLog.ts`, `url.ts`.

# How a command flows

1. **Palette.** On Enter, `parseCommand(query)` splits `/prefix rest` (or a known `@` triage prefix) into `{ prefix, query }`.[^search-ts] If the prefix is in `ACTION_PREFIXES` (built from `ACTION_COMMANDS`), `handleActionCommand` runs. Other prefixes are searches handled by `handlePrefixSearch`.[^popup-app]
2. `handleActionCommand` returns early while `busy` is set. It sends `/aigroup` to `startAIGroup()` **before** taking the lock. Everything else sets `busy` and runs `runAction(prefix, ctx)` inside `withBulkLock`.[^popup-app] `runAction` looks up `ACTION_HANDLERS[prefix]` and returns `null` when no handler exists.[^actions-ts]
3. The handler returns an `ActionResult`: `message`, `acted`, `workspaceChanged`, `results` or `closePopup`. The component turns that into a status flash, an undo-button refresh and a tab reload.[^actions-ts][^popup-app]
4. **Dashboard tiles** go through `dashAction(fn)`, which uses the same `busy` guard and `withBulkLock`. It refreshes `canUndo` and the tab list even when `fn` throws, because a partial close is a real outcome.[^popup-app] `dashCommand(prefix, query, tabs)` wraps `dashAction` around `runAction`, so a tile and its slash command share one handler. Only some tiles use it (the selection Close and Archive buttons, collapse, extract, branch and others). Several tiles, such as closeleft and dedup, still call `lib` functions inline in `handleOverflowAction`.[^popup-app]
5. **Context menus** live in the background. Group by domain, dedup and sort run inside `withBulkLock`, the same suppression the palette takes. Without it the automations react to the very mutations those entries make.[^background]
6. **`/aigroup`** is a `chrome.runtime.sendMessage({ type: "aigroup-start" })` to the background. The background's `runAIGroup` holds and renews its own lease.[^background]

# Storage: local vs session

| Area | Keys | Why this area |
|---|---|---|
| `chrome.storage.local` | `rulesConfig`, `pinnedTabs`, `pinnedGroups`, `tabOrdo_archive`, `tabOrdo_archiveCount`, `tabOrdo_actionLog`, `tabOrdo_workspaces`, and popup prefs `collapsedGroups`, `dashboardActionIds`, `onboardingDismissed` | User data and settings that must survive a browser restart. |
| `chrome.storage.session` | `tabOrdo_undo:<id>` and `tabOrdo_undoMeta:<id>`, `bulkOpLock:<owner>`, `tabParents`, `tabOrdo_aiGroupProgress`, `openMode` | State keyed to tab ids or to live runs. Tab ids are per browser session, and the next session reuses the same small range, so a map that outlived the session would point at unrelated tabs.[^tree-ts][^undo-ts] |

Pins are the exception: they sit in `local` with a `tabId`, so the background's `runtime.onStartup` clears those ids and URL matching backfills fresh ones.[^background]

# Realms share storage, not memory

The popup and the side panel are the same component in two realms. Each has its own module instances (the undo mirror, write chains, config cache) over one shared storage area.[^undo-ts] So:

- Any module-level cache of shared state must re-read before it mutates. See `syncFromStorage` in the [undo stack](/architecture/undo-stack.md).
- `chrome.storage.session` has no compare-and-swap. A lock cannot be a refcount or a shared map, which is why the [bulk lock](/architecture/bulk-lock.md) uses one key per owner.
- The component subscribes to `chrome.storage.onChanged` for `rulesConfig`, the action log, AI progress and the undo key, so a side panel left open stays current.[^popup-app]
- The background also writes the undo stack: the context-menu dedup calls `closeTabs`, which snapshots.[^background]

# Related

- [Tab closing invariant](/architecture/tab-closing.md)
- [Command palette](/features/command-palette.md)
- [Background automation](/features/background-automation.md)
- [Product overview](/tabordo.md)

[^wxt-config]: wxt.config.ts
[^background]: entrypoints/background/index.ts
[^popup-app]: entrypoints/popup/App.svelte
[^sidepanel-main]: entrypoints/sidepanel/main.ts
[^tabs-barrel]: lib/tabs/index.ts
[^actions-ts]: lib/actions.ts
[^search-ts]: lib/search.ts
[^tree-ts]: lib/tabs/tree.ts
[^undo-ts]: lib/undo.ts
[^commit-7e3e91a]: Commit 7e3e91a
