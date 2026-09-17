---
type: Feature
title: Tab archive
description: Archiving records tabs in a capped list in chrome.storage.local and closes them, and a full-page archive view searches, restores and deletes those entries.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/archive.ts
tags: [archive, storage, tabs]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T00:16:05Z }
sources:
  - id: archive-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/archive.ts
    title: Archive storage
    last_modified: 2026-08-02
  - id: archive-page
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/archive/App.svelte
    title: Archive page
    last_modified: 2026-08-21
  - id: actions-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: /archive handler
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Dashboard archive buttons
    last_modified: 2026-09-17
  - id: close-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/close.ts
    title: closeTabs
    last_modified: 2026-09-17
  - id: undo-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.ts
    title: executeUndo
    last_modified: 2026-09-17
  - id: archive-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/archive.test.ts
    title: Archive tests
    last_modified: 2026-08-02
  - id: actions-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.test.ts
    title: /archive handler tests
    last_modified: 2026-08-21
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG
    last_modified: 2026-09-17
  - id: readme
    resource: https://github.com/samhvw8/TabOrdo/blob/main/README.md
    title: README
    last_modified: 2026-08-21
  - id: commit-b405298
    resource: https://github.com/samhvw8/TabOrdo/commit/b405298
    title: Fix restoreFromArchive dropping entries when tab creation fails
    last_modified: 2026-07-17
  - id: commit-1e5a1df
    resource: https://github.com/samhvw8/TabOrdo/commit/1e5a1df
    title: "fix: dedup identity, undo close fidelity, ignore-list reach in lib"
    last_modified: 2026-08-02
  - id: commit-6ee12ce
    resource: https://github.com/samhvw8/TabOrdo/commit/6ee12ce
    title: "perf: group archive entries without per-item Intl formatting"
    last_modified: 2026-08-21
  - id: commit-54b3787
    resource: https://github.com/samhvw8/TabOrdo/commit/54b3787
    title: "fix: route every tab close through one path"
    last_modified: 2026-09-17
---

# Overview

The archive is a place to put tabs you want gone but not lost. `lib/archive.ts` owns the stored list; `/archive` and the dashboard selection bar write to it and close the tabs; `archive.html` (`entrypoints/archive/`) opens in a tab to browse, restore and delete.[^archive-ts][^actions-ts][^archive-page] It differs from [focus mode](/features/focus-workspaces.md), which parks a whole window as one unit.

# Storage

| `chrome.storage.local` key | Value[^archive-ts] |
|----------------------------|-----------|
| `tabOrdo_archive` | `ArchivedTab[]`, appended at the end, oldest first |
| `tabOrdo_archiveCount` | The same list's length, written in the same `set` |

- `ArchivedTab` = `id` (`crypto.randomUUID()`), `url`, `title`, `archivedAt`, `groupName?`. Older entries may carry `favIconUrl`, which is no longer read or written.[^archive-ts]
- Capped at 5,000 entries; archiving past the cap silently drops the oldest.[^archive-ts][^archive-test]
- **Archivable** (`isArchivable`) means a non-empty URL other than exactly `chrome://newtab/`.[^archive-ts]
- `getArchiveCount` asks for the count key alone, because `chrome.storage` deserialises every key named. The popup reads it on every open. An archive written before the count existed is measured once and backfilled.[^archive-ts]

# Archiving paths

| Trigger | Path |
|---------|------|
| `/archive <query>` | Ranked matches, group names included (`/archive Work`) → the `/archive` handler[^actions-ts][^changelog] |
| Dashboard selection bar → Archive | `dashCommand("archive", "", selectedTabs)` → the same handler, no confirmation[^popup-app] |
| Dashboard Archive tile, More panel "Open Archive", sidebar Archive | Open `archive.html` only; nothing is archived[^popup-app][^readme] |

The `/archive` handler:[^actions-ts]

1. No matches (including a bare `/archive`): do nothing.
2. Keep matches that have a tab id and are archivable; none left: "Nothing to archive".
3. `archiveTabs` writes the entries, with the group title as `groupName`.
4. `closeTabs` closes exactly those tabs and takes the undo snapshot ([tab closing](/architecture/tab-closing.md)).

# Restore semantics

