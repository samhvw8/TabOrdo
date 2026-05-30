# Changelog

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
