---
type: Feature
title: Command palette and dashboard actions
description: How slash commands, @ triage views and dashboard tiles are registered, dispatched to one handler per command, confirmed, and extended.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
tags: [command-palette, dashboard, actions, triage]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T18:00:00Z }
sources:
  - id: commands-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/commands.ts
    title: The action table and the palette's command lists
    last_modified: 2026-09-22
  - id: actions-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: Action and tile handlers
    last_modified: 2026-09-22
  - id: dashboard-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/dashboard.ts
    title: Tiles derived from the action table
    last_modified: 2026-09-22
  - id: search-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/search.ts
    title: parseCommand
    last_modified: 2026-08-21
  - id: views-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/views.ts
    title: Prefix views
    last_modified: 2026-09-22
  - id: views-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/views.test.ts
    title: Prefix view tests
    last_modified: 2026-09-22
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Popup and side panel component
    last_modified: 2026-09-22
  - id: actions-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.test.ts
    title: Action handler tests
    last_modified: 2026-09-22
  - id: dashboard-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/dashboard.test.ts
    title: Dashboard derivation tests
    last_modified: 2026-09-22
  - id: commands-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/commands.test.ts
    title: Command matching tests
    last_modified: 2026-09-22
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

The palette (the `Cmd+E` popup, and the same component mounted in the side panel) takes plain text for [ranked search](/features/search.md), `/command [text]` for actions and searches, and `@view [text]` for triage. The dashboard beneath it exposes many of the same actions as tiles. One table drives both:

| What | File | Holds |
|------|------|-------|
| `ACTIONS`, the action table | `lib/commands.ts` | One row per slash command and per tile: `id`, `description`, browse cluster (`group`), colour, `hidden`, `aliasOf`, and optionally a `tile` (label, icon, tooltip, `confirm`, `own`) and an `alt` mode[^commands-ts] |
| `ACTION_COMMANDS`, `ALL_COMMANDS`, `groupCommands`, `matchCommands` | `lib/commands.ts` | The palette's list and browse clusters, derived from the table, beside the hand-written `SEARCH_COMMANDS`, `VIEW_COMMANDS` and `TRIAGE_COMMANDS`[^commands-ts] |
| `TILES`, `TILE_BY_ID`, `MORE_SECTIONS`, `UNLOCK_FACE`, `DEFAULT_DASHBOARD_IDS` | `lib/dashboard.ts` | Tiles, their alt faces and the More panel list, all derived from the table except the defaults[^dashboard-ts] |
| `ACTION_HANDLERS`, `TILE_HANDLERS`, `runAction`, `runTile` | `lib/actions.ts` | One async handler per command, and one per tile that does something of its own[^actions-ts] |

Every label is derived from what you type (`/close`, `@a`), and an alias's description, cluster and colour come from its target. A tile's label defaults to its id capitalised and its tooltip to the row's description.[^commands-ts][^dashboard-ts]

The handlers are not in the rows because `lib/commands.ts` must stay a leaf. `lib/search.ts` imports it for `parseCommand`, and the handlers import `lib/tabs`, the workspace and session stores and `lib/search.ts` itself (`/recent` ranks with `rankedSearch`). Rows holding handlers would make commands → actions → search → commands a cycle, and `search.ts` reads `TRIAGE_COMMANDS` while it loads. Instead the two handler records are typed `Record<HandledCommand, ActionHandler>` and `Record<OwnTile, ActionHandler>`, with both key types derived from the table, so a row without a handler, or a handler without a row, fails `npm run check`.[^commands-ts][^actions-ts]

The triage views live in `lib/views.ts` (see Triage views below).[^views-ts] The tile click dispatcher, `handleOverflowAction`, stays in `App.svelte` for the few tiles that need component state.[^popup-app]

# Behaviour

## Parsing and hints

