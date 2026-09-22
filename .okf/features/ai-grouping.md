---
type: Feature
title: AI grouping (/aigroup)
description: On-device Gemini Nano topic grouping run by the background service worker; covers the availability check, the prompt contract (system message plus response schema), the context-window cap, the progress record that doubles as the run's mutex, the renewed bulk-lock lease, why the popup starts it outside its own lock, and the feature's removal and return.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/ai.ts
tags: [ai, gemini-nano, prompt-api, background, bulk-lock, progress]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T14:00:00Z }
sources:
  - id: ai
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/ai.ts
    title: lib/ai.ts
    last_modified: 2026-09-22
  - id: ai-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/ai.test.ts
    title: lib/ai.test.ts
    last_modified: 2026-09-22
  - id: aigroup
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/aigroup.ts
    title: lib/aigroup.ts (runAIGroup, run by the service worker)
    last_modified: 2026-09-22
  - id: aigroup-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/aigroup.test.ts
    title: lib/aigroup.test.ts
    last_modified: 2026-09-22
  - id: prompt-api-docs
    resource: https://developer.chrome.com/docs/ai/prompt-api
    title: The Prompt API (Chrome for Developers)
    last_modified: 2026-08-26
  - id: prompt-api-explainer
    resource: https://github.com/webmachinelearning/prompt-api/blob/main/README.md
    title: Prompt API explainer ("Renamed Features", structured output, context window)
  - id: chromium-create-options
    resource: https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/ai/language_model_create_options.idl
    title: Chromium LanguageModelCreateOptions IDL
  - id: chromium-language-model
    resource: https://github.com/chromium/chromium/blob/main/chrome/browser/ai/ai_language_model.cc
    title: Chromium ai_language_model.cc (context window and output buffer)
  - id: chromium-ai-manager
    resource: https://github.com/chromium/chromium/blob/main/chrome/browser/ai/ai_manager.cc
    title: Chromium ai_manager.cc (output-language warning)
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
2. **`runAIGroup()` in the worker** (`lib/aigroup.ts`, called from the worker's `runtime.onMessage`). It refuses when the progress status is `checking`, `prompting` or `grouping`.[^aigroup]
3. It takes its own bulk-lock lease (`AI_LEASE_MS` = 10 min) **before** anything that can reject, and renews it every 60 s while the run lives. The lease used to be taken after the availability check and tab query, whose rejections skipped the release and left the whole profile suppressed for ten minutes. A single fixed lease used to lapse during a first-use model download.[^aigroup][^bulklock]
4. `checking` → `checkAIAvailability()`.
5. It collects tabs that are ungrouped, not Chrome-pinned, and not `chrome://`, across **all windows**. It needs at least 2.
6. `prompting` → `suggestGroups()`: one session, one prompt listing as many tabs as fit the context window as `i. title | url`. See [prompt contract](#prompt-contract).[^ai]
7. `grouping`: for each suggestion, strays are moved into the window holding most of the group's tabs (`chrome.tabs.group` rejects cross-window ids). The tabs are marked as self-writes, grouped, and titled with `safeGroupUpdate`.[^aigroup]
8. `done` or `error`. The `done` message says how many tabs were left out when not all of them fit. Any failure inside `suggestGroups` ends in `error` with its message. In `finally` it clears the renew timer, **awaits any in-flight renewal**, and then releases the lease. Otherwise a late renewal could write a full lease back after the release.[^aigroup]

# Availability check

`getAPI()` reads the global `LanguageModel`. That is the only shape on Chrome 138, the extension's minimum version, and later.[^ai][^prompt-api-docs] `availability()` is asked about the same text-in, text-out, English session that `create()` makes (`expectedInputs`/`expectedOutputs`). The languages only set up the session and silence Chrome's missing-output-language warning; non-English tab titles still reach the model.[^ai][^prompt-api-explainer][^chromium-ai-manager]

| Result | Reason shown |
|--------|--------------|
| No API | Enable `chrome://flags` → `#prompt-api-for-gemini-nano`, restart |
| `downloadable` | Run `LanguageModel.create()` in DevTools and wait about 2 minutes |
| `downloading` | The model is still downloading; try again in a few minutes |
| Anything else / throw | Status or error text plus a flags hint |

# Prompt contract

- **Instructions go in `initialPrompts`** as `{ role: "system", content }`. Chrome's `LanguageModelCreateOptions` has no `systemPrompt` member, and WebIDL drops unknown members silently. Until 2026-09-22 the extension passed `systemPrompt`, so the model only ever saw the tab list and was never told to answer as JSON groups.[^ai][^chromium-create-options]
- **The answer is constrained** by `prompt(text, { responseConstraint })` with a JSON schema for `[{ group: string, indices: integer[] }]`.[^ai][^prompt-api-docs] Chrome sends the schema to the model as part of the input unless `omitResponseConstraintInput` is set, so it is counted when measuring.[^prompt-api-explainer]
- **Parsing is a plain `JSON.parse` plus a shape check.** An answer that is not an array throws "The on-device AI gave an answer TabOrdo couldn't read". Entries without a string `group` and an array `indices` are skipped. Indices that name no tab are dropped, groups left empty are dropped, and colours then cycle through 8 names in order.[^ai]

# Context-window cap

`suggestGroups` lists tabs from the front of the list until the prompt, measured with `measureContextUsage` (schema included), fills what is left of `contextWindow` after the system message (`contextUsage`). It returns `{ suggestions, omitted }`, and `runAIGroup` appends "N tab(s) didn't fit the on-device model and were left as they are" to its result.[^ai][^aigroup]

- The explainer renamed `inputQuota`/`inputUsage`/`measureInputUsage` to `contextWindow`/`contextUsage`/`measureContextUsage`. Extensions keep the old names as deprecated aliases, and older Chrome only has the old names, so the code reads the new name first and falls back to the old one.[^ai][^prompt-api-explainer]
- The prompt may use the whole reported window. Chromium already holds back 1024 tokens (by default) of the model's limit for the answer, and a prompt past the window rejects instead of answering.[^chromium-language-model]
- Titles and URLs are clipped to 150 characters so one huge value (a `data:` URL, a tracking-laden link) cannot crowd out the rest of the list.[^ai]
- If fewer than two tabs fit, the run fails with a context-window error rather than prompting.[^ai]

# Progress state and its lease

`AIGroupProgress { status, total, processed, currentTab, grouped, groupCount, error }` lives in `chrome.storage.session` under `tabOrdo_aiGroupProgress`. `setAIProgress` adds `startedAt` to every record it writes.[^ai]

- **The progress status is the mutex** that decides whether a run can start. Only the background writes it. The popup and side panel read it on mount and follow `storage.onChanged`. When the popup wrote to it (dismissing a panel, a stale side panel, a poller stamping "checking"), two runs could start at once, or a run was refused or reset mid-run.[^popup-app][^changelog]
- **The in-flight record expires.** `getAIProgress` treats an in-flight record whose `startedAt` is older than `AI_LEASE_MS` as idle. The prompt is the one stretch that makes no `chrome.*` calls, so MV3 can kill the worker mid-prompt and leave a record nobody will clear. Before this fix that blocked `/aigroup` until the browser restarted.[^ai][^commit-lease] Chrome clears session storage on every extension update, so every record in it was written by the current code and carries `startedAt`.

# Why it runs outside the popup's bulk lock

Every popup path (the typed command, the dashboard/overflow action, the panel's buttons) calls `startAIGroup()` directly, never inside `withBulkLock`. The typed command is handled before the lock is taken.[^popup-app] The history: under the old single-owner lock, the background's acquire lost to the popup's still-held UI lease, and the popup's release then cleared the lock entirely, so the whole AI run went unsuppressed.[^changelog] The per-owner leases in `lib/bulklock.ts` now grant concurrent leases and release only their own, so the App.svelte comment calls the ordering "merely tidier than nesting". The rule stands anyway: the AI run owns its own lease.[^popup-app][^bulklock] See [bulk lock](/architecture/bulk-lock.md).

# History

| Date | Change |
|------|--------|
| 2026-06-02 | First AI features, gated on a `useAI` setting: rule suggestions,[^commit-ai-rules] then classify-ungrouped, per-rule Tune and name suggestion.[^commit-ai-more] These were rule-management features, not `/aigroup` |
| 2026-06-07 | All Gemini Nano features removed "to eliminate lag"[^commit-ai-removed] |
| 2026-07-24 | Returned as `/aigroup` plus an AI sidebar tab, running in the service worker with progress in session storage[^commit-apis] |
| 2026-08-02 | Progress lease, try/finally lock release, `aigroup-start` always answered[^commit-lease] |
| 2026-09-22 | Instructions moved to `initialPrompts`, answer constrained by a JSON schema, tab list capped to the context window. The fence/prose/wrapper-tolerant parser, the `window.ai.languageModel` branch and `suggestTabSummary` were deleted[^ai] |

# Gotchas

- An `[]` answer ends `done` with "AI found no groups to suggest". A failed prompt, an unreadable answer or a context too small for two tabs ends `error` with the reason.[^ai][^aigroup]
- There is no chunking. Tabs past the context window are left out of the run and counted in the result message.[^ai][^aigroup] The run writes nothing to the automation action log.[^aigroup]
- A tab the model puts in two groups ends up in the last one, and `grouped` counts it twice. The parser does not de-duplicate indices.[^ai][^aigroup]
- Undo has to move tabs back across windows. Group snapshots record window and index for exactly this reason.[^undo-test][^changelog]
- Dead code: the popup imports `checkAIAvailability` without calling it, and `rulesConfig.useAI` is a leftover from June.[^popup-app]

# Tests that guard it

- `lib/ai.test.ts`, against a stubbed global `LanguageModel`: `create()` gets a system message in `initialPrompts` and no `systemPrompt`, `prompt()` gets a `responseConstraint` schema, indices map back to tab ids, a non-array answer and a failed prompt reject (and the session is still destroyed), the tab list is capped to the window left after the system message, the `input*` fallback names, the two-tab floor, clipping of long fields, and `availability()` asked about the same session options. It also covers the missing-API and `downloading` reasons.[^ai-test]
- `lib/bulklock.test.ts`: "a short holder acquiring FIRST cannot cut a long holder short", "a concurrent release cannot drop another owner's fresh lease".[^bulklock-test]
- `lib/undo.test.ts`: "moves tabs back to their snapshotted window before regrouping".[^undo-test]
- `lib/aigroup.test.ts` runs `runAIGroup` against the stub with a stubbed model: a suggestion spanning two windows is grouped in the window holding most of it, titled and coloured, with its tabs marked as self-writes; the lease is released at the end; a run in flight refuses a second; fewer than two loose tabs is an error.[^aigroup-test]

# Related

[Background automation](/features/background-automation.md) · [Bulk lock](/architecture/bulk-lock.md) · [Undo stack](/architecture/undo-stack.md) · [TabOrdo](/tabordo.md)

[^ai]: lib/ai.ts
[^ai-test]: lib/ai.test.ts
[^aigroup]: lib/aigroup.ts
[^aigroup-test]: lib/aigroup.test.ts
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
[^prompt-api-docs]: The Prompt API (Chrome for Developers)
[^prompt-api-explainer]: Prompt API explainer
[^chromium-create-options]: Chromium LanguageModelCreateOptions IDL
[^chromium-language-model]: Chromium ai_language_model.cc
[^chromium-ai-manager]: Chromium ai_manager.cc
