---
type: Product
title: TabOrdo
description: TabOrdo is a keyboard-first Chrome MV3 tab manager (command palette, dashboard, side panel, archive and background automations); this page covers its audience, surfaces, permissions, privacy stance and store listing, and links every other concept in the bundle.
tags: [product, overview, chrome-extension, permissions, privacy]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T23:00:00Z }
sources:
  - id: readme
    resource: https://github.com/samhvw8/TabOrdo/blob/main/README.md
    title: README.md
    last_modified: 2026-08-21
  - id: product
    resource: https://github.com/samhvw8/TabOrdo/blob/main/PRODUCT.md
    title: PRODUCT.md
    last_modified: 2026-07-17
  - id: design
    resource: https://github.com/samhvw8/TabOrdo/blob/main/DESIGN.md
    title: DESIGN.md
    last_modified: 2026-07-17
  - id: privacy
    resource: https://github.com/samhvw8/TabOrdo/blob/main/PRIVACY.md
    title: PRIVACY.md
    last_modified: 2026-07-27
  - id: wxt-config
    resource: https://github.com/samhvw8/TabOrdo/blob/main/wxt.config.ts
    title: wxt.config.ts (manifest)
    last_modified: 2026-07-27
  - id: built-manifest
    resource: "local build output .output/chrome-mv3/manifest.json from npm run build (gitignored, not in the repository)"
    title: Built manifest for 0.7.2
    last_modified: 2026-09-09
  - id: claude-md
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CLAUDE.md
    title: CLAUDE.md
    last_modified: 2026-07-18
  - id: package-json
    resource: https://github.com/samhvw8/TabOrdo/blob/main/package.json
    title: package.json
    last_modified: 2026-08-23
  - id: sidebar
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/Sidebar.svelte
    title: components/Sidebar.svelte
    last_modified: 2026-07-27
  - id: sidepanel-main
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/sidepanel/main.ts
    title: entrypoints/sidepanel/main.ts
    last_modified: 2026-07-27
  - id: bg-index
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: entrypoints/background/index.ts
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: entrypoints/popup/App.svelte (requestFilePicker)
    last_modified: 2026-09-17
  - id: ai
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/ai.ts
    title: lib/ai.ts
    last_modified: 2026-08-02
  - id: bulklock
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bulklock.ts
    title: lib/bulklock.ts (session storage contents)
    last_modified: 2026-08-15
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md
    last_modified: 2026-09-17
  - id: commit-name
    resource: https://github.com/samhvw8/TabOrdo/commit/83323042c80389b783debc996d7a6485d68797e5
    title: "Update extension name for SEO: TabOrdo - Tab Manager & Organizer"
    last_modified: 2026-07-17
  - id: cws-listing
    resource: https://chromewebstore.google.com/detail/tabOrdo/kkobnbbfolmicnhnnbmcmdbgilocpnbi
    title: Chrome Web Store listing (fetched unauthenticated 2026-09-17)
  - id: publish-run-072
    resource: https://github.com/samhvw8/TabOrdo/actions/runs/32646251724
    title: Publish to Chrome Web Store run for v0.7.2
    last_modified: 2026-08-23
  - id: publish-run-073
    resource: https://github.com/samhvw8/TabOrdo/actions/runs/35174579836
    title: Publish to Chrome Web Store run for v0.7.3 (failed, 400 on the submit call)
    last_modified: 2026-09-17
  - id: publish-run-080
    resource: https://github.com/samhvw8/TabOrdo/actions/runs/35740300825
    title: Publish to Chrome Web Store run for v0.8.0 (uploaded and submitted for review)
    last_modified: 2026-09-22
---

# Overview

TabOrdo ("TabOrdo - Tab Manager & Organizer") is a keyboard-first tab manager for Chrome. You press `Cmd+E` and use a command palette to search, sort, group, deduplicate, archive and triage tabs.[^readme] It is a Manifest V3 extension built with WXT, Svelte 5, TypeScript and Tailwind 4, tested with vitest, and currently at version `0.7.2`.[^claude-md][^package-json] The product name was chosen for store search (SEO).[^commit-name]

It needs Chrome 138 or later ([minimum Chrome 138](/decisions/minimum-chrome-138.md)).[^wxt-config]

# Audience and principles

- **Who it is for:** productivity enthusiasts with 30–150+ tabs across several windows, usually mid-task, reaching for TabOrdo with `Cmd+E`. Speed and clarity win.[^product]
- **Success:** less time managing tabs, more time using them. It should "feel like it was always part of Chrome".[^product]
- **Principles:** disappear into the workflow; density without clutter; predictable over clever; keyboard-native; quiet confidence.[^product]
- **Anti-references:** corporate SaaS (Salesforce, Jira), dated extensions (OneTab, Tab Wrangler), flashy UI.[^product]
- **Design highlights:** a fixed 450×600 px popup, a dark-only indigo-tinted theme, no text above 14 px, flat surfaces (shadows only on tooltips), and only Chrome's native tab-group colours.[^design] Target WCAG AA with full keyboard navigation and reduced-motion support.[^product]

# Surfaces

