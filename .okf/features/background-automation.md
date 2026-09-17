---
type: Feature
title: Background automation
description: The service worker's tab listeners (auto-group, auto-ungroup, auto-sort, pin follow, auto-discard, switch-to-existing, context menus) and the guards that keep them from fighting other extensions or each other.
resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
tags: [background, service-worker, automation, auto-group, coexistence]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T09:48:15Z }
sources:
  - id: bg-index
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: entrypoints/background/index.ts
    last_modified: 2026-09-17
  - id: group
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/group.ts
    title: lib/tabs/group.ts (planDomainGroup)
    last_modified: 2026-09-17
  - id: url
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/url.ts
    title: lib/url.ts (getGroupNameMapper)
    last_modified: 2026-09-17
  - id: bounce
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bounce.ts
    title: lib/bounce.ts
    last_modified: 2026-07-17
  - id: bounce-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bounce.test.ts
    title: lib/bounce.test.ts
    last_modified: 2026-07-17
  - id: action-log
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actionLog.ts
    title: lib/actionLog.ts
    last_modified: 2026-07-18
  - id: action-log-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actionLog.test.ts
    title: lib/actionLog.test.ts
    last_modified: 2026-07-18
  - id: close
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/close.ts
    title: lib/tabs/close.ts
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: entrypoints/popup/App.svelte (toggle row)
    last_modified: 2026-09-17
  - id: settings-panel
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/SettingsPanel.svelte
    title: components/SettingsPanel.svelte
    last_modified: 2026-07-18
  - id: commit-untitled
    resource: https://github.com/samhvw8/TabOrdo/commit/576f1c496b27b3cd84650a40439f82981f2142fc
    title: "fix: skip untitled groups in auto-ungroup to stop fighting other extensions"
    last_modified: 2026-07-18
  - id: commit-coexist
    resource: https://github.com/samhvw8/TabOrdo/commit/ae3793c16a9bbc3e31552b7b33e8e1a36508f0ce
    title: "feat: add coexistence guards and automation activity log"
    last_modified: 2026-07-18
  - id: commit-steal
    resource: https://github.com/samhvw8/TabOrdo/commit/ebf8663703ee204c7a27b59500d7695b37da9937
    title: Fix auto-group stealing tabs from existing groups
    last_modified: 2026-05-25
  - id: commit-race
    resource: https://github.com/samhvw8/TabOrdo/commit/bf66e00dfac2d1fb5a4683320c1cc402054f89e1
    title: Fix auto-group race condition with extension-created tabs
    last_modified: 2026-05-25
  - id: commit-guards
    resource: https://github.com/samhvw8/TabOrdo/commit/34314682268915f701ab683590a45f2f4a7c20c6
    title: "fix: AI-progress lease, listener crash guards, stricter chrome stub"
    last_modified: 2026-08-02
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md (0.6.0)
    last_modified: 2026-09-17
---

# Overview

`entrypoints/background/index.ts` is the MV3 service worker. Every automation is off by default and driven by a flag in the shared `rulesConfig` object (see [grouping rules](/features/grouping-rules.md)); listeners read it through the cached `getConfig()` on each event.[^bg-index] The popup's toggle row writes the flags.[^popup-app]

| Flag | Toggle label | Trigger | Effect |
|------|--------------|---------|--------|
| `autoGroup` (+ `useRules`) | Auto (+ Rules) | `tabs.onUpdated` with a URL change | Put the tab in a rule or domain group |
| `autoUngroup` | Ungroup | tab removed/detached, `groupId` change, after auto-group, flag switched on | Dissolve **named** single-tab groups |
| `autoSort` | Sort | `tabs.onUpdated` with `status: "complete"` | `sortTabsInWindow(windowId)` (domain sort) |
| `autoPinFollow` | Pin | `changeInfo.pinned` | Apply the same Chrome pin state to every other tab with the identical URL |
| `autoDiscard` | Discard | `autoDiscard` alarm, every 5 min | Discard tabs not accessed for 45 min |
| `switchToExisting` | Switch | first navigation of a new foreground tab | Focus an open copy, close the new tab |

# Behaviour

