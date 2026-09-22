---
type: Feature
title: Background automation
description: The service worker's tab listeners (auto-group, auto-ungroup, auto-sort, pin follow, auto-discard, switch-to-existing, context menus), the lib modules that hold their bodies, and the guards that keep them from fighting other extensions or each other.
resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
tags: [background, service-worker, automation, auto-group, coexistence]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T18:00:00Z }
sources:
  - id: bg-index
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: entrypoints/background/index.ts
    last_modified: 2026-09-22
  - id: automation
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/automation.ts
    title: lib/automation.ts (auto-group, auto-ungroup, auto-sort, switch-to-existing, pin follow)
    last_modified: 2026-09-22
  - id: automation-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/automation.test.ts
    title: lib/automation.test.ts
    last_modified: 2026-09-22
  - id: selfwrite
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/selfwrite.ts
    title: lib/selfwrite.ts (self-write ledger)
    last_modified: 2026-09-22
  - id: discard
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/discard.ts
    title: lib/discard.ts (discardableTabs, the auto-discard alarm)
    last_modified: 2026-09-22
  - id: discard-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/discard.test.ts
    title: lib/discard.test.ts
    last_modified: 2026-09-22
  - id: menus
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/menus.ts
    title: lib/menus.ts (action-icon menu, open-dashboard shortcut)
    last_modified: 2026-09-22
  - id: menus-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/menus.test.ts
    title: lib/menus.test.ts
    last_modified: 2026-09-22
  - id: arrange
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/arrange.ts
    title: lib/arrange.ts (groupAllByDomain, sortWindowByDomain)
    last_modified: 2026-09-22
  - id: locksync
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/locksync.ts
    title: lib/locksync.ts (lock URL sync and restart reconcile)
    last_modified: 2026-09-22
  - id: aigroup
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/aigroup.ts
    title: lib/aigroup.ts (runAIGroup)
    last_modified: 2026-09-22
  - id: group
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/group.ts
    title: lib/tabs/group.ts (planDomainGroup, domainGroupPartners)
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
    title: entrypoints/popup/App.svelte (toggle row, Group and Sort tiles)
    last_modified: 2026-09-22
  - id: rules-editor
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/RulesEditor.svelte
    title: components/RulesEditor.svelte (auto-group switch)
    last_modified: 2026-09-22
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

`entrypoints/background/index.ts` is the MV3 service worker, and it is wiring only: each listener is registered through `register()` and hands its event to a lib function.[^bg-index] The bodies live where the [chrome stub](/testing/chrome-stub.md) can test them:

| Module | Holds |
|--------|-------|
| `lib/automation.ts` | Auto-group, auto-ungroup, the auto-sort trigger, switch-to-existing, pin follow[^automation] |
| `lib/locksync.ts` | The lock URL sync and the restart reconcile ([position locks](/features/position-locks.md))[^locksync] |
| `lib/discard.ts` | `discardableTabs`, the auto-discard alarm, "unload inactive tabs"[^discard] |
| `lib/menus.ts` | The action-icon menu and the open-dashboard shortcut[^menus] |
| `lib/aigroup.ts` | `runAIGroup` ([AI grouping](/features/ai-grouping.md))[^aigroup] |
| `lib/selfwrite.ts` | The self-write ledger[^selfwrite] |

What the worker remembers between events is one `AutomationState`, created when the worker starts and passed to every automation: both self-write ledgers, group creation times, recently created tabs and the auto-ungroup timers. It lives in memory only, so a worker restart starts it empty.[^automation][^bg-index] The lineage listeners stay inline in the worker, because `lib/tabs/tree.ts` assumes the worker is its only writer ([branch lineage](/features/branch-lineage.md)).[^bg-index]

Every automation is off by default and driven by a flag in the shared `rulesConfig` object (see [grouping rules](/features/grouping-rules.md)); the automations read it through the cached `getConfig()` on each event.[^automation] The lock URL sync, which runs on every url, title and status event, reads the equally cached lock list, so a tab no lock tracks costs no storage read ([position locks](/features/position-locks.md)). The popup's toggle row writes the flags. It renders from `AUTOMATION_TOGGLES`, one row per flag with its label and tooltip, over one `automation` record that the storage subscription keeps in step with `rulesConfig`, so a flag switched in the side panel shows in the popup and the other way round.[^popup-app] The Rules editor's auto-group switch reads and flips the same record ([grouping rules](/features/grouping-rules.md)).[^rules-editor]