- `parseCommand` matches the longest known `@` prefix, so `@shared` is not swallowed by `@s` and `@afoo` still means `@a` + `foo`. Slash input is `/(\w+)\s*(.*)`.[^search-ts]
- `matchCommands`: bare `/` lists every non-hidden command; typed text matches a prefix start or label substring, then falls back to an in-order character match on prefix or description. Hidden aliases resolve once typed.[^commands-ts]
- Hints show only while the input has no space. `Tab` completes the highlighted hint; `Enter` on a parsed action prefix runs it.[^popup-app]
- The Help panel lists every command through the same `CommandHints` component, with no row highlighted; picking one fills the palette as a hint does.[^popup-app]

## Running an action (`handleActionCommand`)

1. Return if `busy`. `/aigroup` is handed off before the bulk lock (see [AI grouping](/features/ai-grouping.md), [bulk lock](/architecture/bulk-lock.md)).
2. Inside `withBulkLock`, `rankTabs(query)` builds `matchingTabs`: the top 50 ranked rows backed by a tab; an empty query matches nothing.
3. `runAction(prefix, ctx)` returns an `ActionResult`, or `null` when no handler exists.
4. `closePopup` closes the window; a defined `message` flashes; `results` replaces the list; `workspaceChanged` re-reads `hasSavedWorkspace()`; `acted` clears the query, refreshes undo state and reloads tabs. A throw shows `Error: …` for 5 s.[^popup-app]

The query is cleared through `setQuery("")`, on the `/aigroup` path too, because it re-ranks: a bare `query = ""` left the palette in hint mode with the old hint selected, so a second Enter after `/aigroup` put "/aigroup " back in the box.[^popup-app]

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
| `@d` | Every copy of a page `/dedup` would close, by its URL rule ([dedup](/features/dedup.md)) | Yes |
| `@r` | Most recently active (20; 15 in the overview) | Yes |
| `@s` / `@f` | Discarded ("Unloaded") / frozen by Chrome ("Paused by Chrome") | Yes |
| `@u` | Ungrouped tabs | No |
| `@b` | Active tab's branch as an outline ([branch lineage](/features/branch-lineage.md)) | No |
| `@shared` | Tabs in groups Chrome marks shared | No |

