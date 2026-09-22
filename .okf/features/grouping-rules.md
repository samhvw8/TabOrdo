---
type: Feature
title: Grouping rules and ignore lists
description: How the shared rulesConfig is stored and written; how group rules and ignore patterns match hostnames and group names without backtracking; and the Rules editor that edits them.
resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/rules.ts
tags: [rules, config, ignore-lists, pattern-matching, storage]
generated: { by: claude-code/claude-opus-5, at: 2026-09-22T21:00:00Z }
sources:
  - id: rules
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/rules.ts
    title: lib/rules.ts
    last_modified: 2026-09-22
  - id: rules-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/rules.test.ts
    title: lib/rules.test.ts
    last_modified: 2026-08-05
  - id: rules-writes-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/rules-writes.test.ts
    title: lib/rules-writes.test.ts
    last_modified: 2026-07-27
  - id: rules-editor
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/RulesEditor.svelte
    title: components/RulesEditor.svelte
    last_modified: 2026-09-22
  - id: popup-app
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/popup/App.svelte
    title: entrypoints/popup/App.svelte (automation switches)
    last_modified: 2026-09-22
  - id: settings-panel
    resource: https://github.com/samhvw8/TabOrdo/blob/main/components/SettingsPanel.svelte
    title: components/SettingsPanel.svelte
    last_modified: 2026-07-18
  - id: group
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/group.ts
    title: lib/tabs/group.ts
    last_modified: 2026-08-15
  - id: group-test
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/tabs/group.test.ts
    title: lib/tabs/group.test.ts
    last_modified: 2026-08-02
  - id: actions
    resource: https://github.com/samhvw8/TabOrdo/blob/main/lib/actions.ts
    title: lib/actions.ts (group handler)
    last_modified: 2026-09-17
  - id: bg-index
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: entrypoints/background/index.ts
    last_modified: 2026-09-17
  - id: commit-glob
    resource: https://github.com/samhvw8/TabOrdo/commit/a539f1a0c98d39d77f747cc6a15588d33188d2ed
    title: "fix: linear glob matching, cross-rule sort tiers, sort-priority feedback"
    last_modified: 2026-08-04
  - id: changelog
    resource: https://github.com/samhvw8/TabOrdo/blob/main/CHANGELOG.md
    title: CHANGELOG.md (0.6.0)
    last_modified: 2026-09-17
---

# Overview

`lib/rules.ts` owns one settings object, `rulesConfig`, in `chrome.storage.local`. It holds the automation flags, the group rules, both ignore lists and the [sort priority](/features/sort-priority.md) rules. It also owns every pattern matcher those settings use.[^rules] Group rules decide which group a tab joins; ignore lists opt URLs and group names out of grouping and ungrouping.

# Schema

| Field | Type | Notes |
|-------|------|-------|
| `rules` | `GroupRule[]` = `{ id, name, color, patterns[] }` | Order matters: first match wins |
| `autoGroup`, `autoUngroup`, `useRules`, `autoSort`, `autoPinFollow`, `autoDiscard`, `switchToExisting` | boolean | Default `false`; the type `AutomationFlag` names these seven. See [background automation](/features/background-automation.md) |
| `useAI` | boolean | Read and written, never consulted (see Gotchas) |
| `ignorePatterns`, `ignoreGroupNames` | `IgnoreRule[]` = `{ pattern, enabled, caseSensitive?, isRegex? }` | Bare strings from older data are normalised to `{ pattern, enabled: true }` |
| `sortRules` | `SortRule[]` | See [sort priority](/features/sort-priority.md) |

On the very first read, `getConfig()` writes the all-false default. Normalisation fills missing fields on every read.[^rules]

# Invariants

- **`getConfig()` reads storage every time.** A read costs about 0.15 ms in the worker (measured in Chrome for Testing 153), and the popup, the side panel and the worker all write `rulesConfig`, so a copy held in any one of them can go stale. A read cache used to sit here, with invalidation on `storage.onChanged` and a fresh-read rule on every write path; it shipped two stale-config bugs to save well under a millisecond per tab event, and was removed.[^rules][^rules-writes-test]
- **Every write goes through `updateConfig`**, a per-context promise chain that does read, change, then save, so two quick toggles in one context cannot revert each other. It takes a patch of fields (`updateConfig({ autoSort: true })`), or a function for an edit that depends on the stored value (`mergeRules`, adding a rule). Its read happens inside the chain, so a write from the other surface that has just landed is not reverted: the popup and side panel are the same component in two contexts.[^rules]
- **Readers call `getConfig()` and take the fields they need.** There are no per-field getters or setters, except `getSortRules` and `setSortRules`, which the sort and the Pins panel use.[^rules]

# Matching

| Function | Input | Semantics |
|----------|-------|-----------|
| `matchDomainToRule(host, rules)` | hostname (`www.` stripped) | Rules in list order, patterns in order, first `domainMatches` wins |
| `domainMatches(host, p)` | hostname | No `*`: exact or subdomain (`github.com` covers `docs.github.com`). With `*`: whole-string glob. Case-insensitive by default |
| `isIgnoredUrl(url, list)` | **hostname only** | Regex rules via `ruleMatches`, others via `domainMatches`; disabled rules skipped |
| `isIgnoredGroupName(title, list)` | group title | `ruleMatches`: exact string, glob or regex |