**Auto-group.** Skipped for Chrome-pinned tabs and while the [bulk lock](/architecture/bulk-lock.md) is held. A tab created under 300 ms ago waits out the rest of that window, then the tab is re-read and only a still-ungrouped tab is grouped.[^bg-index] The wait gives other extensions time to group their own tabs,[^commit-race] and the re-read stops TabOrdo stealing a tab Chrome is about to put in its opener's group.[^commit-steal] `chrome://` URLs and ignored URLs are not grouped. With `useRules` on, the first matching rule wins: join a non-shared group in the same window titled with the rule name, or create a one-tab group (also when that join fails).[^bg-index] Otherwise `planDomainGroup` decides by the site's **group name**, the registrable domain without its public suffix (`github.com` → `github`, `bbc.co.uk` → `bbc`; hosts with no registrable domain, such as `localhost`, keep the hostname).[^url] It joins a non-shared group titled with that name, or with the full domain, which is what groups made before the rename are called. When there is none, or the join fails, it creates a group only if the window holds another ungrouped, unpinned, non-ignored tab with the same name. The colour is `GROUP_COLORS[hash(name)]`.[^group]

A failed domain join used to fall back to a group of the tab alone, the same way the rule path does. A join fails when the group has gone by the time it is reached, and auto-ungroup dissolving it for having one tab left is one way that happens, so the fallback made groups of one tab. Pinned tabs and ignored URLs also used to count as the second tab.[^group]

**Auto-ungroup.** Debounced 150 ms per window. For each group with exactly one tab it skips shared groups, groups younger than 2 s (it re-checks them later), untitled groups, groups named after a rule while `useRules` is on, and names on the ignore list.[^bg-index] Only named groups are touched because untitled single-tab groups made by other tools (the commit names Claude-in-Chrome MCP) were dissolved at once, and the other tool then deleted and recreated them in a loop. TabOrdo's own groups always have titles.[^commit-untitled] Because rule-named groups are exempt, a one-tab group created by a rule is left alone.

**Auto-sort.** This runs in the same listener as auto-group, after it. Auto-group is awaited first so the sort sees the group it just made; split into two listeners, the two would interleave.[^bg-index] Locks and sort priority apply ([position locks](/features/position-locks.md), [sort priority](/features/sort-priority.md)).

**Pin follow.** This has its own listener, because folding it into the grouping listener cost two storage round-trips per pin toggle. It is guarded by `pinSyncInProgress` plus a separate `pinSelfWrites` ledger: Chrome delivers the `onUpdated` echoes of our own `tabs.update` calls after the flag has cleared.[^bg-index]

**Auto-discard.** The alarm is created in `onInstalled` and recreated in `onStartup` if it is missing. It skips tabs that are active, pinned, audible, already discarded or `frozen`.[^bg-index]

**Switch to existing (`lib/bounce.ts`).** This fires only for an active tab created within the last 2 s, on a URL change, and not under the bulk lock.[^bg-index] `findBounceTarget` accepts only `http(s)` URLs and matches an exact URL string. It picks the most recently accessed copy, and returns nothing when the new tab's URL equals its opener's URL, which is how Chrome's "Duplicate Tab" works.[^bounce] The worker focuses the target and its window, then `closeTabs([tabId], { snapshot: false })`. No undo entry is written, because the closed tab is a second old with no history, its URL is live in the focused tab, and an entry would restore the very duplicate and push a real entry out of the 20-slot stack.[^bg-index][^close] See [tab closing](/architecture/tab-closing.md) and [undo stack](/architecture/undo-stack.md).

# Coexistence guards

| Guard | Stops |
|-------|-------|
| 300 ms grace + re-read before auto-group | Grabbing a tab another extension or Chrome is grouping |
| `GROUP_SETTLE_MS` = 2 s | Dissolving a group still being filled or titled (ours is created and then titled in two steps) |
| `selfWrites` ledger, 1 s TTL, swept on write | Reacting to echoes of our own group/ungroup calls |
| Untitled-group skip, shared-group skip (`isSharedGroup`) | Fighting external managers; Chrome refuses edits to shared groups |
| `safeGroupUpdate` swallows "Saved groups" / "not editable" errors | Crashing on saved groups |
| `isBulkLocked()` in auto-group, auto-sort, auto-ungroup, switch-to-existing | Fighting a palette, context-menu or AI bulk operation |