| Flag | Toggle label | Trigger | Effect |
|------|--------------|---------|--------|
| `autoGroup` (+ `useRules`) | Auto (+ Rules) | `tabs.onUpdated` with a URL change | Put the tab in a rule or domain group |
| `autoUngroup` | Ungroup | tab removed/detached, `groupId` change, after auto-group, flag switched on | Dissolve **named** single-tab groups |
| `autoSort` | Sort | `tabs.onUpdated` with `status: "complete"` | `sortTabsInWindow(windowId)` (domain sort) |
| `autoPinFollow` | Pin | `changeInfo.pinned` | Apply the same Chrome pin state to every other tab with the identical URL |
| `autoDiscard` | Discard | `autoDiscard` alarm, every 5 min | Discard tabs not accessed for 45 min |
| `switchToExisting` | Switch | first navigation of a new foreground tab | Focus an open copy, close the new tab |

# Behaviour

**Auto-group** (`onTabNavigated`). Skipped for Chrome-pinned tabs and while the [bulk lock](/architecture/bulk-lock.md) is held. A tab created under 300 ms ago (`NEW_TAB_GRACE_MS`) waits out the rest of that window, then the tab is re-read with `tabs.get` and only a still-ungrouped tab is grouped.[^automation] The wait gives other extensions time to group their own tabs,[^commit-race] and the re-read stops TabOrdo stealing a tab Chrome is about to put in its opener's group.[^commit-steal] `chrome://` URLs and ignored URLs are not grouped. With `useRules` on, the first matching rule wins: join a non-shared group in the same window titled with the rule name, or create a one-tab group (also when that join fails).[^automation] Otherwise `planDomainGroup` decides by the site's **group name**, the registrable domain without its public suffix (`github.com` → `github`, `bbc.co.uk` → `bbc`; hosts with no registrable domain, such as `localhost`, keep the hostname).[^url] It joins a non-shared group titled with that name, or with the full domain, which is what groups made before the rename are called. When there is none, or the join fails, the worker fetches the window's loose tabs (`groupId: -1`), and `domainGroupPartners` creates a group only if the window holds another ungrouped, unpinned, non-ignored tab with the same name. The colour is `GROUP_COLORS[hash(name)]`.[^group][^automation]

The window's groups are queried before any tabs, because a join needs no tabs. Planning the join and the partners together used to fetch every tab in the window on every URL change and then discard the list whenever the tab joined a group. `tryJoinGroup` also re-read the target with `tabGroups.get` to re-check that it was not shared, although both callers take it from a query they have just filtered with `isSharedGroup`. A group that has gone or turned shared since that query makes `tabs.group` reject, and the join returns false. A domain join now makes 6 calls (bulk-lock check, `tabs.get`, `tabGroups.query`, `tabs.group`, and the action log's read and write) where it made 8, and fetches no tabs.[^automation][^group]

A failed domain join used to fall back to a group of the tab alone, the same way the rule path does. A join fails when the group has gone by the time it is reached, and auto-ungroup dissolving it for having one tab left is one way that happens, so the fallback made groups of one tab. Pinned tabs and ignored URLs also used to count as the second tab.[^group]

**Auto-ungroup.** Debounced 150 ms per window. `planAutoUngroup` is the pure decision: for each group with exactly one tab it skips shared groups, groups younger than 2 s, untitled groups, groups named after a rule while `useRules` is on, and names on the ignore list. A young group is looked at again once the first young group in the window has settled.[^automation] Only named groups are touched because untitled single-tab groups made by other tools (the commit names Claude-in-Chrome MCP) were dissolved at once, and the other tool then deleted and recreated them in a loop. TabOrdo's own groups always have titles.[^commit-untitled] Because rule-named groups are exempt, a one-tab group created by a rule is left alone.

**Auto-sort.** This runs in the same listener as auto-group, after it. Auto-group is awaited first so the sort sees the group it just made; split into two listeners, the two would interleave.[^automation] Locks and sort priority apply ([position locks](/features/position-locks.md), [sort priority](/features/sort-priority.md)).

**Pin follow** (`followPinState`). This has its own listener, because folding it into the grouping listener cost two storage round-trips per pin toggle. The copies it updates are marked on the `pinSelfWrites` ledger first, so their `onUpdated` echoes, which Chrome delivers after the update has resolved, start no second pass.[^automation] A `pinSyncInProgress` flag used to sit beside the ledger. It could not catch those late echoes, and what it did catch was a real pin toggle on another tab arriving mid-pass, which it dropped.[^automation-test]