The views are pure functions in `lib/views.ts`. `resolveView(prefix, q, ctx)` returns `{ rows, empty }` for every prefix the palette ranks locally: the triage views and the bare `@` overview, `/w`, `/p`, `/g`, `/re`, `/rl`, `/rc`, and the target preview under an action command.[^views-ts] `ctx` is what the popup already holds (its `TabSearch`, the current window, the active tab's group) plus the one Chrome read a view needs, which the popup makes for that view alone: the Reading List or recently closed list (once per visit, through `sourceOnce`), `@b`'s branch outline, or the tab groups for `@shared`.[^views-ts][^popup-app] `/b` and `/h` are not views; the popup looks them up in Chrome on a debounce ([search](/features/search.md)).

All triage views are rows in one `TRIAGE_CATEGORIES` table; text after a view re-ranks its tabs through `tabSearch.rankView`, which keeps the view's haystack until its rows change ([search](/features/search.md)). With no text a view lists every row, uncapped, as `/rl` and `/rc` do; only `/w`, `/p` and `/g` stop at 50. A dedicated view sets `empty` only when it has no rows at all, not when the text matched none of them; the bare `@` overview says "No triage matches" instead. The popup flashes `empty` as the status line. The lookup is a `Map` because an object literal would resolve `/constructor` to `Object.prototype`.[^views-ts]

`firstSelectable` and `nextSelectable` keep the highlight off the divider rows that the overview and the bookmark/history tail interleave.[^views-ts] `lib/views.test.ts` covers each view's rows and empty line, `@shared` and `@afoo` through `parseCommand`, the overview's order, labels and caps, prefixes named like `Object.prototype` members, and selection over dividers.[^views-test]

## Dashboard tiles, alt-click and confirmations

- The grid renders `dashboardActionIds` from `chrome.storage.local` (defaults `sort`, `group`, `dedup`, `merge`, `pin`); the ★ in the More panel toggles a tile. A tile's id is its row's id, and stored ids must keep resolving, which is why the two lock tiles still carry the old ids `pin` and `pingroup`, on the alias rows.[^dashboard-ts][^popup-app]
- `handleOverflowAction` is one switch with a `default: goBack(); dashTile(action)`. `dashTile` wraps `dashAction` around `runTile(id, ctx)`, which runs `TILE_HANDLERS[id]` when the row's tile is marked `own` and the bare command's handler otherwise. So a tile and its slash command share one handler and report the same status text.[^popup-app][^actions-ts]
- `TILE_HANDLERS` covers the tiles whose id names a command that does something else: Group+ (`group`) groups every loose tab by domain through `lib/arrange.ts` while `/group` groups the matches; Ungroup (`ungroup`) ungroups everything while bare `/ungroup` takes the active tab; Regroup (`regroup`) is a tile-only row with no slash command. Each takes the undo snapshot.[^actions-ts][^commands-ts]
- The Sort tile runs bare `/sort`, whose domain sort is `sortWindowByDomain` from `lib/arrange.ts`, the function the action-icon menu's Sort also calls.[^actions-ts]
- Only the tiles that need something the component owns keep a `case`: Focus runs `/unfocus` instead while a workspace is saved; Lock Tab toggles on the active tab's lock state (`handlePinCurrent`); AI Group hands off to the background before the lock; Recent fills the palette with `/recent`'s list; Archive opens the archive page.[^popup-app]
- `dashButtonClick`: `pin` has its own lock/unlock toggle. With Alt or Ctrl held, the tile's `alt` applies: a mode with a `query` runs `dashCommand(action, query)`, otherwise `action` goes through `handleOverflowAction`, confirmation included.[^popup-app]
- An `alt` names a target row (`to`) and optionally a `query`. Its face defaults to the target tile's label, icon and tooltip, so a swap pair states nothing twice. Swap pairs are symmetric: Close Left/Right, Split V/H, Save/Load, Unite/Isolate, Branch/Branch Up. Mute alt-clicks to Unmute, which has no tile and so supplies its own face; Lock Tab and Lock Group alt-click to a lock at `^`.[^commands-ts][^dashboard-ts][^readme]
- `tileFace` in the component gives the grid and the More panel the same face: the Lock Tab tile's state (`UNLOCK_FACE` while held), Focus's Unfocus face, and the alt face while Alt is held. The More panel adds the archive size as the Archive row's subtitle.[^popup-app]
- The More panel lists every tile under the palette's browse clusters, in `ACTION_GROUP_ORDER` and table order.[^dashboard-ts]
- Selection bar: Close, Archive and Discard run the `/close`, `/archive` and `/discard` handlers on the ticked tabs; that is how the Archive button, which used to close with no undo snapshot, got one.[^popup-app][^commit-54b3787]
- A group header's Sort and Extract run `sortGroup` and `extractGroup` from `lib/actions.ts`, which snapshot first like the handlers.[^actions-ts]
- Tiles with `confirm` in the table (`merge`, `dedup`, `closeleft`, `closeright`, `closeold`, `closesite`, and `focus` only while no workspace is saved) arm on the first click (label "Confirm") and run on a second within 3 s. Selection Close confirms too; selection Archive does not. Both go through one helper, `confirmed(id)`.[^commands-ts][^popup-app] Typed commands never confirm: typing is already deliberate.[^changelog]

# Invariants

- Every slash command except `/aigroup` and the aliases has an `ACTION_HANDLERS` entry, every `own` tile a `TILE_HANDLERS` entry, and neither record has a key the table lacks. The compiler enforces this, not a test.[^actions-ts][^commands-ts]
- Aliases run their target's handler; tile-only rows are not slash commands; an id resolves through a `Map`, never through `Object.prototype`.[^actions-test]
- Row ids are unique, every tile id a user may have stored still resolves, and swap pairs are symmetric.[^commands-test][^dashboard-test]
- An `alt` whose target is not in the table, or has no tile to borrow a face from and supplies none, throws when `lib/dashboard.ts` loads, so any test importing it fails.[^dashboard-ts]
- The preview under a typed action command is ranked with the same arguments as `rankTabs`, so the list shown is the list acted on.[^popup-app]

# Why it is this way

- Handlers were a ~300-line switch in `App.svelte`, reachable only by mounting the component, so none were tested; `7e3e91a` moved them to `lib/actions.ts`.[^commit-7e3e91a]
- Tile data were four hand-maintained lists in `App.svelte`; `/collapse` shipped missing from three of them.[^changelog]
- Buttons route through `dashCommand` so a button and its command cannot drift into reporting different things.[^popup-app]
- The tile data then still lived in six lists keyed by the same id (`ACTION_COMMANDS`, `ACTION_GROUPS`, `ACTION_HANDLERS`, the tile pool, `MORE_SECTIONS`, `ALT_MODE`), with about 16 tests there only to keep them agreeing, one of which string-split `App.svelte`. Drift shipped anyway: the More panel still said "Pin Tab" for the Lock Tab tile, and about 20 tiles re-implemented a handler with their own status text. They are one table now, and the tiles run the handlers.[^commands-ts][^popup-app]

# Gotchas

- Targets are capped at 50 and include fuzzy and subsequence hits, so a short query can reach loosely matching tabs. Read the preview.[^popup-app]
- Handlers that ignore `ctx` (`/dedup`, `/closeold`, `/merge`, …) still show a filtered preview when text follows, then act globally.[^actions-ts][^popup-app]
- Alt-clicking a tile that confirms arms the *alt* action's id, so the clicked tile never relabels to "Confirm"; a second alt-click still runs it. Ctrl-click also triggers alt modes, but the relabel follows only the Alt key.[^popup-app]
- Load from File refuses in the popup (the picker steals focus and Chrome closes the popup); it works in the side panel.[^popup-app]
- The Load and Side Panel tiles run inside the bulk lock, like their typed commands, so the file picker and `chrome.sidePanel.open` start a few storage round-trips after the click. Both need the click's user activation to still hold by then.[^popup-app][^actions-ts]

# Adding a command end to end

1. `lib/commands.ts`: add a row to `ACTIONS` with its `id`, `description`, `group` and `color`. Its position sets its place in the palette and the More panel.
2. `lib/actions.ts`: add the handler to `ACTION_HANDLERS`; `npm run check` fails until you do. Close only through `closeTabs`, call `snapshotBeforeGroup()` before regrouping or moving, and set `acted` when the popup should clear the query and reload.
3. `lib/actions.test.ts`: cover it against the [chrome stub](/testing/chrome-stub.md).
4. For a tile: give the row a `tile` (an icon at least; `confirm` if it closes tabs or scatters the window), and optionally an `alt`. It appears in the More panel and runs its handler with no change to `App.svelte`. If the tile should do something other than the bare command, mark it `own` and add a `TILE_HANDLERS` entry.
5. Add a row to README's command table and a CHANGELOG entry ([release](/processes/release.md)).

# Tests that guard it

| File | Guards |
|------|--------|
| `lib/actions.test.ts` | Dispatch, aliases, `runTile`, per-handler behaviour, the group-header snapshot[^actions-test] |
| `lib/dashboard.test.ts` | Stored tile ids still resolve, tile faces, alt symmetry[^dashboard-test] |
| `lib/commands.test.ts` | `matchCommands` browse, aliases, fuzzy; unique row ids[^commands-test] |

# Related

- [Architecture overview](/architecture/overview.md), [tab closing](/architecture/tab-closing.md), [undo stack](/architecture/undo-stack.md)
- [Dedup](/features/dedup.md), [archive](/features/archive.md), [focus and workspaces](/features/focus-workspaces.md), [position locks](/features/position-locks.md)

[^commands-ts]: lib/commands.ts
[^actions-ts]: lib/actions.ts
[^dashboard-ts]: lib/dashboard.ts
[^search-ts]: lib/search.ts
[^views-ts]: lib/views.ts
[^views-test]: lib/views.test.ts
[^popup-app]: entrypoints/popup/App.svelte
[^actions-test]: lib/actions.test.ts
[^dashboard-test]: lib/dashboard.test.ts
[^commands-test]: lib/commands.test.ts
[^changelog]: CHANGELOG.md
[^readme]: README.md
[^commit-7e3e91a]: commit 7e3e91a
[^commit-54b3787]: commit 54b3787
