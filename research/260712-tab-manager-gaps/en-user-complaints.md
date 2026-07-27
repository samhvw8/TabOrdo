# Tab-Manager User Complaints & Feature Gaps (EN)

Scope: what tab-manager users request/complain about; OneTab, Workona, Toby, Tab Manager Plus, Sidebery, The Great Suspender. LOW-mode gather (EN only). Tags: GEM / MEH / NOISE.

## Top Requested Features (ranked, with evidence)

1. **Session/page STATE restore — not just URLs** [GEM]. HN "Overcoming Tab Overload" (182 pts, 233 comments) top comment: users want to serialize scroll position, login/session, video position, expanded/collapsed threads — "a HUGE roadblock to closing tabs is losing state." Firefox session-restore praised for *lazy* restore (waits until you switch to tab). [HN 27157225](https://news.ycombinator.com/item?id=27157225)
2. **Reliable cross-device sync of in-progress work** [GEM]. "My biggest, always ongoing problem, is to sync what I'm doing/researching in the browser." [HN 41487350](https://news.ycombinator.com/item?id=41487350). Also [r/browsers](https://www.reddit.com/r/browsers/comments/sup0x7/) wants Workona-like sync across 2 computers but "$4/yr, $5/mo… too expensive."
3. **Hierarchical / nested grouping (groups within groups, workspaces)** [GEM]. Core Workona draw; repeatedly requested. "I need hierarchical grouping of tabs… groups within groups. Windows mastered file structures decades ago, why can't Chrome?" [r/chrome 19e9xur](https://www.reddit.com/r/chrome/comments/19e9xur/best_alternative_to_workona/)
4. **Tab suspension / memory saving that WORKS under MV3** [GEM]. Great Suspender + Marvellous Suspender (TMS) both dead/broken post-Manifest V3. [r/chrome](https://www.reddit.com/r/chrome/comments/1jcr994/tab_suspender_alternatives/): "with the transition to Manifest V3, even TMS started running into issues."
5. **"Jump to existing tab" instead of opening a duplicate** [GEM]. "When I type gmail in a new tab it should take me to the existing pinned tab, not open a new one." [r/chrome 19e9xur](https://www.reddit.com/r/chrome/comments/19e9xur/best_alternative_to_workona/)
6. **Plain-text / exportable, user-owned data** [MEH]. BrainTool praised for "writes all your data in plain text to a file on your Google [Drive]." [r/chrome pszje2](https://www.reddit.com/r/chrome/comments/pszje2/alternatives_to_workona_tab_manager/)
7. **Free + open-source + offline** [MEH]. Recurring ask across every Workona-alternative thread.

## Top Complaints Per Competitor

- **OneTab** [GEM]: Chronic DATA LOSS — "OneTab lost all my tabs" is a recurring genre. No built-in restore; users recover by manually digging leveldb / `Local Extension Settings` files or restoring OS backups. Loss recurs on Chrome update/crash and on the "new update." [r/chrome recovery guide](https://www.reddit.com/r/chrome/comments/dv91t5/onetab_lost_tab_recovery_guide/), [lost all again](https://www.reddit.com/r/chrome/comments/1fo3x16/onetab_lost_all_tabs_again/), [after new update](https://www.reddit.com/r/chrome/comments/1rctjx8/), [Partizion writeup](https://www.partizion.io/blog/onetab-lost-all-tabs) ("users constantly lose all their saved tabs, and don't have any means to restore them"). No sync across devices.
- **Workona** [GEM]: (a) Free-plan cap = only **5 workspaces**, "not enough" — introduced "unfair limitations on the free plan," drove exodus. [r/browsers yge87s](https://www.reddit.com/r/browsers/comments/yge87s/), [r/chrome pszje2](https://www.reddit.com/r/chrome/comments/pszje2/). (b) **$9/mo too expensive** ([r/ArcBrowser](https://www.reddit.com/r/ArcBrowser/comments/1gs09to/)). (c) **Tab-GROUP save/restore is buggy** — "tabs saved but the groups are all gone or partially gone… saving/restoring tab groups is problematic" ([r/Workona](https://www.reddit.com/r/Workona/)); "in recent updates I have lost all my tabs multiple times" ([r/chrome ehnf7l](https://www.reddit.com/r/chrome/comments/ehnf7l/alternatives_to_workona/)).
- **Toby** [GEM]: **Abandoned / stalled development** — "they stopped development and there are too many bugs" ([r/chrome c74npp](https://www.reddit.com/r/chrome/comments/c74npp/)), "developers have dropped it… feels incomplete" ([bxmimb](https://www.reddit.com/r/chrome/comments/bxmimb/)). "Slow & outdated" but loved for simple BOX layout. **Won't stay logged in** / login required ([Toby feedback](https://toby.nolt.io/753)). Import cleanup pain (sample collections).
- **Tab Manager Plus** [MEH]: Appears in comparison roundups as a search/window-manager; no strong pain thread surfaced in low-mode pass. (Gap: needs deeper look.)
- **Sidebery (Firefox)** [MEH]: Loved for vertical tree tabs/containers; Firefox-only. No issue-tracker signal captured (gh query returned none in this pass).
- **The Great Suspender** [GEM]: Sold to new owner → **injected malware → removed from Chrome store** (issue #1304 "Removed for containing malware?", #1263 "URGENT: SECURITY: new maintainer is probably malicious"). Spawned many MV3 forks (Awesome/Reloaded). Cautionary tale on ownership-transfer + trust. [greatsuspender/thegreatsuspender](https://github.com/greatsuspender/thegreatsuspender)

## Cross-Cutting Signals

- **Manifest V3 fallout** [GEM]: killed the suspension category (background pages gone); users hunting for MV3-native suspenders that don't leak data. Trust/privacy now front-of-mind ("no telemetry, everything local").
- **Permission distrust** [MEH]: "all tab manager extensions require access to all web content — too much." [HN 37306058](https://news.ycombinator.com/item?id=37306058)
- **NOISE** (counted, not expanded): SEO roundups — supasidebar "best 2026", alternativeto.net, Product Hunt alternatives lists, Trustpilot. ~5 hits, generic.

## Gaps Most Relevant to TabOrdo (has: sort, auto-group, dedupe, archive, pins, undo, rules, unified search, triage, mute)

1. **Bulletproof session save/restore with export + undo-on-loss.** OneTab's #1 failure is data loss with no recovery. TabOrdo already has archive+undo — lean into "your tabs can never be lost": local snapshots, versioned history, one-click export (plain text/JSON). Biggest differentiator.
2. **Cross-device sync of sessions/workspaces** — the most-requested missing thing; ideally free/local-first (sync file to user's own Drive), sidestepping Workona's paywall resentment.
3. **MV3-native tab suspension / memory saving.** Whole category is orphaned post-MV3. TabOrdo has mute/volume already — adding trustworthy local suspension fills a vacuum with high goodwill.
4. **Nested/hierarchical grouping (workspaces > groups > tabs).** Flat auto-group-by-domain ≠ the folders-within-folders users beg for. Highest structural feature ask.
5. **"Switch to existing tab" (activate instead of duplicate).** Natural extension of TabOrdo's dedupe + unified search — dedupe *before* the duplicate opens.

## Unresolved Questions

- Tab Manager Plus specific pain points thin — needs a dedicated pass.
- Sidebery issue-tracker signal not captured (gh returned none); worth `gh search issues --repo mbnuqw/sidebery` retry.
- No quantified upvote counts on most Reddit feature requests (threads archived); HN points captured where available.
- Pricing willingness: many say "would pay lifetime fee, hate subscriptions" — TabOrdo monetization implication unexplored.

## Sources
- https://news.ycombinator.com/item?id=27157225
- https://news.ycombinator.com/item?id=41487350
- https://news.ycombinator.com/item?id=37306058
- https://www.reddit.com/r/chrome/comments/19e9xur/best_alternative_to_workona/
- https://www.reddit.com/r/browsers/comments/yge87s/best_tab_and_tab_group_manager_for_chrome/
- https://www.reddit.com/r/chrome/comments/pszje2/alternatives_to_workona_tab_manager/
- https://www.reddit.com/r/chrome/comments/ehnf7l/alternatives_to_workona/
- https://www.reddit.com/r/Workona/
- https://www.reddit.com/r/ArcBrowser/comments/1gs09to/
- https://www.reddit.com/r/browsers/comments/sup0x7/
- https://www.reddit.com/r/chrome/comments/dv91t5/onetab_lost_tab_recovery_guide/
- https://www.reddit.com/r/chrome/comments/1fo3x16/onetab_lost_all_tabs_again/
- https://www.reddit.com/r/chrome/comments/1rctjx8/
- https://www.partizion.io/blog/onetab-lost-all-tabs
- https://www.reddit.com/r/chrome/comments/c74npp/
- https://www.reddit.com/r/chrome/comments/bxmimb/
- https://toby.nolt.io/753
- https://www.reddit.com/r/chrome/comments/1jcr994/tab_suspender_alternatives/
- https://github.com/greatsuspender/thegreatsuspender
