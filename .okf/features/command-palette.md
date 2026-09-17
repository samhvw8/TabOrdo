---
type: Feature
title: Command palette and dashboard actions
description: How slash commands, @ triage views and dashboard tiles are registered, dispatched to one handler per command, confirmed, and extended.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
tags: [command-palette, dashboard, actions, triage]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T00:16:05Z }
sources:
  - id: commands-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/commands.ts
    title: Command registry
    last_modified: 2026-08-21
  - id: actions-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: Action handlers
    last_modified: 2026-09-17
  - id: dashboard-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/dashboard.ts
    title: Dashboard tile catalogue
    last_modified: 2026-08-15
  - id: search-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/search.ts
    title: parseCommand
    last_modified: 2026-08-21
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Popup and side panel component
    last_modified: 2026-09-17
  - id: actions-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.test.ts
    title: Action handler tests
    last_modified: 2026-08-21
  - id: dashboard-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/dashboard.test.ts
    title: Dashboard consistency tests
    last_modified: 2026-07-29
  - id: commands-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/commands.test.ts
    title: Command matching tests
    last_modified: 2026-07-27
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG
    last_modified: 2026-09-17
  - id: readme
    resource: https://github.com/samhvw8/TabOrdo/blob/main/README.md
    title: README
    last_modified: 2026-08-21
  - id: commit-7e3e91a
    resource: https://github.com/samhvw8/TabOrdo/commit/7e3e91a
    title: "refactor: split lib/tabs, extract action and dashboard registries"
    last_modified: 2026-07-29
  - id: commit-54b3787
    resource: https://github.com/samhvw8/TabOrdo/commit/54b3787
    title: "fix: route every tab close through one path"
    last_modified: 2026-09-17
---

# Overview

The palette (the `Cmd+E` popup, and the same component mounted in the side panel) takes plain text for [ranked search](/features/search.md), `/command [text]` for actions and searches, and `@view [text]` for triage. The dashboard beneath it exposes a subset of the same actions as tiles. Three registries drive it:

| Registry | File | Holds |
|----------|------|-------|
| `SEARCH_COMMANDS`, `ACTION_COMMANDS`, `VIEW_COMMANDS`, `TRIAGE_COMMANDS`, `ACTION_GROUPS` | `lib/commands.ts` | Prefix, label, description, category, colour, `hidden` flag, browse clusters[^commands-ts] |
| `ACTION_HANDLERS`, `runAction` | `lib/actions.ts` | One async handler per action prefix[^actions-ts] |
| `DASHBOARD_ACTION_POOL`, `MORE_SECTIONS`, `ALT_MODE`, `DEFAULT_DASHBOARD_IDS`, `DASHBOARD_ONLY_ACTIONS` | `lib/dashboard.ts` | Tiles, the More panel list, alt-click modes[^dashboard-ts] |

The triage views and the tile click dispatcher (`handleOverflowAction`) still live in `App.svelte`.[^popup-app]

# Behaviour

## Parsing and hints

- `parseCommand` matches the longest known `@` prefix, so `@shared` is not swallowed by `@s` and `@afoo` still means `@a` + `foo`. Slash input is `/(\w+)\s*(.*)`.[^search-ts]
- `matchCommands`: bare `/` lists every non-hidden command; typed text matches a prefix start or label substring, then falls back to an in-order character match on prefix or description. Hidden aliases resolve once typed.[^commands-ts]
- Hints show only while the input has no space. `Tab` completes the highlighted hint; `Enter` on a parsed action prefix runs it.[^popup-app]

## Running an action (`handleActionCommand`)

1. Return if `busy`. `/aigroup` is handed off before the bulk lock (see [AI grouping](/features/ai-grouping.md), [bulk lock](/architecture/bulk-lock.md)).
2. Inside `withBulkLock`, `rankTabs(query)` builds `matchingTabs`: the top 50 ranked rows backed by a tab; an empty query matches nothing.
3. `runAction(prefix, ctx)` returns an `ActionResult`, or `null` when no handler exists.
4. `closePopup` closes the window; a defined `message` flashes; `results` replaces the list; `workspaceChanged` re-reads `hasSavedWorkspace()`; `acted` clears the query, refreshes undo state and reloads tabs. A throw shows `Error: …` for 5 s.[^popup-app]

