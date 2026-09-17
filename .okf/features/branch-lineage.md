---
type: Feature
title: Branch lineage
description: TabOrdo's own record of which tab opened which, kept by the background worker in session storage, and the /branch, /branchup, /parent and @b features built on it.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/tree.ts
tags: [lineage, branch, grouping, background]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T10:02:23Z }
sources:
  - id: tree-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/tree.ts
    title: Tab lineage and branch gathering
    last_modified: 2026-09-17
  - id: tabs-index
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/index.ts
    title: lib/tabs barrel
    last_modified: 2026-08-15
  - id: background
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: Lineage listeners
    last_modified: 2026-09-17
  - id: group-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/group.ts
    title: untouchableGroupIds
    last_modified: 2026-08-15
  - id: actions-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: gatherBranch and /parent handlers
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: "@b view"
    last_modified: 2026-09-17
  - id: tree-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/tree.test.ts
    title: Lineage tests
    last_modified: 2026-09-17
  - id: actions-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.test.ts
    title: /branch and /parent handler tests
    last_modified: 2026-08-21
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG 0.7.0
    last_modified: 2026-09-17
  - id: commit-fb322d9
    resource: https://github.com/samhvw8/TabOrdo/commit/fb322d9
    title: "feat: gather a reading branch with /branch and /branchup"
    last_modified: 2026-08-15
  - id: commit-1849f5b
    resource: https://github.com/samhvw8/TabOrdo/commit/1849f5b
    title: "feat: /parent, @b branch outline, and Ctrl+T tabs as explicit roots"
    last_modified: 2026-08-21
---

# Overview

A reading session produces tabs whose only relationship is that one opened another. TabOrdo records that relationship itself and builds four features on it, all added in 0.7.0:[^changelog]

| Command | Does |
|---------|------|
| `/branch [name]` | Groups the active tab and everything opened from it, at any depth |
| `/branchup [name]` | Same gather rooted one level up; repeated runs climb |
| `/parent` | Switches to the tab that opened the active one, across windows, and closes the popup |
| `@b` | Shows the active tab's branch as an indented outline, without grouping |

Both gather commands are also dashboard tiles that alt-click to each other ([command palette](/features/command-palette.md)).

# The opener map

- Stored in `chrome.storage.session` under `tabParents` as `ParentMap`: child tab id → opener id, or `EXPLICIT_ROOT` (`-1`).[^tree-ts]
- **Writers, background only**: a `tabs.onCreated (lineage)` listener calls `lineageOpener` then `recordOpener`; a `tabs.onRemoved (lineage)` listener calls `forgetTab`. Both are registered apart from the other listeners on those events, so a failure costs only itself.[^background]
- **Readers, anywhere**: `resolveParents(liveTabs, stored)` merges the map with Chrome's live `openerTabId`. Chrome's value wins where both exist, since it covers tabs opened before install; the map covers openers that have closed; links to dead tabs are dropped; an `EXPLICIT_ROOT` overrules Chrome.[^tree-ts]

## Why Chrome's `openerTabId` is not enough

It vanishes when the opener closes, never survives a restart, and Chrome's tab strip forgets every opener as soon as any tab navigates other than by a link click. Recording at creation keeps the case that breaks a reading session: an intermediate tab closing.[^tree-ts][^commit-fb322d9] The listener records up front because the opener is only readable while it is still open, and gathering is most useful after the listing page has closed.[^background]

## Why session storage

Tab ids are issued per browser session and the next session reuses the same small range, so a map that outlived the session would point branches at unrelated tabs.[^tree-ts] Lineage therefore does not survive a browser restart.

## Ctrl+T tabs are explicit roots

Chrome names the previously active tab as a new-tab page's opener and keeps that link through the first typed navigation. `lineageOpener` records such a tab as `EXPLICIT_ROOT` when `pendingUrl` or `url` starts with `chrome://newtab`, `chrome://new-tab-page`, `edge://newtab` or `about:newtab`. It must run at `onCreated`: after navigation a Ctrl+T tab and a link-opened tab look identical.[^tree-ts] Before this, standing on a listing page, pressing Ctrl+T and typing an unrelated address made that tab part of the branch.[^changelog][^commit-1849f5b]

## Re-parenting on close

- `spliceParents` removes closed ids and re-parents each survivor to its nearest ancestor that is not closing, so closing an article leaves its sub-links under the listing page.[^tree-ts]
- Closing a **root** turns its children into roots that are no longer siblings. Deliberate: keeping them linked needs tombstones every reader must skip, which is "more machinery than the case earns".[^tree-ts]
- A child does not inherit `EXPLICIT_ROOT` from a closed Ctrl+T ancestor.[^tree-ts]
- `forgetTab` batches: a 50-tab window close fires 50 `onRemoved` events, and the first queued task splices the whole pending set in one read and one write. There is no debounce timer, because pending work could outlive the service worker. A failed write puts the batch back.[^tree-ts]
- `recordOpener` batches the same way. Ctrl-clicking 20 links fires 20 `onCreated` events, and each used to read and rewrite the whole map: 40 storage calls, with the whole map read and written 20 times. The first queued task now records every pending link in one read and one write, and a failed write puts the batch back. Records and closes drain in separate batches, so one can run ahead of an earlier call of the other kind. The only effect is that a tab closed while its creation was still queued can keep a map entry, and `resolveParents` ignores it.[^tree-ts][^tree-test]
- The `onRemoved` listener deliberately has no window-closing early-out; skipping teardown would drop the splice for every tab in the window.[^background]