**Auto-discard.** The alarm is created in `onInstalled` and recreated in `onStartup` if it is missing. It discards the tabs `discardableTabs` allows that were last used more than 45 minutes ago.[^discard] `discardableTabs` is the one rule, also used without the age cutoff by the "Discard inactive tabs" menu entry and bare `/freeze`: not the active tab of any window, not Chrome-pinned, not audible, not already discarded. A tab Chrome reports no access time for counts as idle.[^discard] The three used to carry their own copies. The alarm's also spared tabs Chrome had frozen. It no longer does: frozen is the step before discarded in Chrome's tab lifecycle, and a frozen page still holds its memory.[^discard][^discard-test]

**Switch to existing (`lib/bounce.ts`).** This fires only for an active tab created within the last 2 s, on a URL change, and not under the bulk lock.[^automation] `findBounceTarget` accepts only `http(s)` URLs and matches an exact URL string. It picks the most recently accessed copy, and returns nothing when the new tab's URL equals its opener's URL, which is how Chrome's "Duplicate Tab" works.[^bounce] The worker focuses the target and its window, then `closeTabs([tabId], { snapshot: false })`. No undo entry is written, because the closed tab is a second old with no history, its URL is live in the focused tab, and an entry would restore the very duplicate and push a real entry out of the 20-slot stack.[^automation][^close] See [tab closing](/architecture/tab-closing.md) and [undo stack](/architecture/undo-stack.md).

# Coexistence guards

| Guard | Stops |
|-------|-------|
| 300 ms grace + re-read before auto-group | Grabbing a tab another extension or Chrome is grouping |
| `GROUP_SETTLE_MS` = 2 s | Dissolving a group still being filled or titled (ours is created and then titled in two steps) |
| `selfWrites` ledger, 1 s TTL, swept on write | Reacting to echoes of our own group/ungroup calls |
| Untitled-group skip, shared-group skip (`isSharedGroup`) | Fighting external managers; Chrome refuses edits to shared groups |
| `safeGroupUpdate` swallows "Saved groups" / "not editable" errors | Crashing on saved groups |
| `isBulkLocked()` in auto-group, auto-sort, auto-ungroup, switch-to-existing | Fighting a palette, context-menu or AI bulk operation |

The settle window and the self-write ledger came in as a pair: the first generalises the untitled-group fix to every late-titling race, and the second breaks the loop where TabOrdo reacted to its own changes.[^commit-coexist] Both ledgers (`selfWrites` for groups, `pinSelfWrites` for pin follow) are instances of `createSelfWriteLedger`. They stay two instances so a pin write never hides a group change on the same tab. An id is marked before the write, because Chrome delivers the echo after the call resolves. The ledger is swept on every write because entries used to be pruned only when the same id was queried again, so a recycled tab id could suppress a genuine external change.[^selfwrite]

# Automation action log

`logAction(action, detail)` prepends `{ ts, action, detail }` to `tabOrdo_actionLog` in `chrome.storage.local`, keeps 20 entries, and never throws.[^action-log] Auto-group writes `Grouped`/`Created group` and auto-ungroup writes `Ungrouped`. Nothing else logs.[^automation] Settings shows the log under "Automation Activity",[^settings-panel] and the dashboard shows the newest entry under the toggles whenever any automation is on.[^popup-app] It exists to make conflicts with other extensions diagnosable.[^commit-coexist]

# Context menus and other listeners

- The action-icon context menu is built in `onInstalled` after `removeAll()`: Group tabs by domain, Remove duplicate tabs, Sort tabs by domain, Save to Reading List, Discard inactive tabs, and Open in Side Panel. The first three run under `withBulkLock`, because without it the automations reacted to the menu's own changes.[^menus][^changelog]
- Group and Sort call `groupAllByDomain` and `sortWindowByDomain` from `lib/arrange.ts`, the functions the dashboard's Group and Sort tiles call. Each takes the undo snapshot itself. The menu entries used to call the grouping and sorting directly with no snapshot, so Ctrl+Z after one undid whatever came before it.[^arrange][^menus][^popup-app]
- `commands.onCommand` `open-dashboard` sets `openMode` in session storage and calls `chrome.action.openPopup()`, removing the flag if that call fails.[^menus]
- `runtime.onMessage` `aigroup-start` runs [AI grouping](/features/ai-grouping.md) and always answers. `onStartup` resets and reconciles lock tab ids ([position locks](/features/position-locks.md)). Two lineage listeners feed [branch lineage](/features/branch-lineage.md).[^bg-index]

# Invariants

