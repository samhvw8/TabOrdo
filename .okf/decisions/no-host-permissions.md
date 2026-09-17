---
type: Decision
title: No host permissions
description: TabOrdo declares no host_permissions, relying on activeTab plus scripting for its only page injections (/vol and the lock title badge), so Chrome Web Store review stays fast at the cost of reaching only the tab the user just acted on.
tags: [permissions, chrome-web-store, scripting, privacy, decision]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T00:16:05Z }
sources:
  - id: commit-remove
    resource: https://github.com/samhvw8/TabOrdo/commit/2b2e6023588e670fa13009627def3a9958832665
    title: Remove host_permissions to avoid delayed CWS review
    last_modified: 2026-05-25
  - id: wxt-config
    resource: https://github.com/samhvw8/TabOrdo/blob/main/wxt.config.ts
    title: wxt.config.ts (manifest)
    last_modified: 2026-07-27
  - id: media
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/media.ts
    title: lib/tabs/media.ts
    last_modified: 2026-07-29
  - id: actions
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: lib/actions.ts (/vol handler)
    last_modified: 2026-09-17
  - id: actions-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.test.ts
    title: lib/actions.test.ts (/vol)
    last_modified: 2026-08-21
  - id: tab-card
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/TabCard.svelte
    title: components/TabCard.svelte (volume slider)
    last_modified: 2026-08-02
  - id: lock
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/lock.ts
    title: lib/tabs/lock.ts (setTitleBadge)
    last_modified: 2026-08-03
  - id: commit-badge
    resource: https://github.com/samhvw8/TabOrdo/commit/022501311e7dd1f00aa22e98ea4c7d43f85e929f
    title: Add pin title badge and shift-click to reopen closed pins
    last_modified: 2026-06-16
  - id: chrome-stub
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/testing/chrome-stub.ts
    title: lib/testing/chrome-stub.ts
    last_modified: 2026-09-17
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md (0.2.0)
    last_modified: 2026-09-17
---

# Overview

**Decision (2026-05-25):** remove `host_permissions: ["<all_urls>"]` from the manifest.[^commit-remove]

**Why:** `<all_urls>` triggered an in-depth, and therefore slow, Chrome Web Store review. Only `/vol` needed script access to arbitrary tabs.[^commit-remove][^changelog]

**Instead:** `/vol` was limited to the active tab through the `activeTab` permission.[^commit-remove] The manifest keeps `scripting` and `activeTab` and has no `host_permissions` key.[^wxt-config]

# What relies on activeTab + scripting

| Feature | Call | Failure handling |
|---------|------|------------------|
| `/vol N` and the volume slider | `setTabVolume` → `chrome.scripting.executeScript` sets `volume` on every `audio`/`video` element | Returns `false`; logs the error[^media] |
| Lock 📌 title badge | `setTitleBadge` → `executeScript` of a title prefix plus `MutationObserver` | Logs a warning, never throws[^lock] |

The title badge was built on the same model on purpose: "activeTab + scripting, no new perms".[^commit-badge] Everything else, including tabs, groups, bookmarks, history, sessions, Reading List and favicons, uses its own API permission and needs no host access.[^wxt-config]

# Consequences confirmed in code

- **`/vol N <search>` reports partial success.** It counts the tabs where injection succeeded and says `Volume N% on ok/total tab(s) — the rest need page access (only the active tab is reachable)` rather than claiming tabs it never touched.[^actions] A test covers "reports partial success when some tabs are not scriptable".[^actions-test]
- **`/vol N` on an unscriptable active page** reports "Can't control volume on this page".[^actions][^actions-test]
- **The dashboard tab card's volume slider ignores the result** of `setTabVolume`, so on a tab that cannot be scripted it does nothing and says nothing.[^tab-card]
- **A missing badge is silent.** `setTitleBadge` swallows injection errors, so a lock whose badge could not be (re)applied still holds its position without the 📌.[^lock]
- **The test stub models this.** `failScriptingIds` lists the tabs for which `scripting.executeScript` rejects; its comment ties this to the real extension having no host permissions.[^chrome-stub]

# Revisit if

A feature needs to read or change page contents in tabs the user has not just invoked TabOrdo on. Re-adding host permissions brings back the in-depth review this decision avoided.[^commit-remove]

# Related

[TabOrdo](/tabordo.md) · [Position locks](/features/position-locks.md) · [Chrome stub](/testing/chrome-stub.md) · [Release](/processes/release.md)

[^commit-remove]: commit 2b2e602
[^wxt-config]: wxt.config.ts
[^media]: lib/tabs/media.ts
[^actions]: lib/actions.ts
[^actions-test]: lib/actions.test.ts
[^tab-card]: components/TabCard.svelte
[^lock]: lib/tabs/lock.ts
[^commit-badge]: commit 0225013
[^chrome-stub]: lib/testing/chrome-stub.ts
[^changelog]: CHANGELOG.md