| Surface | How you reach it | Notes |
|---------|------------------|-------|
| Popup (palette + dashboard) | `_execute_action`: `Command+E` on mac, `Ctrl+Shift+E` elsewhere | See [command palette](/features/command-palette.md) and [search](/features/search.md)[^wxt-config] |
| Dashboard without search focus | `open-dashboard`: `Command+Shift+E` on mac, `Ctrl+Shift+D` elsewhere | The background opens the popup with `openMode: "dashboard"`[^wxt-config][^bg-index] |
| Side panel | `/sidepanel`, the More panel, the context menu | Same `App.svelte` mounted with `fluid: true`[^sidepanel-main]; it stays open, so Load-from-file works there and not in the popup[^popup-app] |
| Archive page | Sidebar "Archive" (opens a tab) | Search, date grouping, bulk restore/delete, group-name filter; see [archive](/features/archive.md)[^readme] |
| Action-icon context menu | Right-click the toolbar icon | Group by domain, dedup, sort, Reading List, discard, side panel[^bg-index] |
| Background automations | Toggles under the dashboard | See [background automation](/features/background-automation.md) |

Sidebar sections are Home, Locks, Rules, AI, More and Settings, plus Help (an overlay) and Archive (a new tab).[^sidebar] `@` triage views (`@a` audio, `@d` duplicates, `@b` branch and more) and slash commands are listed in the README.[^readme]

# Permissions

| Permission | Used for |
|------------|----------|
| `tabs`, `tabGroups` | Everything that reads or moves tabs and groups |
| `bookmarks`, `history` | `/b`, `/h` search[^privacy] |
| `storage` | Local: preferences, rules, archive, activity log.[^privacy] Session: undo stack, bulk-lock leases, tab lineage[^bulklock], AI progress[^ai] |
| `alarms` | The auto-discard alarm[^bg-index] |
| `scripting`, `activeTab` | `/vol` and the lock 📌 title badge, on the tab you acted on only |
| `readingList`, `sessions` | `/readlater`, `/rl`; `/rc`, `/recent`, `/restore`[^privacy] |
| `contextMenus` | Action-icon menu |
| `favicon` | Chrome's local favicon cache for the archive and Locks panel[^privacy] |
| `sidePanel` | Not in `wxt.config.ts`; present in the built manifest (WXT adds it for the side panel entry)[^built-manifest] |

There are **no `host_permissions`**. See [no host permissions](/decisions/no-host-permissions.md).[^wxt-config][^built-manifest]

# Privacy stance

- TabOrdo collects nothing and transmits nothing. Tab titles and URLs are used in memory only, and there are no analytics, tracking, remote code or third-party services.[^privacy]
- Favicons come from Chrome's local cache. The archive page used to request each archived site's own icon (and fell back to `google.com/s2/favicons`), which leaked archived URLs.[^privacy][^changelog]
- `/aigroup` runs Gemini Nano in the browser, only when invoked, and never falls back to a remote model. See [AI grouping](/features/ai-grouping.md).[^privacy]

# Chrome Web Store

- The listing is `chromewebstore.google.com/detail/tabOrdo/kkobnbbfolmicnhnnbmcmdbgilocpnbi`.[^readme] The manifest name is "TabOrdo - Tab Manager & Organizer" and its description is "Sort, group, deduplicate and manage your tabs with a command palette".[^wxt-config]
- A published GitHub Release triggers `wxt submit`; see [release](/processes/release.md).
- **Attention:** the publish runs for v0.7.0–v0.7.3 all failed at the store's submit call: v0.7.0–v0.7.2 with "Publish condition not met … mandatory privacy information in the new Developer Dashboard",[^publish-run-072] and v0.7.3 with another 400.[^publish-run-073] v0.8.0 (2026-09-22) was the first since then to be uploaded and submitted for review, so it carries every 0.7.x change to users at once.[^publish-run-080] An unauthenticated fetch of the listing on 2026-09-17 returned "Item not available". Whether that means the item is unpublished or only hidden from signed-out visitors is unconfirmed.[^cws-listing]

# Where to go next

- [Architecture overview](/architecture/overview.md): entrypoints, lib layout, storage
- [Command palette](/features/command-palette.md) and [Search](/features/search.md): the main surface
- [Background automation](/features/background-automation.md): what moves tabs while the popup is closed
- [Grouping rules](/features/grouping-rules.md), [Sort priority](/features/sort-priority.md), [Position locks](/features/position-locks.md): ordering and grouping
- [Dedup](/features/dedup.md), [Branch lineage](/features/branch-lineage.md), [Focus workspaces](/features/focus-workspaces.md), [Archive](/features/archive.md), [AI grouping](/features/ai-grouping.md)
- [Tab closing](/architecture/tab-closing.md), [Undo stack](/architecture/undo-stack.md), [Bulk lock](/architecture/bulk-lock.md): cross-cutting invariants
- [Chrome stub](/testing/chrome-stub.md): how tests fake Chrome
- [Release](/processes/release.md), [Chrome Web Store listing](/processes/chrome-web-store-listing.md), [No host permissions](/decisions/no-host-permissions.md) and [Minimum Chrome 138](/decisions/minimum-chrome-138.md)

[^readme]: README.md
[^product]: PRODUCT.md
[^design]: DESIGN.md
[^privacy]: PRIVACY.md
[^wxt-config]: wxt.config.ts
[^built-manifest]: .output/chrome-mv3/manifest.json (local build)
[^claude-md]: CLAUDE.md
[^package-json]: package.json
[^sidebar]: components/Sidebar.svelte
[^sidepanel-main]: entrypoints/sidepanel/main.ts
[^bg-index]: entrypoints/background/index.ts
[^popup-app]: entrypoints/popup/App.svelte
[^ai]: lib/ai.ts
[^bulklock]: lib/bulklock.ts
[^changelog]: CHANGELOG.md
[^commit-name]: commit 8332304
[^cws-listing]: Chrome Web Store listing
[^publish-run-072]: GitHub Actions run 32646251724
[^publish-run-073]: GitHub Actions run 35174579836
[^publish-run-080]: GitHub Actions run 35740300825
