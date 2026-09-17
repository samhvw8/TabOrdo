# Architecture

* [Architecture overview](overview.md) - How TabOrdo's MV3 entrypoints, lib modules, command dispatch and storage areas fit together, and which realm owns what.
* [Single tab-close path](tab-closing.md) - closeTabs in lib/tabs/close.ts is the only caller of chrome.tabs.remove; it snapshots for undo, removes per id, and separates already-gone tabs from refused ones.
* [Undo stack](undo-stack.md) - lib/undo.ts keeps a 20-entry close/group undo stack in chrome.storage.session, one key per entry plus a metadata key, with durable pushes shared across the popup, side panel and background realms.
* [Bulk lock](bulk-lock.md) - lib/bulklock.ts suppresses the background auto-group, auto-sort, auto-ungroup and switch-to-existing listeners while a bulk operation runs, using one expiring lease per owner in chrome.storage.session.
