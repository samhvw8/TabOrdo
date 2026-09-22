---
type: Module
title: Bulk lock
description: lib/bulklock.ts suppresses the background auto-group, auto-sort, auto-ungroup and switch-to-existing listeners while a bulk operation runs, using one expiring lease per owner in chrome.storage.session.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bulklock.ts
tags: [concurrency, storage, automation, realms]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T12:00:00Z }
sources:
  - id: bulklock-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bulklock.ts
    title: lib/bulklock.ts
    last_modified: 2026-08-15
  - id: bulklock-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/bulklock.test.ts
    title: lib/bulklock.test.ts
    last_modified: 2026-08-15
  - id: background
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: Background service worker
    last_modified: 2026-09-17
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: Popup and side panel component
    last_modified: 2026-09-17
  - id: ai-ts
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/ai.ts
    title: lib/ai.ts
    last_modified: 2026-08-02
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md
    last_modified: 2026-09-17
  - id: commit-249ede8
    resource: https://github.com/samhvw8/TabOrdo/commit/249ede8aaae1368f784ed2c2a957b5ac3681aae8
    title: Clear stuck bulkOpInProgress flag on popup mount
    last_modified: 2026-05-23
  - id: commit-c2acffd
    resource: https://github.com/samhvw8/TabOrdo/commit/c2acffde2323752b936066cb309259c825261390
    title: "feat: user-journey pass (introduces lib/bulklock.ts, single owner lease)"
    last_modified: 2026-07-27
  - id: commit-7e3e91a
    resource: https://github.com/samhvw8/TabOrdo/commit/7e3e91acea53a8c29ffe62bb2ed40367d17bab09
    title: "refactor: split lib/tabs (carries the shared-map lease rewrite)"
    last_modified: 2026-07-29
  - id: commit-3431468
    resource: https://github.com/samhvw8/TabOrdo/commit/34314682268915f701ab683590a45f2f4a7c20c6
    title: "fix: AI-progress lease, listener crash guards, stricter chrome stub"
    last_modified: 2026-08-02
  - id: commit-228e0e4
    resource: https://github.com/samhvw8/TabOrdo/commit/228e0e4b6d8c0f28fd5bfe0f2e7f548fedc3b40e
    title: "feat: enhance pin management (carries the per-owner-key lease rewrite)"
    last_modified: 2026-08-03
  - id: commit-f561ea2
    resource: https://github.com/samhvw8/TabOrdo/commit/f561ea24856e6f6713bb6b1f0cf52f46f87f496f
    title: "perf: read only the lock keys from session storage"
    last_modified: 2026-08-15
---

# Overview

While TabOrdo rearranges tabs in bulk, the background automations would otherwise react to its own mutations. The bulk lock is how they know to stand down.[^bulklock-ts] It is a set of **leases**: each owner writes its expiry timestamp under its own session key, `bulkOpLock:<owner>`. The profile counts as locked while any lease's expiry is in the future.[^bulklock-ts] Suppression is global, across every window.

# API

| Function | Behaviour |
|---|---|
| `newLockOwner()` | `crypto.randomUUID()`, with a timestamp+random fallback.[^bulklock-ts] |
| `acquireBulkLock(owner, ttlMs)` | Writes `max(existing, now + ttlMs)` to the owner's key. **Always succeeds** and never shortens this owner's lease. Touches no other key.[^bulklock-ts] |
| `releaseBulkLock(owner)` | Decays the owner's lease to `min(existing, now + ECHO_GRACE_MS)` instead of deleting it. A no-op for an owner with no lease.[^bulklock-ts] |
| `isBulkLocked()` | Reads only the lock keys and returns true if any lease is live. Opportunistically removes keys that expired more than `SWEEP_SLACK_MS` ago. Earlier lease shapes are not read: Chrome clears the session area on an extension update or reload, so no lease outlives the version that wrote it.[^bulklock-ts] |
| `withBulkLock(fn, ttlMs = UI_LEASE_MS)` | Fresh owner, acquire, `await fn()`, release in `finally`, which drops only this call's lease.[^bulklock-ts] |

# Lease timings

| Constant | Value | Purpose |
|---|---|---|
| `UI_LEASE_MS` | 60 s | Default for popup and context-menu work, which is sub-second in practice.[^bulklock-ts] |
| `AI_LEASE_MS` | 10 min | `runAIGroup`'s lease, renewed every `AI_LEASE_RENEW_MS` (60 s) while the run is live. It only bounds suppression if the worker dies.[^bulklock-ts][^background] Also ages out a stuck in-flight AI progress record.[^ai-ts] |
| `ECHO_GRACE_MS` | 1 s | Suppression lingers past release. Chrome delivers `onUpdated` echoes *after* the call that caused them resolves, and `scheduleAutoUngroup` debounces 150 ms before checking.[^bulklock-ts][^bulklock-test] |
| `SWEEP_SLACK_MS` | 60 s | A key is swept only when it is this stale, so a sweep can never race a live renewal.[^bulklock-ts] |

