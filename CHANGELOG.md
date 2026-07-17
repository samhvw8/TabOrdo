# Changelog

## 0.4.1 — 2026-07-17

### Bug Fixes

- **Fix sidebar clicks for More and Archive tabs** — clicking sidebar buttons while search input was focused caused a layout shift (search mode pills row removed from DOM on blur), making clicks miss their target; pills row now uses CSS `invisible` instead of conditional rendering to prevent layout shift
- **Fix archive sidebar action** — replaced fragile `$effect` (read+write same `$state`) with direct `onarchive` callback to avoid Svelte 5 reactivity issues
- **Sidebar `onmousedown` preventDefault** — prevents search input blur when clicking sidebar buttons, providing secondary defense against layout shift
- **Resilient Chrome API calls** — wrapped `chrome.storage.session` calls in `try/catch` (`.catch()` only handles Promise rejections, not synchronous property access errors)

## 0.3.1 — 2026-07-05

### New Features

- **Customizable dashboard actions** — choose which action buttons appear on the main dashboard grid via the More Actions panel (★ toggle)
- **All actions in More panel** — primary actions (Sort, Group+, Dedup, Merge, Pin) now listed alongside overflow actions for unified discovery and customization
- **Empty dashboard state** — helpful prompt when all actions are removed, linking to the More panel

### Improvements

- **Simplified icon rendering** — replaced 35-line icon if/else chain in More panel with shared icon pool
- **Data-driven action grid** — dashboard buttons now render from a stored action list instead of hardcoded markup

## 0.2.1 — 2026-05-30

### New Features

- **Group-name search matching** — search and commands now match tab group titles (e.g. `/archive Work` archives all tabs in the "Work" group)
- **Archive button in dashboard** — quick access to the archive page from the action grid
- **Redesigned archive page** — polished full-page layout with sticky header, collapsible date groups, search with group name support, stats bar, and improved empty state

## 0.2.0 — 2026-05-26

### New Features

- **Collapse, move, and movegroup commands** — bulk tab organization via command palette
- **/ungroup command** — remove tabs from groups
- **@u triage view** — quick-access triage from command palette
- **Tab mute and volume control** — mute/unmute and adjust per-tab volume
- **Tab triage commands** — categorize and sort tabs by urgency
- **Auto-group by domain** — automatically group tabs sharing a domain
- **Extract single tab from group** — pull one tab out without ungrouping the rest
- **Archive system** — close and archive tabs for later retrieval
- **Unified search** — search across tabs, bookmarks, and history in one place
- **Undo system** — undo bulk operations with snapshot restore
- **Multi-window dashboard** — manage tabs across all browser windows
- **URL pattern rules** — define rules for automatic tab grouping
- **+Tab button** — quick new tab creation from the popup

### Bug Fixes

- Fix auto-group race condition with extension-created tabs
- Fix auto-group stealing tabs from existing groups
- Fix race conditions and missing undo snapshots across bulk operations
- Clear stuck bulkOpInProgress flag on popup mount
- Preserve triage category labels when searching with `@ <query>`
- Fix volume parsing for correct base conversion
- Fix rules persistence
- Fix command palette scroll behavior

### Improvements

- New extension icon and production build config
- Privacy policy for Chrome Web Store
- Removed `host_permissions` to avoid delayed CWS review
- Improved search performance and code quality
- Better responsiveness across the UI

## 0.1.0 — 2025-05-20

- Initial release on Chrome Web Store
- Command palette with keyboard-first tab management
- Tab grouping, sorting, deduplication
- Bookmark and history search
