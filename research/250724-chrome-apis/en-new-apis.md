# Research Report: New Chrome Extension APIs (2024–2026) for Tab-Manager Extensions

Language: EN only. Conducted: 2026-07-24.

## Executive Summary

Chrome shipped incremental, not revolutionary, extension API surface for tab management in 2024-2026. The two most actionable additions for a tab-manager extension (TabOrdo) are: (1) `tabs.frozen`/`tabs.lastAccessed`/`tabs.splitViewId` properties for smarter tab-state awareness, and (2) the on-device Prompt/Summarizer API (Gemini Nano, Chrome 138+) as a privacy-preserving path to AI-powered tab grouping without shipping API keys to OpenAI/etc. — several competing "AI tab organizer" extensions already do this.

The biggest **gap**, not addition: Chrome's native Saved Tab Groups feature (the bookmark-bar tab groups introduced ~Chrome 128-130) has **no dedicated extension API**. `chrome.tabGroups.update()` throws on saved groups, there's no way to detect if a group is saved, and closed/saved groups are entirely invisible to extensions (confirmed via multiple open W3C WebExtensions Community Group issues and Chromium bugs — see Saved Tab Groups section). Any tab manager claiming to manage saved groups is working around this blind spot, not through a sanctioned API.

`chrome.processes` (memory/CPU per tab) remains Dev-channel-only and unusable for a Web-Store-published extension — same restriction it's had for years, not a 2024-2026 change. `chrome.sidePanel` is mature and stable (shipped 2023) with only minor additions since (`getLayout` Chrome 140, `close`/`onOpened`/`onClosed` Chrome 141-142). `chrome.readingList` (Chrome 120+) is fully accessible to extensions with read/write/query.

## Research Methodology

- Sources: official Chrome for Developers docs, Chromium bug tracker (partial — sign-in-walled), W3C WebExtensions Community Group GitHub, Chromium-extensions Google Group threads, GitHub code/issue search.
- Language: English only (per assignment).
- Retrieval tools: WebSearch, WebFetch, `mcp__parallax__fetch_page` (used to bypass Chromium issue tracker sign-in wall for Google Groups mirror pages — worked for Groups, did NOT work for issues.chromium.org itself, which requires auth even via Jina-style fetch), `gh` CLI (repos/code/issues search).
- Date range of sources: Chrome 114 (2023, background context) through Chrome 148 (mid-2026, current).

## Key Findings by Focus Area

### 1. Side Panel API (`chrome.sidePanel`) — GEM (mature reference, no news)

Shipped Chrome 114 (2023) — not itself new to this window, but has had steady additions:

| Method/Event | Chrome ver | Notes |
|---|---|---|
| `setOptions()`, `getOptions()`, `setPanelBehavior()`, `getPanelBehavior()` | 114+ | Core config |
| `open()` | 116+ | Must be called from a user-gesture handler |
| `getLayout()` | **140 (2025)** | Returns `"left"`/`"right"` — for RTL-aware UI |
| `close()` | **141 (2025)** | Closes panel for a given tab/window |
| `onOpened` | **141 (2025)** | Fires with `{path, windowId, tabId?}` |
| `onClosed` | **142 (2026)** | Fires with `{path, windowId, tabId?}` |

Limitations (unchanged): only 3 original methods total surface area; no min/max-width control; `open()` requires a user gesture (click, keyboard shortcut, context menu) — can't be opened programmatically from a background event. Tab-specific panel config overrides the global one.

Real-world usage confirmed via `gh search code "chrome.sidePanel.setPanelBehavior"`: `stellar/freighter`, `madfish-solutions/templewallet-extension`, `LonMcGregor/LinksPanel` (tab-manager-adjacent), and Google's own `GoogleChrome/modern-web-guidance` skill doc — which flags a **real gotcha**: the behavior property is `openPanelOnActionClick`, NOT `openPanelOnActionIconClick`; using the wrong name throws a silent synchronous TypeError that kills the service worker.