| `ActionContext` | Meaning[^actions-ts] |
|-----------------|---------|
| `query` | Text after the prefix, `""` when bare |
| `matchingTabs` / `tabIds` | Tabs the query resolved to |
| `currentWindowId` | Window the popup belongs to |
| `rankTabs(q)` | Re-rank against a second query (`/vol 50 youtube`) |
| `requestFilePicker()` | Opens the component's hidden file input |

Handler conventions:

- Returning `{ acted: false }` with no message leaves the last status on screen.[^popup-app]
- `onMatchesOrActive`: act on matches; a bare command falls back to the active tab; a query that matched nothing does nothing, because hitting a different tab than the one aimed at is worse than a no-op.[^actions-ts]
- Closes take their undo snapshot inside `closeTabs` ([tab closing](/architecture/tab-closing.md)). Regroup and move handlers call `snapshotBeforeGroup()` themselves, and only once the action is known not to be a no-op: an entry for nothing makes Ctrl+Z pop something the user never did.[^actions-ts] See [undo stack](/architecture/undo-stack.md).
- Batches over ids the popup built use `Promise.allSettled`, so one stale id does not abort the rest.[^actions-ts]

## Triage views (`@`)

| View | Shows | In bare `@` overview |
|------|-------|----------------------|
| `@a` / `@m` | Audible / muted tabs | Yes |
| `@d` | Tabs sharing an exact URL | Yes |
| `@r` | Most recently active (20; 15 in the overview) | Yes |
| `@s` / `@f` | Discarded ("Unloaded") / frozen by Chrome ("Paused by Chrome") | Yes |
| `@u` | Ungrouped tabs | No |
| `@b` | Active tab's branch as an outline ([branch lineage](/features/branch-lineage.md)) | No |
| `@shared` | Tabs in shared groups | No |

All are rows in one `TRIAGE_CATEGORIES` table; text after a view re-ranks its tabs. The lookup is a `Map` because an object literal would resolve `/constructor` to `Object.prototype`.[^popup-app]

## Dashboard tiles, alt-click and confirmations

- The grid renders `dashboardActionIds` from `chrome.storage.local` (defaults `sort`, `group`, `dedup`, `merge`, `pin`); the ★ in the More panel toggles a tile.[^dashboard-ts][^popup-app]
- `dashButtonClick`: `pin` has its own lock/unlock toggle. With Alt or Ctrl held, `ALT_MODE[id]` applies: a mode with a `query` re-runs the handler with that argument, otherwise its `action` is dispatched instead.[^popup-app]
- Swap pairs are symmetric, so either tile reaches both modes: Close Left/Right, Split V/H, Save/Load, Unite/Isolate, Branch/Branch Up. Mute alt-clicks to Unmute, and Lock Group to a lock at the first position.[^dashboard-ts][^readme]
- `handleOverflowAction` either calls `dashCommand(prefix)`, which runs the same `ACTION_HANDLERS` entry as the typed command, or inlines lib calls with shorter status text.[^popup-app]
- `DASHBOARD_ONLY_ACTIONS` (`regroup`, `aigroup`, `archive`, `group`, `ungroup`, `sort`, `pin`) are tiles that deliberately differ from the same-named command: Group+ groups by domain while `/group` groups the matches, and the Archive tile opens the archive page.[^dashboard-ts]
- Selection bar: Close and Archive run the `/close` and `/archive` handlers on the ticked tabs; that is how the Archive button, which used to close with no undo snapshot, got one.[^popup-app][^commit-54b3787]
- `CONFIRM_ACTIONS` = `merge`, `dedup`, `closeleft`, `closeright`, `closeold`, `closesite`, and `focus` only while no workspace is saved. The first click arms (label "Confirm"), a second within 3 s runs. Selection Close confirms too; selection Archive does not.[^popup-app] Typed commands never confirm: typing is already deliberate.[^changelog]

# Invariants