- **Globs never compile to a RegExp.** `globMatches` splits on `*` and walks the input with `indexOf`, so it cannot backtrack.[^rules] The old `*` → `.*` expansion took 8.3 s on a 21-character pattern against a 40-character input. That matcher ran on every tab event and froze the service worker.[^commit-glob]
- **`?` is literal** in every glob. Unescaped, a leading `?` threw "Nothing to repeat" from inside a tab listener.[^commit-glob]
- **Regex rules** (`isRegex`) are compiled. They are refused past `MAX_PATTERN_LENGTH` = 100 or when `hasNestedQuantifier` spots the `(a+)+` shape. That check is a heuristic by design. The length cap applies only to glob and regex patterns: capping plain literals silently disabled long URL rules.[^rules][^changelog]

# Where rules and ignore lists apply

- **Background auto-group** uses rules only when `useRules` is on. A rule creates a group even for a single tab, and domain fallback needs 2 or more tabs. Ignored URLs are skipped, and they do not count toward those 2 tabs.[^bg-index][^group]
- **Auto-ungroup** skips rule-named groups (with `useRules` on) and ignored group names.[^bg-index]
- **`groupTabsByDomain`** (the dashboard Group and Regroup actions, the context menu's "Group tabs by domain") uses rules only when `useRules` is on. It skips ignored URLs and tabs inside protected groups, and leaves protected groups standing in rebuild mode. `ungroupAll` leaves them alone too. `untouchableGroupIds` (shared or ignored-name groups) protects them from `/branch`.[^group] The ignore lists used to be enforced only on the background path.[^group-test][^changelog] A run ends by collapsing every group except the active tab's, and only groups in the wrong state get an update. Additive mode fetches every tab once, since only a rebuild changes the strip before the grouping pass.[^group][^group-test]
- **Domain groups are titled by name, not domain.** Both grouping paths title and key a domain group by the registrable domain without its public suffix (`getGroupNameMapper`), so `google.com` and `google.de` share a group called `google`. A rule's name is used as written.[^group] Groups titled with a full domain before this change are still joined.
- **`/group <query>` is different.** Its handler groups the matched tab ids directly into a group titled with the query, without consulting rules or either ignore list.[^actions]

# Rules editor (`components/RulesEditor.svelte`)

This is the sidebar's Rules section. Its auto-group switch shares the dashboard's state: App passes in its `automation` record, which its `storage.onChanged` subscription keeps in step with `rulesConfig`, and the toggle function the dashboard's Auto switch uses. The switch therefore follows a change made on the dashboard or in the other surface; it used to read the flag once at mount.[^rules-editor][^popup-app] The section also has "Import from groups" (`populateFromCurrentGroups`: one rule per titled group that has no rule yet, patterns = its tabs' hostnames), "+ Current tab", per-rule colour, name, patterns, "+Tab", Merge (B's patterns folded into A, then B deleted) and Del. Pasted URLs are reduced to hostnames. A rule tester reports the winning rule and pattern, plus later rules that also match but can never fire.[^rules-editor] The ignore lists, with their own tester and regex generation, are in the Settings panel.[^settings-panel]

# Gotchas

- **Ignore patterns see only the hostname**, which has no port and no path. The Settings placeholder `e.g. localhost:5763` can therefore never match, and neither can `*github.com/org*`. Both were confirmed by running `isIgnoredUrl`.[^rules][^settings-panel]
- The editor keeps its own copy of `rules` from mount and saves with `updateConfig({ rules })`, which replaces the whole array, so two open editors are last-writer-wins on rules even though other fields merge safely.[^rules-editor]
- A broad pattern listed earlier shadows a specific one listed later. The tester shows this.[^rules-test]
- `useAI` and `ruleToRegex`'s `.*` expansion are leftovers. `ruleToRegex` only generates regex text in Settings; it never matches anything.[^rules]

# Tests that guard it

- `lib/rules.test.ts`: `domainMatches`, `ruleMatches`, the nested-quantifier guard, the pattern length cap, `matchDomainToRule` order and shadowing, `globMatches` "stays fast on the pattern that used to hang", literal `?`.[^rules-test]
- `lib/rules-writes.test.ts`: no failed write laundered into the next one, no revert of another context's toggle, serialised toggles.[^rules-writes-test]
- `lib/tabs/group.test.ts` "ignore lists": manual grouping and ungrouping honour both lists.[^group-test]

# Related

[Background automation](/features/background-automation.md) · [Sort priority](/features/sort-priority.md) · [Branch lineage](/features/branch-lineage.md) · [Chrome stub](/testing/chrome-stub.md)

[^rules]: lib/rules.ts
[^rules-test]: lib/rules.test.ts
[^rules-writes-test]: lib/rules-writes.test.ts
[^rules-editor]: components/RulesEditor.svelte
[^popup-app]: entrypoints/popup/App.svelte
[^settings-panel]: components/SettingsPanel.svelte
[^group]: lib/tabs/group.ts
[^group-test]: lib/tabs/group.test.ts
[^actions]: lib/actions.ts
[^bg-index]: entrypoints/background/index.ts
[^commit-glob]: commit a539f1a
[^changelog]: CHANGELOG.md
