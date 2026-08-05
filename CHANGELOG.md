# Changelog

## 0.6.0 — 2026-08-04

### Renamed

- **Position pins are now "locks"** (`/lock`, `/unlock`, `/lockgroup`, `/unlockgroup`) — "pin" collided head-on with Chrome's own tab pinning, so `/pin` did something other than what people typing it expected. `/pin`, `/unpin`, `/pingroup` and `/unpingroup` keep working as unadvertised aliases; the Pins panel is now "Locks", and `/p` is described as "Chrome-pinned tabs only" to settle which pin it means
- **`@s` is "Unloaded", `@f` is "Paused by Chrome"** — the two views were labelled "Suspended" and "Frozen", which nothing distinguishes. `@s` lists tabs dropped from memory that reload when you return to them (what `/discard` produces); `@f` lists tabs Chrome's own memory saver paused, which TabOrdo never sets
- **`/freeze` is no longer listed as its own command** — it called the same code as `/discard` and reported "Froze", implying a capability that was never implemented. It still works, as a hidden alias

### New Features

- **Sort priority per domain** — the Locks panel can now customise what a domain sort produces, in two independent ways. A domain marked `first` leads the strip ahead of every unlisted domain, in the order you drag them; path patterns under a domain order that domain's own tabs, first matching pattern wins. Neither is a lock: nothing is held at a fixed slot, and a locked tab still takes precedence. Path patterns are segment-aware and anchored at both ends: `*` is one segment and never crosses a slash, `**` is any number of them, so `/truyen/*` is exactly one level down, `/truyen/**` is the whole subtree, and `/truyen/*/*/a/*` says precisely how deep `a` sits. The leading slash is optional, and everything other than a wildcard is literal — `?` included, so a query string pastes in as-is. A domain entry covers its subdomains, and rules higher in the list win. Each row reports how many open tabs it matches, so a pattern that matches nothing says so instead of silently never firing
- **Abbreviation search** — `yt` now finds YouTube and `gh` finds GitHub. Matching added an in-order character tier, ranked by the tightest window containing the query, so a real match still outranks a scattered coincidence
- **Rule tester** — the Rules editor can now test a URL against your rules and reports which one claims it and via which pattern. It also names rules that match but sit later in the list, which can never fire: rule order decides the winner, and nothing in the editor showed that before
- **Automation activity on the dashboard** — the most recent background group/ungroup now appears directly beneath the toggles that caused it, so "why did my tab move" has an answer next to the switch rather than only in Settings
- **Chrome API integrations** — Reading List (`/readlater`, `/rl`), Side Panel (`/sidepanel`), recently-closed sessions (`/rc`, `/recent`, `/restore`), on-device AI grouping via Gemini Nano (`/aigroup`), and action-menu context menu entries
- **Coexistence guards** — group-settle window, self-write tracking, and shared/saved-group detection so TabOrdo stops fighting other tab extensions
- **Automation activity log** — Settings now shows the last 20 automatic group/ungroup actions, for diagnosing conflicts with other extensions

### Bug Fixes