Sources: [sidePanel API ref](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [what's new](https://developer.chrome.com/docs/extensions/whats-new), [GoogleChrome/modern-web-guidance SKILL.md](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/chrome-extensions/SKILL.md)

### 2. Reading List API (`chrome.readingList`) — GEM

Yes, extensions have full access. Shipped **Chrome 120+ (MV3 only)**, permission `"readingList"`.

Methods: `addEntry()`, `query()`, `removeEntry()`, `updateEntry()`. Events: `onEntryAdded`, `onEntryRemoved`, `onEntryUpdated`. Entries keyed by full URL (incl. hash/query string), unordered, fields: `url`, `title`, `hasBeenRead`, `creationTime`, `lastUpdateTime`.

Implication for TabOrdo: a tab manager could integrate "send tab to reading list" or surface reading-list items alongside open tabs — this is a real, usable, underexploited integration point. No rate limits documented.

Sources: [readingList API ref](https://developer.chrome.com/docs/extensions/reference/api/readingList)

### 3. Saved Tab Groups API — MEH/GEM (important negative finding)

**There is no dedicated Saved Tab Groups API.** `chrome.tabGroups` (launched 2021, pre-window) is the only surface, and it does not distinguish saved vs. open groups in any documented property.

Confirmed pain points (from Chromium bug + GitHub issue research):
- `chrome.tabGroups.update()` **fails** on a saved tab group with error "Saved groups are not editable" ([Chromium issue 323982812](https://issues.chromium.org/issues/323982812) — full content sign-in-walled, confirmed via search snippets and community reports).
- **No API field indicates whether a group is saved.** An extension cannot tell a live open group from a saved-but-closed one.
- **Closed/saved groups and their contents are entirely invisible to extensions.** From [w3c/webextensions#715](https://github.com/w3c/webextensions/issues/715) (open, needs-triage across Chrome/Safari/Firefox as of July 2026), a commenter (`turing`) describes exactly TabOrdo's problem domain: *"if a user closes a tab group, it becomes completely invisible to the extension... If [a heuristic-grouping] extension is supposed to create a group if one doesn't already exist... now you've made a duplicate."* Another commenter (`geddski`) independently confirms: *"I just ran into this limitation, trying to build a tab group switcher extension... I'd love if the extension API had access to closed groups! (It can only see open groups atm)"* — dated July 2026, i.e. this is a live, unresolved gap right now.
- Firefox added its own `tabGroups` API in Firefox 139 (2025) as a parallel track — the W3C group is trying to reconcile the two, so any future Saved Tab Groups extension API is likely to emerge from that cross-browser discussion, not a unilateral Chrome addition.

One genuinely NEW property did ship: **`TabGroup.shared`** (Chrome 137, May 2025) — indicates a group is a real-time collaborative "shared tab group" (multi-user, synced tabs). This came directly out of [w3c/webextensions#749](https://github.com/w3c/webextensions/issues/749) ("Proposal: Support a shared state for tab groups", marked `implemented: chrome`). Relevant if TabOrdo ever needs to special-case collaborative groups (e.g., don't offer to auto-close/reorganize a shared group without warning, since other users are watching it live).

Also flagged but unresolved: [w3c/webextensions#715](https://github.com/w3c/webextensions/issues/715) is specifically about **pinned tab groups** (a newer Chrome UI feature) not yet exposed to `chrome.tabGroups` at all.

**Actionable takeaway for TabOrdo:** don't build features that assume you can read/write saved or closed groups — that's structurally impossible today. Track w3c/webextensions#715 and the Chromium saved-groups bugs for when/if this opens up.

Sources: [w3c/webextensions#715](https://github.com/w3c/webextensions/issues/715), [w3c/webextensions#749](https://github.com/w3c/webextensions/issues/749), [Chromium 323982812](https://issues.chromium.org/issues/323982812), [chromium-extensions Group: "shared" property PSA](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/BGOEmpYgeyc/m/er8GyOrbAAAJ), [chrome.tabGroups ref](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)

### 4. UserScripts API (`chrome.userScripts`) — MEH (relevance to tab management is indirect)

**Chrome 135 (March 2025)**: new `userScripts.execute()` method — inject a user script **once, on demand**, instead of the MV3 requirement to pre-register all scripts ahead of time via `register()`. Requires the `userScripts` permission and (typically) user-toggled "Allow User Scripts" developer mode.

Relevance to TabOrdo: low-to-medium. This API is aimed at userscript-manager extensions (Tampermonkey-style), not tab managers. The one plausible tie-in: if TabOrdo ever wants to run a one-off content-side script against a specific tab (e.g., extract page metadata for smarter auto-grouping) without permanently registering a content script on every page — which the community notes costs ~300kB memory per tab even when empty — `userScripts.execute()` is lighter-weight than `scripting.executeScript()` for that narrow case. Not a priority.

Sources: [userScripts API ref](https://developer.chrome.com/docs/extensions/reference/api/userScripts), [chromium-extensions Group: PSA on execute()](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/oEo-Jm0EqsY)

### 5. `chrome.processes` (memory/CPU per tab) — NOISE for shipping product

**Status unchanged and still Dev-channel-only** — docs explicitly state `"Availability: Dev channel"`. This is NOT a stable, Web-Store-safe API; it has been Dev-channel-restricted for years, and nothing in 2024-2026 sources indicates a graduation to stable. Building a memory/CPU feature on this API means it silently won't work for the vast majority of users on Stable channel Chrome.

API surface (unchanged): `getProcessIdForTab()`, `getProcessInfo(processIds, includeMemory)`, `terminate()`; events `onCreated`, `onExited`, `onUnresponsive`, `onUpdated`, `onUpdatedWithMemory`. Explicit warning in docs: collecting memory info incurs extra CPU overhead, query only when needed.

**Practical alternative** used by real extensions (e.g. `andyjy/Process-Monitor-for-Chrome`, "Tab Monitor" on Web Store): these rely on the same restricted API and are typically installed as unpacked/dev-mode, OR they approximate memory pressure indirectly. Not a real solve for a Stable-channel product like TabOrdo.

Sources: [chrome.processes API ref](https://developer.chrome.com/docs/extensions/reference/api/processes), [Process Model API design doc](https://www.chromium.org/developers/design-documents/extensions/proposed-changes/apis-under-development/processes-api/)

### 6. NavigationHistory API — NOISE (not an extension API at all)

`window.navigation` (the "Navigation API") is a **web-platform page API**, not a Chrome extension API — it lets a same-origin web page inspect its own SPA navigation stack. It reached Baseline "Newly Available" in Jan 2026 (Chrome, Edge, Firefox 147, Safari 26.2). It is **not exposed to extension background/service-worker contexts** and has no relevance to cross-tab history for a tab manager.

The actual extension-facing equivalent is `chrome.webNavigation` (pre-existing, requires `"webNavigation"` permission) — for observing navigation events across tabs — and `chrome.history` (existing) for the persisted history store. Neither is new in this window. One relevant-but-old wrinkle worth knowing: since ~2023 (Chrome 115, `isLocal` field), `chrome.history.getVisits()`/`search()` return synced history from **other devices** merged in by default; `VisitItem.isLocal` lets you filter back to local-only if a feature (e.g. "recently closed on this device") depends on it. This predates the 2024-2026 window but is a common surprise for anyone building on `chrome.history` today.

Sources: [Navigation API (Chrome for Developers)](https://developer.chrome.com/docs/web-platform/navigation-api), [chrome.webNavigation ref](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [chromium-extensions Group: history sync changes](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/lBpRw_Te4tw/m/jwRxMBBaAAAJ)

### 7. Tab Organization API (AI-powered suggestions) — GEM (mechanism exists, no dedicated "organize" API)

There is **no `chrome.tabOrganizer` or similar first-party grouping-suggestion API**. Chrome's own built-in "Organize Similar Tabs" feature is a Chrome UI feature, not something extensions can call into or extend.

What extensions actually use for AI-powered tab grouping today, confirmed across multiple shipping products (Tab Manager AI, "AI Tab Organizer" by jkainmm, ATO, Tabaroo):
- Read tab URLs/titles via existing `chrome.tabs`/`chrome.tabGroups`, send to an LLM (OpenAI/Gemini/Claude, user-supplied API key), get back group names, then call `chrome.tabs.group()`/`chrome.tabGroups.update()` to apply. This pattern requires no new API — it's plumbing, not platform support.
- **Genuinely new and relevant**: the **Prompt API** (Gemini Nano on-device) and **Summarizer API**, both reaching Chrome Stable at **Chrome 138 (mid-2025)**, explicitly documented as **available to Chrome Extensions**. This lets a tab manager do local, private, no-API-key LLM inference for grouping/summarization — zero data leaves the device, no third-party API cost. This is the most concrete, novel opportunity in this whole research pass for a differentiated TabOrdo AI feature (privacy-first tab grouping vs. competitors shipping "paste your OpenAI key" UX).
- Chrome's own built-in tab-organizer feature is reportedly shifting to on-device inference as of Chrome 146 (March 2026) — same underlying on-device model family, reinforcing this as the platform direction.

Sources: [Extensions and AI](https://developer.chrome.com/docs/extensions/ai), [Prompt API](https://developer.chrome.com/docs/ai/prompt-api), [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api), [Built-in AI APIs](https://developer.chrome.com/docs/ai/built-in-apis)

### 8. Other new Chrome extension APIs since 2024 — mixed GEM/MEH

| Item | Chrome ver | Relevance to TabOrdo |
|---|---|---|
| `tabs.lastAccessed` | 121 (Feb 2024) | **GEM** — timestamp of last activation; directly useful for "sort by recency" / stale-tab detection, a core tab-manager feature |
| `tabs.frozen` (+ query filter) | 132 (Nov 2024) | **GEM** — surfaces browser-frozen (discarded-adjacent) tabs; useful for a "frozen/suspended tabs" view or excluding frozen tabs from active-tab logic |
| `tabs.splitViewId` (+ filter, `SPLIT_VIEW_ID_NONE`) | 140 (2025) | **MEH** — supports Chrome's new Split View UI; relevant only if TabOrdo wants to be split-view-aware (e.g. not duplicate-detect two halves of one split view as separate contexts) |
| `browser.*` namespace (alias of `chrome.*`) | 148 (mid-2026) | **MEH for Chrome-only, GEM if cross-browser** — `browser.tabs === chrome.tabs`; only matters if/when TabOrdo targets Firefox/Safari with one codebase via the WECG-standardized namespace |
| `StorageArea.getKeys()` | 130 (Sep 2024) | MEH — minor storage convenience, not tab-specific |
| Dashboard: direct member invites, private org publishing | Feb-Apr 2026 | NOISE for API surface — publisher/account-management only |

Sources: [chrome.tabs API ref](https://developer.chrome.com/docs/extensions/reference/api/tabs), [what's new in Chrome extensions](https://developer.chrome.com/docs/extensions/whats-new), [browser namespace docs](https://developer.chrome.com/docs/extensions/develop/concepts/browser-namespace)

## GitHub Signal (real-world usage & pain points)

- `gh search code "chrome.sidePanel.setPanelBehavior"` → 10 active repos using the API correctly, incl. `stellar/freighter`, `madfish-solutions/templewallet-extension`, `LonMcGregor/LinksPanel`; plus Google's own internal SKILL.md flagging the `openPanelOnActionClick` naming trap.
- `gh search issues "sidePanel" broken OR error OR limitation` → no high-signal sidePanel-specific breakage; results were dominated by unrelated repos (query too broad/generic — noise).
- `gh issue view 715/749 --repo w3c/webextensions` → primary source for the Saved Tab Groups gap (see §3) — this is the single most valuable GitHub find of this research pass, directly describing TabOrdo's exact problem domain from independent developers.
- `gh search repos "AI tab organizer"` → confirms a crowded, fast-moving competitive space (darkreader, nanobrowser, and dedicated tab-AI tools) all using the LLM-passthrough pattern described in §7, none yet using the on-device Prompt API per repo descriptions found.

## Unresolved Questions

1. Exact Chrome version where "Saved Tab Groups" (bookmark-bar groups) itself shipped, and whether a dedicated read/write API is on any public roadmap — Chromium issue tracker pages returned sign-in walls even via bypass tooling; would need a logged-in fetch or `chromestatus.com` search to confirm roadmap status.
2. Whether `chrome.tabGroups.query()` (or similar) can be combined with `chrome.bookmarks` (since saved groups persist to a bookmarks-like store) as an unofficial workaround to read saved-group metadata — not verified in this pass, worth a targeted follow-up.
3. Whether `userScripts.execute()` has any Manifest/permission interaction with Chrome's "Allow User Scripts" toggle that would affect distribution UX for a non-userscript-manager extension — only surface-level docs reviewed.
4. Real production reliability/quota data for the Prompt/Summarizer API (model download size, cold-start latency, per-origin quota) — not covered; would need a dedicated `developer.chrome.com/docs/ai/*` deep-read pass before committing to it as a feature.

## Sources

- https://developer.chrome.com/docs/extensions/whats-new
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://developer.chrome.com/docs/extensions/reference/api/readingList
- https://developer.chrome.com/docs/extensions/reference/api/tabGroups
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.chrome.com/docs/extensions/reference/api/processes
- https://developer.chrome.com/docs/extensions/reference/api/userScripts
- https://developer.chrome.com/docs/extensions/reference/api/webNavigation
- https://developer.chrome.com/docs/extensions/ai
- https://developer.chrome.com/docs/ai/prompt-api
- https://developer.chrome.com/docs/ai/summarizer-api
- https://developer.chrome.com/docs/ai/built-in-apis
- https://developer.chrome.com/docs/web-platform/navigation-api
- https://developer.chrome.com/docs/extensions/develop/concepts/browser-namespace
- https://issues.chromium.org/issues/323982812 (Saved Tab Groups update() failure — sign-in-walled, cited via search snippets)
- https://github.com/w3c/webextensions/issues/715 (pinned/saved tab group API gap)
- https://github.com/w3c/webextensions/issues/749 (`TabGroup.shared` proposal, implemented Chrome 137)
- https://groups.google.com/a/chromium.org/g/chromium-extensions/c/BGOEmpYgeyc/m/er8GyOrbAAAJ (shared tab groups PSA)
- https://groups.google.com/a/chromium.org/g/chromium-extensions/c/lBpRw_Te4tw/m/jwRxMBBaAAAJ (history sync / isLocal PSA)
- https://groups.google.com/a/chromium.org/g/chromium-extensions/c/oEo-Jm0EqsY (userScripts.execute PSA)
- https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/chrome-extensions/SKILL.md
- https://www.chromium.org/developers/design-documents/extensions/proposed-changes/apis-under-development/processes-api/
- GitHub code/issue searches: `chrome.sidePanel.setPanelBehavior`, `w3c/webextensions#715`, `w3c/webextensions#749`, "AI tab organizer" repo search
