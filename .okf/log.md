# Update Log

## 2026-09-17
* **Update**: Performance pass. Auto-sort skips an already sorted window and places locked groups directly; lock lists are cached; lineage records are batched — [background automation](/features/background-automation.md), [sort priority](/features/sort-priority.md), [position locks](/features/position-locks.md), [branch lineage](/features/branch-lineage.md), [Chrome stub](/testing/chrome-stub.md).
* **Update**: Undo entries are stored under one key each, and group undo leaves intact groups alone — [undo stack](/architecture/undo-stack.md), [overview](/architecture/overview.md).
* **Update**: Search skips fuzzy matching for one-letter and accented needles, builds haystacks after first paint, and prefix views stop querying Chrome per keystroke — [search](/features/search.md), [command palette](/features/command-palette.md).
* **Update**: Domain groups are named without the public suffix, and auto-group no longer makes a group of one tab when joining a group fails — [background automation](/features/background-automation.md), [grouping rules](/features/grouping-rules.md).
* **Creation**: The Chrome Web Store dashboard steps that blocked three releases, with privacy practices answers and the screenshot recipe — [store listing](/processes/chrome-web-store-listing.md).
* **Update**: Replaced the release page's point-in-time state with what to do when the store publish fails — [release](/processes/release.md).
* **Creation**: Product orientation page, the entry point for new readers — [TabOrdo](/tabordo.md).
* **Creation**: Architecture, including the single close path that commit 54b3787 introduced — [overview](/architecture/overview.md), [tab closing](/architecture/tab-closing.md), [undo stack](/architecture/undo-stack.md), [bulk lock](/architecture/bulk-lock.md).
* **Creation**: Commands and views — [command palette](/features/command-palette.md), [search](/features/search.md), [dedup](/features/dedup.md), [branch lineage](/features/branch-lineage.md), [focus workspaces](/features/focus-workspaces.md), [archive](/features/archive.md).
* **Creation**: Automation and ordering — [background automation](/features/background-automation.md), [grouping rules](/features/grouping-rules.md), [position locks](/features/position-locks.md), [sort priority](/features/sort-priority.md), [AI grouping](/features/ai-grouping.md).
* **Creation**: How the tests model Chrome, how releases ship, and why there are no host permissions — [Chrome stub](/testing/chrome-stub.md), [release](/processes/release.md), [no host permissions](/decisions/no-host-permissions.md).
* **Initialization**: Scaffolded with `okf_init.py` and built from the code at 9740b5d, CHANGELOG.md and the commit history; the scaffold's placeholder page was replaced by the product page.
