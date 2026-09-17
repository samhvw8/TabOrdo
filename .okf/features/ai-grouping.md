---
type: Feature
title: AI grouping (/aigroup)
description: On-device Gemini Nano topic grouping run by the background service worker; covers the availability check, the progress record that doubles as the run's mutex, the renewed bulk-lock lease, why the popup starts it outside its own lock, and the feature's removal and return.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/ai.ts
tags: [ai, gemini-nano, background, bulk-lock, progress]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T00:16:05Z }
sources:
  - id: ai
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/ai.ts
    title: lib/ai.ts
    last_modified: 2026-08-02
  - id: ai-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/ai.test.ts
    title: lib/ai.test.ts
    last_modified: 2026-07-27
  - id: bg-index
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: entrypoints/background/index.ts (runAIGroup)
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: entrypoints/popup/App.svelte (startAIGroup, AI panel)
    last_modified: 2026-09-17
  - id: bulklock
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bulklock.ts
    title: lib/bulklock.ts
    last_modified: 2026-08-15
  - id: bulklock-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bulklock.test.ts
    title: lib/bulklock.test.ts
    last_modified: 2026-08-15
  - id: undo-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/undo.test.ts
    title: lib/undo.test.ts
    last_modified: 2026-09-17
  - id: privacy
    resource: https://github.com/samhvw8/TabOrdo/blob/main/PRIVACY.md
    title: PRIVACY.md "On-Device AI"
    last_modified: 2026-07-27
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md (0.6.0)
    last_modified: 2026-09-17
  - id: commit-ai-rules
    resource: https://github.com/samhvw8/TabOrdo/commit/619d7b5c03135b04d8b8eb0822409ed9ad6c7251
    title: Add AI rule suggestions via Chrome built-in Gemini Nano
    last_modified: 2026-06-02
  - id: commit-ai-more
    resource: https://github.com/samhvw8/TabOrdo/commit/762b2c9dd35a17022624c0b63be590d721e1be4e
    title: Add three AI rule-management features (gated on useAI)
    last_modified: 2026-06-02
  - id: commit-ai-removed
    resource: https://github.com/samhvw8/TabOrdo/commit/580806c9cc42af8bd9327dd5597f9e94d341d481
    title: Remove AI features and add sort-by option to /sort command
    last_modified: 2026-06-07
  - id: commit-apis
    resource: https://github.com/samhvw8/TabOrdo/commit/c1eeece38ab385e9b3d53bd867e793a2eb77cc8d
    title: "feat: add Chrome API integrations — Reading List, Side Panel, Sessions, AI grouping, context menus"
    last_modified: 2026-07-24
  - id: commit-lease
    resource: https://github.com/samhvw8/TabOrdo/commit/34314682268915f701ab683590a45f2f4a7c20c6
    title: "fix: AI-progress lease, listener crash guards, stricter chrome stub"
    last_modified: 2026-08-02
---

# Overview

`/aigroup`, the dashboard "AI Group" tile and the sidebar's AI panel send the ungrouped tabs' titles and URLs to Gemini Nano through Chrome's built-in Prompt API. They then create one group per suggested topic. The model runs in the browser and nothing is sent to a server. If the model is unavailable the run reports an error and does not fall back to anything remote.[^privacy] The run lives in the background service worker so it survives the popup closing.[^commit-apis]

# Flow

1. **Popup `startAIGroup()`.** If the progress record looks in flight, it shows that run instead. Otherwise it takes an undo snapshot (`snapshotBeforeGroup`), and a failed snapshot cancels the run. Then it sends `{ type: "aigroup-start" }`.[^popup-app]
2. **Background `runAIGroup()`.** It refuses when the progress status is `checking`, `prompting` or `grouping`.[^bg-index]
3. It takes its own bulk-lock lease (`AI_LEASE_MS` = 10 min) **before** anything that can reject, and renews it every 60 s while the run lives. The lease used to be taken after the availability check and tab query, whose rejections skipped the release and left the whole profile suppressed for ten minutes. A single fixed lease used to lapse during a first-use model download.[^bg-index][^bulklock]
4. `checking` → `checkAIAvailability()`.
5. It collects tabs that are ungrouped, not Chrome-pinned, and not `chrome://`, across **all windows**. It needs at least 2.
6. `prompting` → `suggestGroups()`: one session with a system prompt, one prompt listing every tab as `i. title | url`.[^ai]
7. `grouping`: for each suggestion, strays are moved into the window holding most of the group's tabs (`chrome.tabs.group` rejects cross-window ids). The tabs are marked as self-writes, grouped, and titled with `safeGroupUpdate`.[^bg-index]
8. `done` or `error`. In `finally` it clears the renew timer, **awaits any in-flight renewal**, and then releases the lease. Otherwise a late renewal could write a full lease back after the release.[^bg-index]

# Availability check

`getAPI()` supports both shapes: the global `LanguageModel` (Chrome 150+) and `window.ai.languageModel` (Chrome 138–149), mapping the old `readily`/`after-download` values onto `available`/`downloadable`.[^ai]

