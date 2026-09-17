# Commands and views

* [Command palette and dashboard actions](command-palette.md) - How slash commands, @ triage views and dashboard tiles are registered, dispatched to one handler per command, confirmed, and extended.
* [Ranked search](search.md) - How lib/search.ts ranks tabs for the palette (literal tiers before approximate ones, title over URL, pinned and current-window then recency), plus regex, pinyin, Vietnamese, the non-tab sources, and the caching that keeps typing fast.
* [Duplicate tab removal](dedup.md) - How /dedup decides two tabs are the same page, which copy survives, where it is triggered from, and how those rules changed between 0.6.0 and the unreleased single close path.
* [Branch lineage](branch-lineage.md) - TabOrdo's own record of which tab opened which, kept by the background worker in session storage, and the /branch, /branchup, /parent and @b features built on it.
* [Focus mode and workspace files](focus-workspaces.md) - /focus and /unfocus park the current window's tabs on a LIFO stack in chrome.storage.local and bring them back, while /save and /load export and import tab lists as text files.
* [Tab archive](archive.md) - Archiving records tabs in a capped list in chrome.storage.local and closes them, and a full-page archive view searches, restores and deletes those entries.

# Automation and ordering

* [Background automation](background-automation.md) - The service worker's tab listeners (auto-group, auto-ungroup, auto-sort, pin follow, auto-discard, switch-to-existing, context menus) and the guards that keep them from fighting other extensions or each other.
* [Grouping rules and ignore lists](grouping-rules.md) - How the shared rulesConfig is stored, cached and written; how group rules and ignore patterns match hostnames and group names without backtracking; and the Rules editor that edits them.
* [Position locks](position-locks.md) - /lock, /unlock, /lockgroup and /unlockgroup hold a tab at a slot in its group or a group at a slot in its window; internally they are still "pins" (lib/pin.ts), re-applied after grouping and sorting and marked with a 📌 title badge.
* [Domain sort and sort priority](sort-priority.md) - How a domain sort lays out a window, and the per-domain sort priority rules (first domains, segment-aware anchored path patterns, cross-rule tiers) that change its order without ever overriding a position lock.
* [AI grouping (/aigroup)](ai-grouping.md) - On-device Gemini Nano topic grouping run by the background service worker; covers the availability check, the progress record that doubles as the run's mutex, the renewed bulk-lock lease, why the popup starts it outside its own lock, and the feature's removal and return.