# Who holds it

- **Popup / side panel:** `handleActionCommand`, `dashAction` (and therefore `dashCommand`) and `handleUndo` wrap their work in `withBulkLock`, each behind the `busy` flag.[^popup-app]
- **Background context menus:** group by domain, dedup and sort use `withBulkLock`.[^background]
- **`runAIGroup`:** acquires before the availability check and tab query, renews on an interval, and on exit clears the timer and awaits any in-flight renewal before releasing. Otherwise a late renewal could write the full lease back after the release.[^background][^commit-3431468]
- **Not locked:** `startAIGroup` in the popup deliberately hands off *before* any lock. `handleClose` (Ctrl+Delete on a result) uses only `busy`.[^popup-app]

# Who checks it, and why they must

| Background listener | Check |
|---|---|
| `autoUngroupSingleTabGroups`, reached via `scheduleAutoUngroup` from `tabs.onRemoved`, `tabs.onUpdated` (groupId), `tabs.onDetached`, the auto-group path and the autoUngroup toggle | Returns early when locked[^background] |
| Auto-group on URL change | Skipped when locked[^background] |
| Auto-sort on `status: "complete"` | Skipped when locked[^background] |
| Switch-to-existing bounce | Returns early when locked[^background] |

Each of these fires on the tab events a bulk operation generates. Unchecked, they react to the very mutations the operation is making; during `/aigroup` that meant auto-group, auto-sort and auto-ungroup fighting the AI run. Background-originated single-tab writes are additionally marked in the `selfWrites` ledger (1 s TTL). Pin follow uses its own `pinSelfWrites` ledger and does not consult the lock.[^background]

# History: bugs it fixed

1. A bare `bulkOpInProgress` boolean had no owner. Any popup action finishing, or a popup mount that reset a stuck flag, released the lock the background held for an AI run.[^commit-249ede8][^bulklock-ts][^changelog]
2. **Single owner + expiry** (`c2acffd`) fixed that, with two flaws of its own, fixed by the next step. A losing acquire wrote nothing, so when the incumbent finished first the loser ran unsuppressed. Release on completion also missed the trailing echoes.[^commit-c2acffd][^bulklock-ts]
3. **Shared map of leases + decaying release** (`7e3e91a`) fixed both. The same change moved a typed `/aigroup` out of the popup's lock. It had started inside it, so the background's acquire lost to the popup's still-held lease, the popup's release then cleared the lock, and the whole run went unprotected. Context-menu bulk actions also gained the lock in that change.[^commit-7e3e91a][^changelog]
4. **Per-owner keys** (`228e0e4`). Acquire and release each rewrote the whole map, so a release whose read predated a concurrent acquire dropped the AI run's ten-minute lease at the popup-to-background hand-off. The same change made the AI run renew its lease.[^commit-228e0e4][^bulklock-ts]
5. **Key-only reads** (`f561ea2`). `isBulkLocked` runs per tab update. `storage.session.get(null)` structured-cloned the whole area, undo stack and lineage map included. It now lists names with `getKeys` and reads only the lock keys. The fallback to the full read for Chrome before 130 went when the minimum became Chrome 138.[^commit-f561ea2][^bulklock-test]

# Gotchas

- The popup no longer resets the lock on mount. Lease expiry handles a popup that died mid-operation.[^popup-app]
- Storage errors fail open: a failed read reports unlocked, and a failed acquire or release is swallowed.[^bulklock-ts]
- `withBulkLock` releases only in `finally`. A wrapped operation that never settles holds suppression for the full lease. See the beforeunload gap in [tab closing](/architecture/tab-closing.md).
- Never add a refcount or a shared-map write. `chrome.storage.session` has no compare-and-swap.[^bulklock-ts]

# Tests that guard it

`lib/bulklock.test.ts` uses fake timers for the grace window, a short holder acquiring first, a release from a non-holder, expiry, never shortening a lease, release on throw, a nested quick op, a concurrent release against a fresh acquire, and sweep slack. It also checks, through the stub's `storageReads`, that only lock keys are deserialised.[^bulklock-test]

# Related

- [Background automation](/features/background-automation.md)
- [AI grouping](/features/ai-grouping.md)
- [Architecture overview](/architecture/overview.md)
- [Chrome stub](/testing/chrome-stub.md)

[^bulklock-ts]: lib/bulklock.ts
[^bulklock-test]: lib/bulklock.test.ts
[^background]: entrypoints/background/index.ts
[^popup-app]: entrypoints/popup/App.svelte
[^ai-ts]: lib/ai.ts
[^changelog]: CHANGELOG.md
[^commit-249ede8]: Commit 249ede8
[^commit-c2acffd]: Commit c2acffd
[^commit-7e3e91a]: Commit 7e3e91a
[^commit-3431468]: Commit 3431468
[^commit-228e0e4]: Commit 228e0e4
[^commit-f561ea2]: Commit f561ea2