- **Fix a wildcard rule pattern being able to hang the extension** — glob patterns compiled to a regex whose repeated `.*` segments backtrack superlinearly on a near miss: a 21-character pattern took 8.3 seconds against a 40-character input, and the cap allowed patterns five times that long. Ignore rules and domain rules run on every tab event, and sort rules run on the auto-sort path, so one such pattern froze the service worker on every page load. Wildcards are now matched without compiling a regex at all, which cannot backtrack: the worst pattern the cap allows now returns instantly
- **Fix a rule pattern starting with `?` throwing** — `?` reached the regex unescaped, where it is a quantifier rather than a character, so a leading one raised an uncaught "Nothing to repeat" straight out of a tab-event listener and `a?` matched the empty string. `?` is now literal in every wildcard pattern, which is what someone pasting a query string means by it
- **Fix the palette firing actions mid-IME-composition** — Enter while picking a pinyin candidate ran the selected command instead of accepting the candidate
- **Fix the volume slider's state bleeding onto the wrong tab** — tab lists were unkeyed, so re-rendering reused a row's component for a different tab
- **Fix Load from File silently doing nothing in the popup** — the file picker steals focus, which Chrome treats as a reason to close the popup, taking the pending read with it. It now says to use the side panel instead
- **Fix arrow navigation stopping on divider rows**, and the selection index being left past the end after `Ctrl+Delete`
- **Fix `/aigroup` staying unavailable until a browser restart** — a service worker killed mid-model-call left an in-flight record nothing would ever clear. Runs now carry a start time and expire
- **Fix auto-ungroup and auto-sort being skipped for an ignored URL** — the ignore check wrapped all three automations rather than the grouping it was meant to guard
- **Fix a listener registration failure taking down the rest** — all 17 top-level registrations are now individually guarded
- **Fix deduplication treating distinct pages as duplicates** — it keyed on the path alone, so two URLs differing only by query string or fragment collapsed into one. It now uses the full URL, stripping only `utm_*`, `fbclid` and `gclid`, and never closes a Chrome-pinned tab
- **Fix undo after a close losing the tab's place** — restored tabs came back at the end, ungrouped. Undo now restores the strip index and rejoins a matching live group
- **Fix `/archive` closing more than it archived**, and not recording an undo snapshot at all
- **Fix manual grouping ignoring the ignore lists** — group, regroup and ungroup all bypassed both lists, including pulling tabs out of protected groups
- **Fix a failed undo snapshot letting the destructive action proceed anyway** — snapshots are now serialized, and a failure aborts the action rather than leaving it unundoable
- **Fix position locks losing their badge after a browser restart** — tab ids do not survive a restart, so a lock that found its tab again by URL never re-applied the 📌, and the badge could be stored into the lock's own saved title
- **Fix two AI runs starting at once and moving the same tabs** — the AI progress field doubles as the mutex deciding whether a run is already in flight, and the popup wrote to it: dismissing a finished run's panel, or a side panel that had been open since before the run started, blanked the mutex and let a second concurrent run begin. The popup no longer writes that key at all; the background owns it outright
- **Fix stale state in a side panel left open** — every cross-realm value was read once when the surface mounted and never again, so a side panel could sit there offering to start an AI run that was already running, showing settings toggled elsewhere, or an undo button that no longer matched the stack. All three now update live. This also retires the AI progress poller and its "has the background written yet?" timeout heuristic
- **Fix undo after removing duplicates never reopening the tabs** — deduplication closed tabs but recorded a *group* snapshot, which it never changes, so undo restored grouping and left every closed duplicate gone. The snapshot now lives inside the deduplication itself, which also covers the action-menu entry that recorded nothing at all
- **Fix the action-menu entries fighting the automations** — Group by domain, Remove duplicates and Sort ran without the suppression every other bulk path takes, so the auto-group/sort/ungroup listeners reacted to the very changes those entries were making
- **Fix bulk operations being left unsuppressed by a concurrent one** — the lock granted a single owner, so a second operation starting while one was in flight got no lease of its own, and the first to finish then released for both. It now grants concurrent leases and each holder releases only its own. Suppression also lingers a second past release, because Chrome delivers the tab events an operation causes *after* the call that caused them returns — a gap that previously left every popup-driven bulk action's aftermath unsuppressed
- **Fix `/aigroup` running with no lock at all** — the lease rewrite gave the background run its own owner, but typing the command still started it from inside the popup's bulk lock. The background's acquire lost to a lease that was still held, and the popup's release then cleared the lock outright, so the entire run went unprotected — the exact failure the owner token was added to prevent. The command now hands off before taking the lock, like the button paths already did
- **Fix AI grouping refusing to start, or resetting mid-run** — the popup's progress poller stamped "checking" into the shared state before the background read it. The background refuses to start when the status already looks like a run in flight, so a run could be rejected while the popup showed a spinner that never advanced; reopening the popup during a run reset a live "prompting" back to "checking", where it stuck for the whole model call. The poller is now read-only and the background's reply is surfaced instead of discarded
- **Fix a failed undo silently doing nothing** — an error thrown while restoring left no message and no recovery, with the entry already popped off the stack. Undo now reports what went wrong, and a single group Chrome refuses to rebuild no longer abandons the rest of the restore
- **Fix undo dissolving groups it never touched** — restoring a group snapshot ungrouped every grouped tab in every window, so tabs you had grouped yourself after the snapshot were silently flattened. Undo is now scoped to the tabs the snapshot covers
- **Fix undo failing outright on same-named groups in different windows** — snapshot groups were keyed by title and colour alone, so two windows with a "Work" group folded into one bucket and the resulting cross-window regroup was rejected by Chrome, taking the whole undo with it
- **Fix the popup and side panel overwriting each other's undo history** — each kept its own in-memory copy of the shared stack and wrote it back wholesale, so an action in one surface dropped whatever the other had recorded since it opened
- **Fix undo snapshots being lost on hand-off** — snapshots were persisted fire-and-forget. Chrome closes the popup on any focus loss, so a snapshot taken just before starting AI grouping could vanish before it was written
- **Fix the dashboard shortcut stealing search focus from the next open** — `Ctrl+Shift+D` set a one-shot flag before opening the popup, and the flag survived a failed open to be consumed by the following ordinary `Cmd+E`
- **Fix the archive badge reading zero for older archives** — the sidebar count came from a denormalized key that archives written before it existed simply don't have
- **Fix loading a tab list dropping an oversized first URL** — a single URL past the size cap produced an empty list, which opened a blank window and then reported that no URLs were found
- **Fix Unlock reporting "Tab was not pinned"** — the button decided what to show by tab id but removed the entry by URL, so a lock whose URL had since changed could not be released from the control offering to release it
- **Fix pin auto-follow re-running once per synced tab** — Chrome delivers the events our own updates generate after the guard has cleared, so each synced tab woke the service worker and re-queried every tab in the profile. They now carry a self-write marker, like the grouping automations
- **Fix triage views leaving a status message on screen** — "Reading List is empty" and friends had no clear timer and stayed pinned under the search bar until an unrelated action overwrote them
- **Fix held `Ctrl+Delete` interleaving closes** — the result-list close path checked the busy flag but never set it
- **Fix undo after AI grouping stranding tabs in the wrong window** — `/aigroup` consolidates tabs across windows before grouping them, but the undo snapshot recorded only group membership, so undoing restored the groups and left every moved tab wherever the AI had put it. Snapshots now record the window and position too, and undo moves tabs back before regrouping
- **Fix `Cmd+E` then `Enter` doing nothing** — the empty-query result list was never populated on open, so the intended "jump back to the previous tab" gesture silently did nothing at all. The dashboard now also shows which tab `Enter` will jump to
- **Fix fuzzy matches never appearing on common searches** — all five ranking tiers shared one result budget, so prefix and substring matches filled every slot and the fuzzy results were computed and then discarded. Approximate matches now have reserved space
- **Fix the Side Panel rendering at a fixed popup size** — the panel is resizable but mounted a hard-coded 450×600 layout, so it clipped when narrow and left dead space when wide. It now fills the panel, and no longer grabs keyboard focus from the page when opened
- **Fix the getting-started hint showing only to people who don't need it** — it appeared at five tabs or fewer, which is nobody who just installed a tab manager; it now appears once you have enough tabs for the advice to mean something
- **Fix AI grouping's Retry button skipping the undo snapshot** — retrying after a failure left the run unundoable, unlike every other way of starting it
- **Fix Merge dissolving groups from other windows** — Chrome ungroups a tab when it crosses windows, so merging flattened every group outside the current window into loose tabs; groups are now rebuilt after the move, folding into a same-titled group already present instead of creating a duplicate. Note that folding is one-way: two separate groups sharing a title and colour become one, and undo cannot split them again
- **Fix Unite, Isolate, Split V/H and Split by Domain dissolving groups** — the same cross-window defect as Merge; all four now preserve groups, including the first tab, which Chrome detaches when it opens the new window
- **Stop leaking archived URLs** — the archive page preferred each entry's stored favicon URL, so opening it fired a request to every archived site's own server for tabs closed weeks ago (and fell back to `google.com/s2/favicons`); icons now come from Chrome's local favicon cache only, and the URL is no longer stored (adds the `favicon` permission)
- **Fix a quick action cancelling AI grouping's safeguards** — the bulk-operation lock had no owner, so any popup action finishing, or merely reopening the popup, released the lock the background held for the whole AI run, letting auto-group and auto-sort fight it mid-run
- **Fix `@a`, `@d`, `@m` and `@r` with an attached query** — the `@shared` fix made prefix matching greedy, so `@afoo` became an unknown command and silently returned garbage instead of audible tabs matching "foo"
- **Fix long ignore rules never matching** — the 100-character pattern cap applied to plain text rules as well as regexes, so a long URL rule was accepted, listed, and silently never fired
- **Fix Merge reporting success when it failed** — a group that could not be rebuilt left its tabs loose while the status bar still said "Merged"; it now reports how many groups failed
- **Fix AI grouping on `{"groups": [...]}`** — a common Gemini Nano response shape was reported as "no groups found"
- **Fix settings toggles reverting each other** — with the popup and side panel both open, one could overwrite the other's toggle; the config write path no longer reads from cache
- **Fix a failed settings write being cached** — a rejected write left an unsaved config in memory that nothing would invalidate, and the next write persisted it
- **Fix "Pin" auto-follow never running** — the listener returned early on pin-only events, so the toggle had no effect at all
- **Fix `@shared`** — the command parser only captured one character after `@`, silently routing `@shared` to the suspended-tabs view
- **Fix AI grouping across windows** — suggestions spanning multiple windows were rejected by Chrome and failed the whole run; tabs are now consolidated into the window holding most of them first
- **Fix AI grouping on fenced JSON** — a ` ```json ` wrapper around the model's answer was reported as "no groups found"
- **Fix position pins landing wrong** — pin placement compared against tab indices captured before earlier moves shifted them
- **Fix `/vol` reporting false success** — volume changes on tabs other than the active one silently failed; the status bar now reports how many actually applied
- **Fix "Recently Closed" opening empty** from the More Actions menu
- **Fix `/movegroup 1`** placing the group after leading ungrouped tabs instead of matching `/movegroup ^`
- **Fix the feedback link** pointing at the wrong repository
- **Restore closed tabs to their original window** on undo, when that window still exists

### Improvements

- **Destructive buttons ask twice** — Merge, Dedup, Close Left/Right/Old/Same-Site and Focus now need a second click, since one stray click on a dashboard tile could close a lot of tabs. Typing the equivalent slash command still runs immediately: typing it is already deliberate
- **Window commands say what they actually do** — the nine of them read almost identically before. Descriptions now separate pulling tabs here (`/merge`, `/unite`) from sending them out (`/split`, `/extract`, `/isolate`, `/splitdomain`) from merely arranging windows on screen without moving any tabs (`/splitv`, `/splith`, `/stack`)
- **The command list is grouped** — forty-odd actions now cluster under Organize, Windows, Order, Close, Memory, Session and Audio headings in both the `/` list and the command guide, instead of one flat run
- **Navigation separates panels from everything else** — Help now lives in the sidebar rather than a lone button beside the search box, and Archive is marked as opening a new tab, so the rail no longer mixes in-place panels with things that navigate away
- **Config caching** — the service worker no longer makes several storage round-trips per tab event, and rapid settings toggles no longer race each other
- **CI runs the test suite** and the typecheck is green again; the publish workflow now runs both before submitting, instead of trusting a separate workflow it never waited for
- **The popup opens substantially faster** — three separate costs were being paid on every single open, and Chrome tears the popup down on every focus loss, so "every open" means every time:
  - The sidebar's archive badge read the archive **count** and the archive **array** in one `chrome.storage.get`. Storage deserializes every key you name, so reading a number cost parsing up to 5,000 archived tabs — and got slower the more you archived. It now reads the count alone.
  - `tldts`, the public-suffix list used to turn a URL into a registrable domain, is ~300 KB — **half the popup bundle** — and was parsed on open. Nothing on the first-paint path needs it: the tab list renders plain hostnames. It is now loaded on demand by the domain actions that actually need it, cutting the popup's critical bundle from 641 KB to 326 KB.
  - Startup made a dozen storage and tab round-trips one after another, each waiting on a result the next did not need. The reads the first frame depends on now run together, and the secondary ones (archive count, action log, AI progress, workspace) no longer hold up the tab list.
- **`lib/tabs.ts` split into `lib/tabs/`** — 971 lines and 41 exports covering nine unrelated concerns (querying, sorting, grouping, deduping, window moves, closing, audio, ordering, position locks) became one module each behind a barrel, so import sites are unchanged. It was the file every change touched and none could be held in your head
- **Dashboard tile catalogue moved to `lib/dashboard.ts`** — the pool, the More panel list, the alt-click table and the defaults were four hand-maintained lists inside App.svelte that nothing checked against each other, which is how `/collapse` shipped missing from three of them. They are now importable data with a test asserting they agree, and with the command registry
- **Test suite grown from 237 to 371** — new coverage for tab querying, sorting (including position locks resolved by tabId), grouping, `/move` and `/movegroup` placement, and the dashboard wiring. Every new suite was mutation-tested rather than trusted for being green
- **Fix `/split` doing nothing when typed bare** — it is described as "send the active tab to a new window", but it required a search query and silently did nothing without one, which is exactly what the description invites you to type. It now falls back to the active tab, like `/extract` already did
- **Six more actions can be put on the dashboard** — `/split`, `/extract`, `/mute`, `/freeze`, `/restore` and `/lockgroup` take no arguments (or have a sensible bare default), but none of them appeared in the More panel, so they could not be starred. All six are now there
- **Alt-click a dashboard tile for its opposite** — holding Alt relabels the tile and runs the paired mode: Mute↔Unmute, Close Left↔Right, Split V↔H, Save↔Load, Unite↔Isolate, and Lock Group at its current position↔first. The Lock Tab tile already worked this way; the rest now match it, so a pair costs one dashboard slot instead of two
- **Fix `/collapse` missing from the action list** — collapsing every group was only reachable by typing the command. It was absent from the More panel, so it could not be starred onto the dashboard, and absent from the overflow menu. It now appears in both, under Organize
- **Fix status messages clearing early** — dashboard actions armed their own dismiss timers instead of using the shared one, so a dash action followed by an undo wiped the undo's confirmation before it could be read. Every status message now shares a single timer
- **`/shuffle` is one operation, not one per tab** — it moved tabs individually, so a 150-tab window meant 150 sequential Chrome calls
- **Palette actions moved out of the popup component** into `lib/actions.ts`, one handler per command. They were a 300-line switch reachable only by mounting the UI, so none of their behaviour was tested; the suite now covers them directly, along with the close/unite/isolate/shuffle operations in `lib/tabs.ts` that had no tests at all (237 → 296 tests)
- **Pin auto-follow moved to its own listener**, so toggling a pin no longer runs the grouping automations' prologue first
- **Cross-window tab moves share one implementation**, so a fix to group preservation reaches every command at once
- Removed a leftover raw-storage debug dump from the Pins panel
- Pattern length is capped in ignore rules, matching the palette's regex search

## 0.5.0 — 2026-07-17

### New Features

- **MRU empty state** — Cmd+E with no query now lists tabs by most-recently-used instead of positional order, with the previous tab first (Cmd+E → Enter acts as alt-tab)
- **Recency-ranked search** — exact/prefix/regex matches are now ordered by recency instead of tab index, and a single ranked search (prefix → substring → fuzzy) replaces the old user-selected search modes
- **Switch to existing tab** — new "Switch" toggle: navigating to an already-open URL in a fresh tab focuses the existing tab instead of creating a duplicate (intentional "Duplicate Tab" copies are left alone)
- **Pinyin and CJK search** — tabs with Chinese titles are now searchable by typing pinyin (`zhihu`, `zh`) on a Latin keyboard, and typing Chinese directly now works in every search mode
- **`/re` regex command** — regex search is now a slash command instead of a cycled mode

### Bug Fixes

- **Fix focus mode data loss** — saving a second workspace while one was already saved silently destroyed the first (after its tabs were already closed); workspaces are now a stack, saved before tabs close and restored in LIFO order
- **Fix archive restore data loss** — an archived tab that failed to reopen was deleted from the archive anyway; failed restores now stay in the archive
- **Fix fuzzy search returning nothing for Chinese queries** — uFuzzy's term matching doesn't handle CJK text; CJK needles now use substring matching in every mode
- **Fix auto-ungroup fighting other extensions** — untitled single-tab groups (e.g. created by automation tools like Claude-in-Chrome MCP) were instantly dissolved, causing a delete/recreate loop that broke the other extension; auto-ungroup now skips untitled groups entirely

### Improvements

- **Removed the search-mode picker** — fuzzy/exact/prefix/regex pills and ⇧Tab cycling are gone; search now ranks results automatically
- **Test coverage for undo and archive** — characterization tests lock the behavior of the undo stack, `executeUndo`, and the archive module ahead of future work

## 0.4.3 — 2026-07-17

### New Features

- **Pin/Unpin toggle** — Pin Tab button now detects if the active tab is already pinned and shows "Unpin" with a pin-off icon; clicking toggles between pin and unpin
- **Alt modifier for Pin Top** — hold Alt (or Ctrl) to pin the active tab at the first position in its group; shows "Pin Top" label and icon while held
- **Dynamic pin state in sidebar** — the More Actions panel also reflects the current pin/unpin state and responds to the Alt modifier

### Improvements

- **PinsPanel title/URL sync** — opening the Pins panel now syncs each pin's title, URL, and tabId from the currently open tabs, keeping the list accurate even after tab navigations

## 0.4.2 — 2026-07-17

### Bug Fixes

- **Fix dashboard actions lost on reload** — Svelte 5's `$state` proxy was serialized as an object by `chrome.storage.local`, corrupting the array; now spread to plain array before saving and validated with `Array.isArray()` on load
- **Fix sidebar clicks for More and Archive tabs** — clicking sidebar buttons while search input was focused caused a layout shift (search mode pills removed from DOM on blur), making clicks miss their target; pills row now uses CSS `invisible` instead of conditional rendering
- **Fix archive sidebar action** — replaced fragile `$effect` (read+write same `$state`) with direct `onarchive` callback
- **Resilient Chrome API calls** — wrapped `chrome.storage.session` calls in `try/catch`

### Improvements

- **SEO-friendly extension name** — renamed to "TabOrdo - Tab Manager & Organizer" for better discoverability

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
