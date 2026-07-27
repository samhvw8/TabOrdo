# Research Report: Chrome Extension Tab-Related API Updates (2024-2026)

Gatherer: gather-updated-apis | Language: EN only | Conducted: 2026-07-24

## Research Methodology

- Sources: official Chrome for Developers docs, Chromium issue tracker, W3C WebExtensions CG GitHub, GitHub repos/issues/PRs, Chromium extensions Google Group, tech press
- Retrieval tools: WebSearch, WebFetch, `gh` CLI (search repos/issues/prs)
- Iterations: 7 complete search-fetch cycles
- Date range of sources: Chrome 88 (2021, baseline) through Chrome 140 (Sep 2025) + live GitHub activity through 2026-07-24
- GitHub coverage: 10 tab-manager repos found (L1 broad), 2 chromium-source files, 8+ issue/PR searches across tabGroups/splitViewId/frozen/openPopup/sessions

---

## 1. chrome.tabs API updates — GEM

Official ref: [chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)

New/changed since 2024:
- **`frozen` property (Chrome 132, Nov 2024)** — tab is frozen by the browser; messages sent to frozen tabs are queued rather than dropped. Relevant for tab managers that ping tabs for liveness/activity.
- **`splitViewId` property + `SPLIT_VIEW_ID_NONE` constant (Chrome 140, Sep 2025)** — identifies which Split View a tab belongs to. **Read-only / detection only** — Chrome does NOT expose methods to create, resize, or arrange split views programmatically. [Confirmed via GitHub issue below.]
- **`lastAccessed` property (Chrome 121, Feb 2024)** — timestamp of last tab activation. Useful for "sort by recency" / stale-tab detection in tab managers — directly relevant to TabOrdo's search ranking work.
- **`TAB_INDEX_NONE` constant (Chrome 123)**
- **`goBack()` / `goForward()` (Chrome 72+)** — older but often missed, lets extensions navigate tab history programmatically.
- **Expanded URL protections on `tabs.update()`/`tabs.create()`/`windows.create()` (Chrome 117, Aug 2023)** — restricts extensions from navigating to certain privileged URLs.

