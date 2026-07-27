# Tab Manager Gaps — Synthesis

Research date: 2026-07-12 · Mode: low (EN + ZH, 1 wave each + GitHub issue scan)

## Recommendation

Build the **data-safety pack** first (export/auto-backup), then **named sessions with
group-faithful restore** (the differentiator), then **MV3 tab suspension** (open
category vacuum). All three are cross-language validated demands.

## Converging Findings (EN + ZH agree — high confidence)

| Rank | Demand | Evidence |
|------|--------|----------|
| 1 | Never-lose-data: versioned backups, timestamped export | OneTab chronic data loss (EN + ZH GEMs; GH: better-onetab "Lost almost all tabs") |
| 2 | Persistent named sessions that restore tab GROUPS faithfully | Chrome groups don't persist; Workona/Tab-Session-Manager "tabs saved but groups gone" |
| 3 | Cross-device sync, local-first/free (WebDAV/Gist), no paywall | Workona 5-workspace cap resentment; NiceTab differentiates via WebDAV/Gists |
| 4 | MV3-native tab suspension | Great Suspender sold→malware→removed; category orphaned in both communities |
| 5 | Workspaces / nested hierarchy | Workona "体验最好"; HN "folders in folders" demand |
| 6 | Switch-to-existing-tab instead of duplicate | EN GEM; extends TabOrdo dedupe |

## Language-Specific

| Finding | Source |
|---------|--------|
| Pinyin search in command palette | ZH only — cheap win on existing uFuzzy search |
| Session/page STATE restore (scroll, login) | EN only — hard, likely out of scope |
| Dedupe should KEEP intentional duplicates | ZH nuance for existing dedupe feature |

## Trust Positioning

MV3 fallout + Great Suspender malware raised the trust bar: open-source, local-first,
no telemetry is now a marketable feature, not a default. State it explicitly.

## TabOrdo Fit (local code state)

| Gap | Current state |
|-----|---------------|
| Sessions | `lib/workspace.ts` = single-slot focus mode, drops group structure |
| Backup | All data in `chrome.storage.local`, no export-all, no auto-backup |
| Sync | `chrome.storage.sync` unused |
| Suspension | `chrome.tabs.discard` unused; ignore-list infra reusable for auto-suspend |
| Tests | 1 test file vs ~139 functions; bulk-op race-condition history |

## Caveats

- ZH sync/suspend demand inferred from competitor migration, not direct feedback
- Tab Manager Plus / Sidebery complaint data thin; Reddit upvote counts unavailable
- linux.do had no relevant threads

## Related

- [en-user-complaints.md](en-user-complaints.md) — EN raw findings with URLs
- [zh-user-complaints.md](zh-user-complaints.md) — ZH raw findings with URLs