- Every `ACTION_COMMANDS` prefix except `aigroup` has a handler, and every handler key is listed in `ACTION_COMMANDS`, hidden aliases included.[^actions-test]
- Pool and More panel agree both ways; defaults exist in the pool; alt targets exist and swap pairs are symmetric; each pool id has a handler unless dashboard-only; the dispatcher has a `case` for every pool id and alt target except `pin`.[^dashboard-test]
- The preview under a typed action command is ranked with the same arguments as `rankTabs`, so the list shown is the list acted on.[^popup-app]

# Why it is this way

- Handlers were a ~300-line switch in `App.svelte`, reachable only by mounting the component, so none were tested; `7e3e91a` moved them to `lib/actions.ts`.[^commit-7e3e91a]
- Tile data were four hand-maintained lists in `App.svelte`; `/collapse` shipped missing from three of them.[^changelog]
- Buttons route through `dashCommand` so a button and its command cannot drift into reporting different things.[^popup-app]

# Gotchas

- Targets are capped at 50 and include fuzzy and subsequence hits, so a short query can reach loosely matching tabs. Read the preview.[^popup-app]
- Handlers that ignore `ctx` (`/dedup`, `/closeold`, `/merge`, …) still show a filtered preview when text follows, then act globally.[^actions-ts][^popup-app]
- Alt-clicking a tile that confirms arms the *alt* action's id, so the clicked tile never relabels to "Confirm"; a second alt-click still runs it. Ctrl-click also triggers alt modes, but the relabel follows only the Alt key.[^popup-app]
- Load from File refuses in the popup (the picker steals focus and Chrome closes the popup); it works in the side panel.[^popup-app]
- The dispatcher test finds cases by splitting `App.svelte` on `async function handleOverflowAction`; renaming it fails "found the dispatcher".[^dashboard-test]

# Adding a command end to end

1. `lib/commands.ts`: add a `CommandDefinition` to `ACTION_COMMANDS` and its prefix to an `ACTION_GROUPS` cluster.
2. `lib/actions.ts`: add the handler to `ACTION_HANDLERS`; close only through `closeTabs`, call `snapshotBeforeGroup()` before regrouping or moving, and set `acted` when the popup should clear the query and reload.
3. `lib/actions.test.ts`: cover it against the [chrome stub](/testing/chrome-stub.md); the registry tests fail until steps 1 and 2 agree.
4. For a tile: a pool entry in `DASHBOARD_ACTION_POOL`, a `MORE_SECTIONS` row, a `case` in `handleOverflowAction` (usually `goBack(); dashCommand("id")`), optionally a symmetric `ALT_MODE` pair, and `CONFIRM_ACTIONS` if it closes tabs. `lib/dashboard.test.ts` checks all of these except the confirmation list.
5. Add a row to README's command table and a CHANGELOG entry ([release](/processes/release.md)).

# Tests that guard it

| File | Guards |
|------|--------|
| `lib/actions.test.ts` | Dispatch, aliases, registry agreement, per-handler behaviour[^actions-test] |
| `lib/dashboard.test.ts` | Catalogue, alt modes, registry mapping, dispatcher cases[^dashboard-test] |
| `lib/commands.test.ts` | `matchCommands` browse, aliases, fuzzy[^commands-test] |

# Related

- [Architecture overview](/architecture/overview.md), [tab closing](/architecture/tab-closing.md), [undo stack](/architecture/undo-stack.md)
- [Dedup](/features/dedup.md), [archive](/features/archive.md), [focus and workspaces](/features/focus-workspaces.md), [position locks](/features/position-locks.md)

[^commands-ts]: lib/commands.ts
[^actions-ts]: lib/actions.ts
[^dashboard-ts]: lib/dashboard.ts
[^search-ts]: lib/search.ts
[^popup-app]: entrypoints/popup/App.svelte
[^actions-test]: lib/actions.test.ts
[^dashboard-test]: lib/dashboard.test.ts
[^commands-test]: lib/commands.test.ts
[^changelog]: CHANGELOG.md
[^readme]: README.md
[^commit-7e3e91a]: commit 7e3e91a
[^commit-54b3787]: commit 54b3787
