---
type: Decision
title: Minimum Chrome 138
description: Since 0.8.0 the manifest declares minimum_chrome_version 138, the first stable Chrome with the global LanguageModel for extensions, so every feature test and fallback for older Chrome was deleted, at the cost of users on older Chrome no longer receiving updates.
tags: [manifest, compatibility, chrome-version, decision]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T23:00:00Z }
sources:
  - id: wxt-config
    resource: https://github.com/samhvw8/TabOrdo/blob/main/wxt.config.ts
    title: wxt.config.ts (minimum_chrome_version)
    last_modified: 2026-09-22
  - id: commit-min
    resource: https://github.com/samhvw8/TabOrdo/commit/3c9ac8f
    title: "build: minify production, ship tldts-icann, require Chrome 138"
    last_modified: 2026-09-22
  - id: commit-lib-guards
    resource: https://github.com/samhvw8/TabOrdo/commit/5a11244
    title: Drop the getKeys, readingList and sessions feature checks
    last_modified: 2026-09-22
  - id: commit-bg-guards
    resource: https://github.com/samhvw8/TabOrdo/commit/de4c5c3
    title: Drop the sidePanel, contextMenus and storage.session guards
    last_modified: 2026-09-22
  - id: commit-ai
    resource: https://github.com/samhvw8/TabOrdo/commit/462faa8
    title: "fix(ai): give Gemini Nano its instructions and a response schema"
    last_modified: 2026-09-22
  - id: prompt-api-docs
    resource: https://developer.chrome.com/docs/ai/prompt-api
    title: Prompt API (Chrome for Developers)
    author: team:chrome
---

# Overview

**Decision (2026-09-22, shipped in 0.8.0):** the manifest declares `minimum_chrome_version: "138"`.[^wxt-config][^commit-min]

**Why 138:** it is the first stable release where extensions get the global `LanguageModel` that `/aigroup` uses ([AI grouping](/features/ai-grouping.md)).[^prompt-api-docs] Everything else TabOrdo feature-tested is older and comes with it:

| API | Since | What its check used to guard |
|-----|-------|-----------------------------|
| `chrome.storage.session.getKeys` | 130 | The undo stack and bulk lock listed keys with a fallback that read every value[^commit-lib-guards] |
| `chrome.readingList` | 120 | `/readlater`, `/rl`, the "Save to Reading List" menu entry[^commit-lib-guards] |
| `chrome.sidePanel.open` | 116 | `/sidepanel`, the Side Panel tile, the menu entry[^commit-bg-guards] |
| `chrome.sessions`, `chrome.contextMenus`, `chrome.storage.session` | older | `/restore`, `/rc`, the icon menu, optional chaining in the lineage map[^commit-bg-guards] |
| `window.ai.languageModel` | pre-138 shape | A second code path in `lib/ai.ts`[^commit-ai] |

**What it removed:** those checks, their "requires Chrome 1xx" messages, and the tests that built the extension without each API.[^commit-lib-guards][^commit-bg-guards][^commit-ai]

**What it costs:** Chrome stops offering updates to anyone on a release older than 138 (June 2025). Stable Chrome updates itself, so this mainly reaches managed installs pinned to an old version.

# Consequences

- Code can call these APIs directly. A new feature test for any of them is dead code.
- The Chrome stub still lacks some of these APIs (`sessions`, `readingList`, `sidePanel`), so tests assign them onto `globalThis.chrome` where needed ([Chrome stub](/testing/chrome-stub.md)).

# Revisit if

A feature needs an API newer than 138: raise the floor in `wxt.config.ts` in the same change, and note it here, rather than adding a feature test.

# Related

[TabOrdo](/tabordo.md) · [AI grouping](/features/ai-grouping.md) · [No host permissions](/decisions/no-host-permissions.md) · [Release](/processes/release.md)

[^wxt-config]: wxt.config.ts
[^commit-min]: commit 3c9ac8f
[^commit-lib-guards]: commit 5a11244
[^commit-bg-guards]: commit de4c5c3
[^commit-ai]: commit 462faa8
[^prompt-api-docs]: Prompt API docs