- Every listener is registered through `register(what, fn)`. The listeners run at the top level of the worker, so a throw while registering one used to stop every listener after it from registering; `register` catches and logs it instead.[^bg-index][^commit-guards]
- `register` only guards registration. Errors inside an async callback need the callback's own try/catch. Most have one, but `getConfig()` and the auto-sort call in `onTabNavigated`, and `discardIdleTabs`, run outside any try.[^automation][^discard]
- The ignored-URL check guards only the grouping. It used to wrap auto-ungroup and auto-sort too.[^automation][^changelog]
- Each tab close goes through `closeTabs`.[^close]
- The listener bodies take their state as a parameter and hold none at module level, so each test builds a fresh `AutomationState`.[^automation][^automation-test]

# Gotchas

- Auto-sort re-plans the whole window every time any tab finishes loading: it queries the window's tabs and groups each time. It only moves the blocks that are out of place, though, so a window that is already sorted costs no moves ([sort priority](/features/sort-priority.md)).
- Switch-to-existing compares raw URLs, while [dedup](/features/dedup.md) normalises them, so the two disagree on tracking parameters.
- `groupCreatedAt` lives in memory, so after a worker restart older groups count as settled.

# Tests that guard it

- `lib/automation.test.ts`: `planAutoUngroup` (a titled single-tab group goes; untitled, shared, rule-named and ignored names stay; a young group waits and the first to settle sets the retry), the auto-ungroup run (ungroups, marks the ledger, logs, stands down under the bulk lock, comes back once a group settles), both auto-group paths (join the rule's group, make a one-tab rule group, never join a shared group, join the site's group, make a group only with a partner), its guards (Chrome-pinned tab, bulk lock, the grace and re-read, an ignored URL still scheduling auto-ungroup), auto-sort on load only, the `groupId` listener skipping our own echoes, switch-to-existing, and pin follow with the stub's `onUpdated` echoes wired up (no second pass from its own echoes, a toggle on another tab mid-pass still followed).[^automation-test]
- `lib/discard.test.ts`: the discard rule, the idle cutoff, frozen tabs discardable, the toggle.[^discard-test] `lib/menus.test.ts`: menu Group and Sort leave an undo entry that restores the strip, Discard uses the shared rule, Dedup leaves its close entry.[^menus-test]
- `lib/aigroup.test.ts`, `lib/locksync.test.ts` and `lib/selfwrite.test.ts` cover the AI runner, the lock sync and the ledger.
- Logic the automations call: `lib/tabs/group.test.ts` "planDomainGroup" and "domainGroupPartners",[^group] `lib/bounce.test.ts` (Duplicate-Tab skip, most-recent copy, http(s) only),[^bounce-test] `lib/actionLog.test.ts` (newest first, cap of 20, never throws),[^action-log-test] plus the bulk lock, rules and `closeTabs` suites.
- Nothing imports the entrypoint itself: `defineBackground` is a WXT global, and what is left there is registration.

# Related

[Architecture overview](/architecture/overview.md) · [Bulk lock](/architecture/bulk-lock.md) · [Grouping rules](/features/grouping-rules.md) · [Position locks](/features/position-locks.md) · [AI grouping](/features/ai-grouping.md) · [Chrome stub](/testing/chrome-stub.md)

[^bg-index]: entrypoints/background/index.ts
[^automation]: lib/automation.ts
[^automation-test]: lib/automation.test.ts
[^selfwrite]: lib/selfwrite.ts
[^discard]: lib/discard.ts
[^discard-test]: lib/discard.test.ts
[^menus]: lib/menus.ts
[^menus-test]: lib/menus.test.ts
[^arrange]: lib/arrange.ts
[^locksync]: lib/locksync.ts
[^aigroup]: lib/aigroup.ts
[^group]: lib/tabs/group.ts
[^url]: lib/url.ts
[^bounce]: lib/bounce.ts
[^bounce-test]: lib/bounce.test.ts
[^action-log]: lib/actionLog.ts
[^action-log-test]: lib/actionLog.test.ts
[^close]: lib/tabs/close.ts
[^popup-app]: entrypoints/popup/App.svelte
[^rules-editor]: components/RulesEditor.svelte
[^settings-panel]: components/SettingsPanel.svelte
[^commit-untitled]: commit 576f1c4
[^commit-coexist]: commit ae3793c
[^commit-steal]: commit ebf8663
[^commit-race]: commit bf66e00
[^commit-guards]: commit 3431468
[^changelog]: CHANGELOG.md