## The background-only writer rule

`storage.session` has no compare-and-swap, so `mutate()` serialises every read-modify-write through a module-level promise chain. Serialising is only enough with a single writer: each realm importing the barrel gets its own queue, and the popup and side panel import it too. Keep `recordOpener` and `forgetTab` calls in the background.[^tree-ts][^tabs-index] There is no in-memory cache either, because the worker is torn down on idle.[^tree-ts]

# Gathering a branch

`gatherBranch` in `lib/actions.ts` → `collectBranch(rootId, activeTab.windowId)` → `groupBranch(branch, name)`.[^actions-ts]

- **Target window** is the active tab's, never the root's: a `/branchup` root can sit in another window, and grouping there would pull the active tab off-screen.[^tree-ts]
- **Excluded members**: pinned tabs (Chrome rejects the whole group call) and tabs in untouchable groups, meaning shared groups or names on `ignoreGroupNames`. They are dropped from the candidates, not the map, so a skipped tab mid-branch does not cut off what it opened. URL `ignorePatterns` do not apply: a branch is explicitly aimed.[^tree-ts][^group-ts]
- **Fewer than 2 tabs** does nothing, with a different message for a pinned root, a protected root, and a root that opened nothing.[^actions-ts]
- **Reuse versus rebuild**: when the root is grouped in the target window and that group holds no tab from outside the branch, the run folds into it. Strays are moved and added, the title changes only if a name is given, and the colour is kept. A group with a stranger in it (a domain auto-group, say) gets a new group instead.[^tree-ts]
- **Nothing to do**: a whole branch already in its group, with no name or the same name, returns without touching the strip or pushing an undo entry. Otherwise `snapshotBeforeGroup()` runs first.[^actions-ts] See [undo stack](/architecture/undo-stack.md).
- **New group order**: target-window members are grouped first, then strays are moved in and added, so a rejected call leaves a titled group plus a few loose tabs rather than every stray moved and nothing grouped.[^tree-ts]
- **Title**: the given name; else the root's title if 24 characters or fewer; else its hostname without `www.`; else the title's first 24 characters; else "Branch". Colour is a hash of the title, so the same name gets the same colour.[^tree-ts]
- **Status** lists what was declined: tabs pulled from other windows, root left out, pinned members, members left in protected groups.[^actions-ts]

## `/branchup` climbing

`branchUpRoot` walks up past every ancestor already in the active tab's group and roots at the next one. An ungrouped tab (`groupId` -1) does not walk. `climbed` separates "Nothing left above — this branch is already gathered" from "No parent tab — this one wasn't opened from another".[^tree-ts][^actions-ts]

## `@b`

`outlineBranch` lists the root, then each child followed by its own subtree, siblings in strip order (window id, then index). The view writes depth into the title with non-breaking spaces and `↳`. Fewer than 2 rows shows "No tabs were opened from this one". It is left out of the bare `@` overview.[^tree-ts][^popup-app]

# Gotchas

- A branch is a snapshot, not a container: with auto-sort on, tabs opened from a member later are grouped by domain as usual.[^changelog] See [grouping rules](/features/grouping-rules.md).
- Text after `@b` re-ranks the rows through search, losing tree order.[^popup-app]
- Cycle guards in `collectSubtree`, `branchOutline`, `branchUpRoot` and `spliceParents` are defensive: ids rise per session, but the map is persisted state and a bad map must still terminate.[^tree-ts]

# Tests that guard it

| File | Guards |
|------|--------|
| `lib/tabs/tree.test.ts` | `resolveParents`, `lineageOpener`, explicit roots, splicing, window-close storm and ctrl-click burst (one read, one write, retry after failure), `branchUpRoot`, `collectBranch`, `groupBranch` reuse[^tree-test] |
| `lib/actions.test.ts` | `/branch`, `/branchup` messages, undo, protected and shared groups, target window, `/parent`[^actions-test] |

# Related

- [Architecture overview](/architecture/overview.md), [background automation](/features/background-automation.md), [bulk lock](/architecture/bulk-lock.md)

[^tree-ts]: lib/tabs/tree.ts
[^tabs-index]: lib/tabs/index.ts
[^background]: entrypoints/background/index.ts
[^group-ts]: lib/tabs/group.ts
[^actions-ts]: lib/actions.ts
[^popup-app]: entrypoints/popup/App.svelte
[^tree-test]: lib/tabs/tree.test.ts
[^actions-test]: lib/actions.test.ts
[^changelog]: CHANGELOG.md
[^commit-fb322d9]: commit fb322d9
[^commit-1849f5b]: commit 1849f5b