| Result | Reason shown |
|--------|--------------|
| No API | Enable `chrome://flags` → `#prompt-api-for-gemini-nano`, restart |
| `downloadable` | Run `LanguageModel.create()` in DevTools and wait about 2 minutes |
| Anything else / throw | Status or error text plus a flags hint |

# Parsing model output

`parseSuggestionJson` strips a fenced json code block or the prose around the answer. It accepts a plain array, `{"groups": [...]}`, a single bare group object and `[[...]]`. The single-group shape is checked before scanning object values, so a group's `indices` is never taken for the group list. Each of these shapes used to produce a false "no groups found".[^ai][^changelog] Colours cycle through 8 names by suggestion index, indices are mapped back to tab ids, and empty groups are dropped.[^ai]

# Progress state and its lease

`AIGroupProgress { status, total, processed, currentTab, grouped, groupCount, error, startedAt }` lives in `chrome.storage.session` under `tabOrdo_aiGroupProgress`.[^ai]

- **The progress status is the mutex** that decides whether a run can start. Only the background writes it. The popup and side panel read it on mount and follow `storage.onChanged`. When the popup wrote to it (dismissing a panel, a stale side panel, a poller stamping "checking"), two runs could start at once, or a run was refused or reset mid-run.[^popup-app][^changelog]
- **The in-flight record expires.** `setAIProgress` stamps `startedAt`. `getAIProgress` treats an in-flight record older than `AI_LEASE_MS` as idle. The prompt is the one stretch that makes no `chrome.*` calls, so MV3 can kill the worker mid-prompt and leave a record nobody will clear. Before this fix that blocked `/aigroup` until the browser restarted.[^ai][^commit-lease]

# Why it runs outside the popup's bulk lock

Every popup path (the typed command, the dashboard/overflow action, the panel's buttons) calls `startAIGroup()` directly, never inside `withBulkLock`. The typed command is handled before the lock is taken.[^popup-app] The history: under the old single-owner lock, the background's acquire lost to the popup's still-held UI lease, and the popup's release then cleared the lock entirely, so the whole AI run went unsuppressed.[^changelog] The per-owner leases in `lib/bulklock.ts` now grant concurrent leases and release only their own, so the App.svelte comment calls the ordering "merely tidier than nesting". The rule stands anyway: the AI run owns its own lease.[^popup-app][^bulklock] See [bulk lock](/architecture/bulk-lock.md).

# History

| Date | Change |
|------|--------|
| 2026-06-02 | First AI features, gated on a `useAI` setting: rule suggestions,[^commit-ai-rules] then classify-ungrouped, per-rule Tune and name suggestion.[^commit-ai-more] These were rule-management features, not `/aigroup` |
| 2026-06-07 | All Gemini Nano features removed "to eliminate lag"[^commit-ai-removed] |
| 2026-07-24 | Returned as `/aigroup` plus an AI sidebar tab, running in the service worker with progress in session storage[^commit-apis] |
| 2026-08-02 | Progress lease, try/finally lock release, `aigroup-start` always answered[^commit-lease] |

# Gotchas

- `suggestGroups` returns `[]` when the prompt throws or its output is unparseable, and the run then ends `done` with "AI found no groups to suggest". Only a failure in `createSession()` surfaces as `error`.[^ai][^bg-index]
- Every ungrouped tab in every window goes into one prompt; there is no chunking.[^ai] The run writes nothing to the automation action log.[^bg-index]
- Undo has to move tabs back across windows. Group snapshots record window and index for exactly this reason.[^undo-test][^changelog]
- Dead code: `suggestTabSummary` has no caller, the popup imports `checkAIAvailability` without calling it, and `rulesConfig.useAI` is a leftover from June.[^ai][^popup-app]

# Tests that guard it

- `lib/ai.test.ts`: `parseSuggestionJson` (fences, prose, wrapped object, single group, nested array, unusable output, prototype pollution).[^ai-test]
- `lib/bulklock.test.ts`: "a short holder acquiring FIRST cannot cut a long holder short", "a concurrent release cannot drop another owner's fresh lease".[^bulklock-test]
- `lib/undo.test.ts`: "moves tabs back to their snapshotted window before regrouping".[^undo-test]
- `runAIGroup` itself has no test; nothing imports the background entrypoint.

# Related

[Background automation](/features/background-automation.md) · [Bulk lock](/architecture/bulk-lock.md) · [Undo stack](/architecture/undo-stack.md) · [TabOrdo](/tabordo.md)

[^ai]: lib/ai.ts
[^ai-test]: lib/ai.test.ts
[^bg-index]: entrypoints/background/index.ts
[^popup-app]: entrypoints/popup/App.svelte
[^bulklock]: lib/bulklock.ts
[^bulklock-test]: lib/bulklock.test.ts
[^undo-test]: lib/undo.test.ts
[^privacy]: PRIVACY.md
[^changelog]: CHANGELOG.md
[^commit-ai-rules]: commit 619d7b5
[^commit-ai-more]: commit 762b2c9
[^commit-ai-removed]: commit 580806c
[^commit-apis]: commit c1eeece
[^commit-lease]: commit 3431468