- `restoreFromArchive(ids)` opens every selected entry at once (`Promise.allSettled`), inactive, in the current window.[^archive-ts]
- Only entries whose tab actually opened are removed; a failed open leaves the entry in the archive.[^archive-ts][^commit-b405298]
- The group is not rebuilt; `groupName` is only shown as a badge.[^archive-ts][^archive-page]
- Restore, delete and Clear All have no undo. Clear All asks `confirm()` first ("This cannot be undone").[^archive-page]

# Archive page

- Header stats: tab count, distinct sites, distinct groups; Restore N, Delete N and Clear All buttons.[^archive-page]
- Plain substring search over title, URL and group name, with a result count.[^archive-page]
- Entries grouped by day (Today, Yesterday, then a localised weekday date), newest first; each day collapses and has its own select toggle.[^archive-page]
- Clicking a row toggles selection; each row also has Restore and Delete buttons.[^archive-page]
- Favicons come only from Chrome's local favicon cache, never from the site.[^archive-page][^changelog]
- `archive` is `$state.raw`, and grouping computes one date key per entry and one label per day.[^archive-page][^commit-6ee12ce]

# Past bugs

| Version | Bug |
|---------|-----|
| 0.5.0 | A restore whose tab failed to open still deleted the entry (`b405298`).[^commit-b405298][^changelog] |
| 0.6.0 | `/archive` closed every match while `archiveTabs` skipped URL-less and new-tab entries ("Archived 8" could close 10), and took no undo snapshot (`1e5a1df`).[^commit-1e5a1df][^actions-ts] |
| 0.6.0 | Opening the page requested each archived site's stored favicon URL, leaking archived URLs; the URL is no longer stored.[^changelog] |
| 0.6.0 | The sidebar badge read zero for archives older than the count key, and the popup parsed the whole archive just to read the count.[^changelog] |
| 0.7.0 | Search re-formatted a localised date for every entry on each keystroke: 62.7 ms to 7.1 ms at 2,000 entries (`6ee12ce`).[^commit-6ee12ce] |
| Unreleased | The selection bar's Archive button closed tabs with no undo snapshot, so Ctrl+Z restored an unrelated entry. It now runs the `/archive` handler (`54b3787`).[^commit-54b3787][^changelog] |

# Gotchas

- Ctrl+Z after archiving reopens the tabs but leaves their entries in the archive, so a page can be both open and archived.[^undo-ts][^actions-ts]
- Entries are written before the close. If the undo snapshot cannot be saved (`closeTabs` then closes nothing) or Chrome refuses a tab, the entries stay while those tabs remain open.[^actions-ts][^close-ts]
- Day buckets use UTC dates (`toISOString().slice(0, 10)`), so "Today" rolls over at UTC midnight, not local midnight.[^archive-page]
- Page search is not the palette's [ranked search](/features/search.md): no fuzzy matching, pinyin or diacritic folding.[^archive-page]
- The page reads storage on mount and after its own actions only; tabs archived while it is open appear after a reload.[^archive-page]
- Other `chrome://` pages are archivable; only the new-tab page is excluded.[^archive-ts]

# Tests that guard it

| File | Guards |
|------|--------|
| `lib/archive.test.ts` | Skipping new-tab and empty URLs, the 5,000 cap, restore removing only opened entries, delete and clear, count read alone and backfilled[^archive-test] |
| `lib/actions.test.ts` | Archive written before closing, only archived tabs close, undo snapshot, nothing archivable[^actions-test] |

# Related

- [Command palette](/features/command-palette.md), [tab closing](/architecture/tab-closing.md), [undo stack](/architecture/undo-stack.md)
- [Product overview](/tabordo.md)

[^archive-ts]: lib/archive.ts
[^archive-page]: entrypoints/archive/App.svelte
[^actions-ts]: lib/actions.ts
[^popup-app]: entrypoints/popup/App.svelte
[^close-ts]: lib/tabs/close.ts
[^undo-ts]: lib/undo.ts
[^archive-test]: lib/archive.test.ts
[^actions-test]: lib/actions.test.ts
[^changelog]: CHANGELOG.md
[^readme]: README.md
[^commit-b405298]: commit b405298
[^commit-1e5a1df]: commit 1e5a1df
[^commit-6ee12ce]: commit 6ee12ce
[^commit-54b3787]: commit 54b3787