Source: [What's new in Chrome extensions](https://developer.chrome.com/docs/extensions/whats-new)

**Cross-browser note:** Firefox shipped its own `splitViewId` on `tabs.Tab` in **Firefox 149** (Apr 2026, [Mozilla blog](https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/)) — parallel but independently-designed feature. WXT (cross-browser framework) is tracking whether to unify types: [wxt-dev/wxt#2303](https://github.com/wxt-dev/wxt/issues/2303) (open, 2026-06-30). Maintainer comment: "this isn't the first issue... that asks for better type support for Firefox... Maybe it's time we break away from relying on Chrome's [types]." — signals real friction for extensions targeting both browsers.

**Real pain point (GEM):** [w3c/webextensions#967](https://github.com/w3c/webextensions/issues/967) "Extension API to explicitly create split views or unsplit them" — open discussion (last activity 2026-07-16), labeled "Needs further discussion." Proposes 3 scenarios: create split view from single tab, combine two tabs into split view, unsplit. **No Chrome/Firefox team commitment yet** — extensions can only detect split views today, not control them.

**Related breakage:** [stefansundin/duplicate-tab#30](https://github.com/stefansundin/duplicate-tab/issues/30) "Chrome: Duplicating single tabs in a split view not working" (open) and [Tai-ch0802/arc-like-chrome-extension#71](https://github.com/Tai-ch0802/arc-like-chrome-extension/issues/71) "Split View 分頁拖曳會導致 splitViewId 被重設 (Chrome API 限制)" (wontfix — dragging tabs in split view resets splitViewId, an acknowledged Chrome API limitation).

---

## 2. chrome.tabGroups API updates — GEM

Official ref: [chrome.tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)

- **`shared` boolean property (Chrome 137+)** — indicates whether a tab group is a shared group (Chrome's collaborative tab groups feature). New TabGroup type field.
- Core API unchanged since Chrome 89/90 launch (`get`, `move`, `query`, `update`, events `onCreated/onMoved/onRemoved/onUpdated`).

**Critical known limitation (GEM — directly relevant to TabOrdo):** Extensions **cannot update Saved Tab Groups** via `chrome.tabGroups.update()`. Confirmed via:
- [Chromium issue 323982812](https://issues.chromium.org/issues/323982812) "chrome.tabGroups.update() API fails for a Saved Tab Group"
- Chromium extensions Google Group thread: [Questions/Issues with new tab group saving/pinning functionality](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/rypFJOkAlz8) — error message is something like "saved tab groups cannot be updated," and **there is no API-exposed way to detect whether a group is saved** before calling update.
- Chrome team stance (per community thread): restriction is deliberate — extensions silently mutating a user's saved/synced groups was seen as risky; team says it's "not intended long term" but other groundwork must land first before extension APIs reopen here.

**Practical implication for TabOrdo:** any group-rename/recolor/collapse feature must handle `update()` throwing for saved groups, with no proactive way to detect the saved state other than try/catch.

**Related bug reports:**
- [daintreehq/daintree#10440](https://github.com/daintreehq/daintree/issues/10440) (closed) "Tab-group membership lost on restore when a panel respawns with a new id"
- Chromium Group: [Bug in chrome.tabGroups.move() API?!](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/TX2SP87uPt0) — additional move() reliability complaint (unverified severity, flagged as MEH pending deeper read)

---

## 3. chrome.windows API updates — MEH (mostly stable/stagnant)

Official ref: [chrome.windows](https://developer.chrome.com/docs/extensions/reference/api/windows)

- No new window `type` or `state` values found for 2024-2026. Types remain `normal, popup, panel, app, devtools`; states remain `normal, minimized, maximized, fullscreen`.
- Most recent event: `onBoundsChanged` (Chrome 86, predates window) — fires when a resize/move completes.
- **Chrome's native Split View / "side-by-side tabs" feature (rolled out ~Jan 2025, [TechRadar coverage](https://www.techradar.com/computing/chrome/a-new-split-screen-feature-is-coming-to-google-chrome-and-its-surprisingly-powerful), [WindowsLatest](https://www.windowslatest.com/2025/01/24/after-microsoft-edge-chrome-tests-a-split-tabs-feature/)) is exposed to extensions via `chrome.tabs.splitViewId`, NOT via `chrome.windows`.** Windows API itself got no split-view surface.
- Same URL-navigation restrictions as tabs API landed in Chrome 117 for `windows.create()`.

**Assessment:** `chrome.windows` is the least-evolved of the tab-adjacent APIs in this window. If TabOrdo needs window-state awareness beyond basic bounds/focus, there's nothing new to leverage.

---

## 4. chrome.sessions API — MEH (stable, functional, no major 2024-2026 changes)

Official ref: [chrome.sessions](https://developer.chrome.com/docs/extensions/reference/api/sessions)

How it works:
- `getRecentlyClosed(filter?)` — list of recently closed tabs/windows (capped by `MAX_SESSION_RESULTS = 25`, the hard quota — cannot be raised).
- `getDevices(filter?)` — synced sessions from other devices (cross-device tab access).
- `restore(sessionId?)` — reopens a tab/window incl. navigation history (back/forward works post-restore); omitting `sessionId` restores the most-recently-closed item.
- `onChanged` event fires on local recently-closed changes only — **does not fire for changes to synced/foreign-device sessions.**
- Promise support landed Chrome 96 (2021) — last doc update noted Aug 11, 2025, but no functional/quota changes documented for 2024-2026.

**Gap for TabOrdo-type extensions:** the 25-item cap and lack of a push signal for cross-device session changes are long-standing constraints — no indication either is being lifted. No GitHub issues surfaced showing active development/breakage on this API (searched, found none of note) — treat as a stable, low-priority-for-updates area.

---

## 5. chrome.contextMenus — GEM (relevant "tab" context confirmed)

Official ref: [chrome.contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)

- Context types include `"tab"` — lets an extension add menu items that appear when right-clicking a browser tab (not just page content). This is the one most relevant to a tab-manager UI (e.g., add a "Send to group" tab-context menu item).
- `remove()`, `removeAll()`, `update()` became Promise-based in **Chrome 123**.
- `ACTION_MENU_TOP_LEVEL_LIMIT = 6` — max top-level items allowed on the action's own context menu.
- No dedicated "tab group" context type exists — context menus cannot be scoped to a tab-group header/right-click directly (confirmed absent from context type enum: `all, page, frame, selection, link, editable, image, video, audio, launcher, browser_action, page_action, action, tab`).

---

## 6. chrome.commands API — MEH (stable, known constraints)

Official ref: [chrome.commands](https://developer.chrome.com/docs/extensions/reference/api/commands)

- `getAll()` Promise-based since Chrome 96; before **Chrome 110** it didn't correctly return `_execute_action` in the list (fixed).
- Hard limit: **max 4 suggested keyboard shortcuts** per extension.
- "Global" shortcuts (work without Chrome focus) restricted to `Ctrl+Shift+[0-9]` only, and unavailable on ChromeOS (Chrome 35+, unchanged).
- `Ctrl+Alt` combos disallowed (AltGr collision on some keyboard layouts).
- No new capabilities found for 2024-2026 — this API has not evolved recently.

---

## 7. chrome.action API — GEM (side panel vs popup, badge)

Official ref: [chrome.action](https://developer.chrome.com/docs/extensions/reference/api/action), [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

Action API additions:
- **`openPopup()` (Chrome 127, Jun 2024)** — programmatically opens the extension popup (previously policy-restricted; opened to all extensions this version).
- **`onUserSettingsChanged` event (Chrome 130, Oct 2024)** — fires when user changes action-related settings (e.g., pinning to toolbar).
- **`setBadgeTextColor()` / `getBadgeTextColor()` (Chrome 110, Nov 2022)** — full badge text-color control, not just background.
- **`isEnabled()` (Chrome 110)** — check enabled-state per tab.

Side panel vs popup (design tradeoffs, not new API but worth noting for TabOrdo since it's evaluating popup UX):
- Side panel gets far more UI real estate than a popup; Chrome handles open/close/pin chrome; persists across tab navigation if configured; full Chrome API access identical to popup pages.
- **`sidePanel.getLayout()` (Chrome 140, Sep 2025)** — new method to detect whether the side panel is rendered left or right (for RTL support). Confirms side panel positioning is now user-configurable and extensions should adapt.

**Type-definition gap (MEH):** [DefinitelyTyped/DefinitelyTyped#60530](https://github.com/DefinitelyTyped/DefinitelyTyped/issues/60530) (closed) "chrome.action is missing the method openPopup and the type OpenPopupOptions" — `@types/chrome` lagged the real API; worth pinning a recent `@types/chrome` version in TabOrdo if using `openPopup()`.

---

## 8. chrome.storage (storage.session) — GEM

Official ref: [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)

- `storage.session` launched **Chrome 102** (Mar 2022), MV3-only, in-memory (cleared on extension reload/disable, never touches disk).
- **Quota raised to ~10 MB (Chrome 112-114, 2023)** — up from the original 1 MB. This predates the 2024-2026 window but is worth flagging since many blog posts/tutorials still cite the old 1 MB limit — a common outdated-info trap.
- No write-throttling on `storage.session` (unlike `storage.sync`'s 120 ops/min, 1800/hour cap) — makes it the right choice for high-frequency ephemeral state (e.g., live drag-reorder state) vs. `storage.local`/`sync`.
- No further quota/capability changes found for 2024-2026 — API is stable at the new quota.

---

## 9. Offscreen documents — GEM (directly useful for tab managers)

Official ref: [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [Offscreen Documents in Manifest V3 blog](https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3)

- Became available in MV3 at **Chrome 109** (Jan 2023); `reason` types expanded — `LOCAL_STORAGE`/`WORKER` added Chrome 113, and **multiple reasons can be specified simultaneously since Chrome 115** (Jun 2023).
- **Direct tab-manager relevance:** non-popup-triggered clipboard writes (keyboard shortcut, context menu, one-click "copy tab list") **cannot use the Clipboard API from a service worker** in MV3 — offscreen document is the sanctioned workaround.
- Real-world reference implementation: [hansifer/tab-copy](https://github.com/hansifer/tab-copy) — "copying tabs to clipboard in a variety of formats," uses a single on-demand offscreen document (spun up when needed, closed after inactivity, enforces max 1 instance) — directly analogous pattern for TabOrdo if it ever adds "copy tab list" / "export session as text" features.
- Other uses found: short audio-clip playback for notifications, hidden-iframe scraping. Only `chrome.runtime` API is available inside an offscreen document — everything else must be message-passed from the service worker.
- Constraint: **only one offscreen document per extension at a time.**

---

## 10. Service worker improvements for MV3 — GEM

Official ref: [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Longer extension service worker lifetimes blog](https://developer.chrome.com/blog/longer-esw-lifetimes)

- **Chrome 110 (Jan 2023):** Core lifecycle fix — service workers no longer get killed mid-flight when events are still queued; hard 5-min max lifetime removed in favor of "stays alive as long as actively processing," bounded by: 30s idle timeout (any event/API call resets it) and 5-min single-task ceiling.
- **Chrome 116 (Aug 2023):** WebSocket activity now resets the 30s idle timer — any active WebSocket keeps the worker alive; a sub-30s `setInterval` keepalive ping over the socket is a documented pattern.
- **Chrome 120 (2024):** `chrome.alarms` minimum period enforced at 30s to match service-worker idle window (previously could be set shorter, which was misleading since the worker would die anyway).
- **`chrome.debugger` API sessions now keep the service worker alive** while a debug session is active (prevents workers dying mid-debug).
- **Chrome 100 (2022, predates window but frequently miscited as newer):** native-messaging ports keep service workers alive.

**Relevant to TabOrdo:** if TabOrdo's background logic depends on periodic polling (e.g., checking tab staleness, ungroup timers), `chrome.alarms` at ≥30s intervals is still the only officially-sanctioned persistent-timer mechanism — no new sub-30s primitive was added in this window.

---

## Cross-Cutting Observations

1. **Split View is the single biggest 2024-2026 tab-API theme.** Both Chrome (140) and Firefox (149) shipped native split-view UI and matching read-only `splitViewId` tab properties, but neither browser gives extensions write access yet. This is an active W3C WebExtensions CG discussion ([#967](https://github.com/w3c/webextensions/issues/967)) — worth monitoring if TabOrdo wants split-view-aware features later; nothing actionable today beyond detection.
2. **Saved Tab Groups remain extension-hostile.** `tabGroups.update()` throws for saved groups with no way to pre-detect the saved state — a real, currently-unaddressed gap directly affecting any tab-group-manipulating extension like TabOrdo.
3. **`lastAccessed` (tabs, Chrome 121) is a concrete, actionable addition** for TabOrdo's tab-ranking/search work — enables "recently used" sorting without maintaining a separate access-time cache.
4. **Service worker lifecycle is meaningfully better than MV3's early reputation suggests** (Chrome 110+ fix) but still has a hard 30s idle ceiling with no new bypass mechanism — `chrome.alarms` (≥30s) is still the only sanctioned persistent-timer path.
5. **`@types/chrome` lags real Chrome API ships** (openPopup example) — verify type coverage before relying on newer methods (`splitViewId`, `getLayout`, `onUserSettingsChanged`) in TypeScript.

---

## GitHub Repositories (tab-manager landscape, L1 broad search)

| Repo | Stars/Activity | Note |
|---|---|---|
| [MaryEhb/tab-manager-chrome-extension](https://github.com/MaryEhb/tab-manager-chrome-extension) | active 2026-07 | basic tab manager |
| [ThangaBalajiS/OrganizeTabs](https://github.com/ThangaBalajiS/OrganizeTabs) | "1,000+ weekly active users" | group/organize tabs |
| [wshayes/tabmgr](https://github.com/wshayes/tabmgr) | active 2026-03 | tab manager |
| [sienori/Tab-Session-Manager](https://github.com/sienori/Tab-Session-Manager) | active, large issue tracker | session save/restore, has open split-view feature request |
| [hansifer/tab-copy](https://github.com/hansifer/tab-copy) | — | reference implementation for offscreen-document clipboard pattern |
| [d-bucur/addictive-tabs](https://github.com/d-bucur/addictive-tabs) | active 2025-06 | tab declutter manager |
| [vx6Fid/Tabs-Manager](https://github.com/vx6Fid/Tabs-Manager) | active | tab grouping |
| [zubdeen/Tab-Manager-Chrome-Extension](https://github.com/zubdeen/Tab-Manager-Chrome-Extension) | active 2024-11 | tab manager |
| [wxt-dev/wxt](https://github.com/wxt-dev/wxt) | major framework | cross-browser extension framework tracking splitViewId typing |
| [Tai-ch0802/arc-like-chrome-extension](https://github.com/Tai-ch0802/arc-like-chrome-extension) | active 2026-06 | Arc-browser-like extension hitting splitViewId API limits |

## Sources

- [chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [chrome.tabGroups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [chrome.windows API](https://developer.chrome.com/docs/extensions/reference/api/windows)
- [chrome.sessions API](https://developer.chrome.com/docs/extensions/reference/api/sessions)
- [chrome.contextMenus API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [chrome.commands API](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [chrome.action API](https://developer.chrome.com/docs/extensions/reference/api/action)
- [chrome.sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [chrome.storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [What's new in Chrome extensions](https://developer.chrome.com/docs/extensions/whats-new)
- [Offscreen Documents in Manifest V3 (blog)](https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3)
- [Longer extension service worker lifetimes (blog)](https://developer.chrome.com/blog/longer-esw-lifetimes)
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [w3c/webextensions#967 — split view API request](https://github.com/w3c/webextensions/issues/967)
- [wxt-dev/wxt#2303 — splitViewId cross-browser typing](https://github.com/wxt-dev/wxt/issues/2303)
- [sienori/Tab-Session-Manager#1615 — split tab state on session restore](https://github.com/sienori/Tab-Session-Manager/issues/1615)
- [stefansundin/duplicate-tab#30 — split view duplicate bug](https://github.com/stefansundin/duplicate-tab/issues/30)
- [Tai-ch0802/arc-like-chrome-extension#71 — splitViewId reset on drag](https://github.com/Tai-ch0802/arc-like-chrome-extension/issues/71)
- [Chromium issue 323982812 — tabGroups.update() fails for Saved Tab Group](https://issues.chromium.org/issues/323982812)
- [Chromium Group — saved/pinned tab group issues](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/rypFJOkAlz8)
- [Chromium Group — tabGroups.move() bug report](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/TX2SP87uPt0)
- [daintreehq/daintree#10440 — tab-group membership lost on restore](https://github.com/daintreehq/daintree/issues/10440)
- [DefinitelyTyped#60530 — chrome.action.openPopup type gap](https://github.com/DefinitelyTyped/DefinitelyTyped/issues/60530)
- [Mozilla blog — Firefox 149-152 WebExtensions API changes](https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/)
- [TechRadar — Chrome split-screen feature](https://www.techradar.com/computing/chrome/a-new-split-screen-feature-is-coming-to-google-chrome-and-its-surprisingly-powerful)
- [WindowsLatest — Chrome copying Edge split tabs](https://www.windowslatest.com/2025/01/24/after-microsoft-edge-chrome-tests-a-split-tabs-feature/)
- [hansifer/tab-copy — offscreen-document reference impl](https://github.com/hansifer/tab-copy)

## Unresolved Questions

- No lobste.rs threads found discussing Chrome extension tab APIs specifically (checked — likely too niche a topic for that forum's audience).
- Stack Overflow `site:` search returned MDN/GitHub results instead of actual SO threads (search engine indexing quirk) — did not independently re-verify via SO's own search; sessions API community pain points were instead sourced from official docs + GitHub.
- Could not fetch full body of Chromium issue 323982812 (requires auth/JS rendering) — relied on search snippet + corroborating Chromium Group thread for the same bug; confidence is high but not a direct primary-source read.
- No official Chrome team timeline found for opening up Saved-Tab-Group or Split-View write APIs to extensions — flagged as open/unresolved in upstream trackers, not something this research can resolve further.