The settle window and the self-write ledger came in as a pair: the first generalises the untitled-group fix to every late-titling race, and the second breaks the loop where TabOrdo reacted to its own changes.[^commit-coexist] The ledger is swept on every write because entries used to be pruned only when the same id was queried again, so a recycled tab id could suppress a genuine external change.[^bg-index]

# Automation action log

`logAction(action, detail)` prepends `{ ts, action, detail }` to `tabOrdo_actionLog` in `chrome.storage.local`, keeps 20 entries, and never throws.[^action-log] Auto-group writes `Grouped`/`Created group` and auto-ungroup writes `Ungrouped`. Nothing else logs.[^bg-index] Settings shows the log under "Automation Activity",[^settings-panel] and the dashboard shows the newest entry under the toggles whenever any automation is on.[^popup-app] It exists to make conflicts with other extensions diagnosable.[^commit-coexist]

# Context menus and other listeners

- The action-icon context menu is built in `onInstalled` after `removeAll()`: Group tabs by domain, Remove duplicate tabs, Sort tabs by domain, Save to Reading List (only if `chrome.readingList` exists), Discard inactive tabs, and Open in Side Panel (only if `chrome.sidePanel` exists). The first three run under `withBulkLock`, because without it the automations reacted to the menu's own changes.[^bg-index][^changelog]
- `commands.onCommand` `open-dashboard` sets `openMode` in session storage and calls `chrome.action.openPopup()`, removing the flag if that call fails.
- `runtime.onMessage` `aigroup-start` runs [AI grouping](/features/ai-grouping.md) and always answers. `onStartup` clears stored lock tab ids. Two lineage listeners feed [branch lineage](/features/branch-lineage.md).[^bg-index]

# Invariants

- Every listener is registered through `register(what, fn)`. The listeners run at the top level of the worker, so a throw while registering one used to stop every listener after it from registering; `register` catches and logs it instead.[^bg-index][^commit-guards]
- `register` only guards registration. Errors inside an async callback need the callback's own try/catch. Most have one, but `getConfig()` in the auto-group listener, the auto-sort call and the alarm handler run outside any try.[^bg-index]
- The ignored-URL check guards only the grouping block. It used to wrap auto-ungroup and auto-sort too.[^bg-index][^changelog]
- Each tab close goes through `closeTabs`.[^close]

# Gotchas

- Auto-sort re-plans the whole window every time any tab finishes loading: it queries the window's tabs and groups each time. It only moves the blocks that are out of place, though, so a window that is already sorted costs no moves ([sort priority](/features/sort-priority.md)).
- Switch-to-existing compares raw URLs, while [dedup](/features/dedup.md) normalises them, so the two disagree on tracking parameters.
- The "Discard inactive tabs" menu item ignores age and `frozen`, unlike the alarm.[^bg-index]
- `groupCreatedAt` lives in memory, so after a worker restart older groups count as settled.

# Tests that guard it

Nothing imports the entrypoint. The logic it calls is tested: `lib/tabs/group.test.ts` "planDomainGroup" (join by name or legacy full-domain title, never a shared group, no partner for a lone tab, pinned and ignored tabs are not partners),[^group] `lib/bounce.test.ts` (Duplicate-Tab skip, most-recent copy, http(s) only)[^bounce-test], `lib/actionLog.test.ts` (newest first, cap of 20, never throws)[^action-log-test], plus the bulk lock, rules and `closeTabs` suites. See the [chrome stub](/testing/chrome-stub.md).

# Related

[Architecture overview](/architecture/overview.md) · [Bulk lock](/architecture/bulk-lock.md) · [Grouping rules](/features/grouping-rules.md) · [Position locks](/features/position-locks.md) · [AI grouping](/features/ai-grouping.md)

[^bg-index]: entrypoints/background/index.ts
[^group]: lib/tabs/group.ts
[^url]: lib/url.ts
[^bounce]: lib/bounce.ts
[^bounce-test]: lib/bounce.test.ts
[^action-log]: lib/actionLog.ts
[^action-log-test]: lib/actionLog.test.ts
[^close]: lib/tabs/close.ts
[^popup-app]: entrypoints/popup/App.svelte
[^settings-panel]: components/SettingsPanel.svelte
[^commit-untitled]: commit 576f1c4
[^commit-coexist]: commit ae3793c
[^commit-steal]: commit ebf8663
[^commit-race]: commit bf66e00
[^commit-guards]: commit 3431468
[^changelog]: CHANGELOG.md
