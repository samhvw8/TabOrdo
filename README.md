# TabOrdo - Tab Manager & Organizer

A keyboard-first tab manager for Chrome. Press `Cmd+E` to open a command palette that lets you search, sort, group, deduplicate, and manage your tabs.

## Install

[Chrome Web Store](https://chromewebstore.google.com/detail/tabOrdo/kkobnbbfolmicnhnnbmcmdbgilocpnbi)

Requires Chrome 138 or later.

## Commands

| Command | Description |
|---------|-------------|
| `/b` | Search bookmarks |
| `/h` | Search history |
| `/w` | Current window tabs |
| `/p` | Chrome-pinned tabs only |
| `/g` | Current group tabs |
| `/sort` | Sort tabs by domain |
| `/group` | Group matching tabs |
| `/branch` | Group this tab and every tab opened from it (optional trailing text names the group) |
| `/branchup` | Same, starting one level up: the parent tab's whole branch |
| `/parent` | Switch to the tab that opened this one |
| `/ungroup` | Ungroup matching tabs |
| `/collapse` | Collapse all tab groups |
| `/dedup` | Remove duplicate tabs |
| `/merge` | Merge all windows |
| `/move` | Move tab to position (`^` `$` or number) |
| `/movegroup` | Move group to position (`^` `$` or number) |
| `/lock` | Hold tab at a position in its group (`^` `$` or number) |
| `/unlock` | Release a tab's held position |
| `/lockgroup` | Hold group at a position in the window (`^` `$` or number) |
| `/unlockgroup` | Release a group's held position |
| `/close` | Close matching tabs |
| `/closeold` | Close tabs older than 7 days |
| `/archive` | Archive matching tabs (supports group names) |
| `/focus` | Save tabs and start fresh |
| `/unfocus` | Restore saved workspace |
| `/mute` `/unmute` | Control tab audio |
| `/vol` | Set tab volume (e.g. `/vol 50`); only the active tab can be reached |
| `/split` `/splitv` `/splith` | Split tabs to new windows |
| `/splitdomain` | One window per domain |
| `/stack` | Stack windows to left |
| `/unite` | Pull same-domain tabs here |
| `/isolate` | Move domain to new window |
| `/shuffle` | Randomly reorder tabs |
| `/discard` | Unload tabs from memory (they reload when you return) |
| `/reload` | Reload matching tabs |
| `/save` `/load` | Export/import tabs as text |
| `/re` | Regex search tabs |
| `/rl` | Search Reading List |
| `/readlater` | Save matching tabs to Reading List |
| `/rc` `/recent` | Recently closed tabs |
| `/restore` | Restore the last closed tab or window |
| `/closeleft` `/closeright` | Close tabs left/right of the active tab |
| `/closesite` | Close other tabs from the active tab's domain |
| `/extract` | Extract the active tab from its group to a new window |
| `/aigroup` | Smart grouping with on-device AI (Gemini Nano) |
| `/sidepanel` | Open TabOrdo in the Side Panel |
| `/feedback` | Open feedback page |

## Keyboard Shortcuts

| Mac | Windows / Linux | Action |
|-----|-----------------|--------|
| `Cmd+E` | `Ctrl+Shift+E` | Open TabOrdo |
| `Cmd+Shift+E` | `Ctrl+Shift+D` | Open TabOrdo (dashboard, no search focus) |
| `↑↓` | `↑↓` | Navigate results |
| `Enter` | `Enter` | Open / run command |
| `Ctrl+Del` | `Ctrl+Del` | Close selected tab |
| `Cmd+Z` | `Ctrl+Z` | Undo last action |

Change them at `chrome://extensions/shortcuts`.

## Dashboard

The dashboard shows a live 🔊 banner when any tabs are playing audio — click it to jump to `@a` triage. Lock positions (`/lock`, `/lockgroup`) hold through Group+, Regroup and Sort. The **Archive** button opens a full-page archive view with search, date grouping, bulk restore/delete, and group name filtering.

**Customizable actions** — the action buttons on the dashboard are configurable, and each one runs the same action as its slash command. Open the **More** sidebar panel and click ★ next to any action to add or remove it from the dashboard grid. Your selection persists across sessions.

**Alt-click for the opposite** — several tiles carry a second mode. Hold `Alt` (or `Ctrl`) and the tile relabels to show what it will do; click to run it. One tile covers both directions, so you don't have to spend two dashboard slots on a pair.

| Tile | Click | Alt-click |
|------|-------|-----------|
| Lock Tab | Hold at current position | Hold at first position (unlock if it already holds it) |
| Lock Group | Hold group at current position | Hold group at first position |
| Mute Tab | Mute active tab | Unmute active tab |
| Branch | Group this tab's branch | Group the parent's whole branch |
| Branch Up | Group the parent's whole branch | Group this tab's branch |
| Close Left | Close tabs to the left | Close tabs to the right |
| Close Right | Close tabs to the right | Close tabs to the left |
| Split V | Side-by-side windows | Top/bottom windows |
| Split H | Top/bottom windows | Side-by-side windows |
| Save | Export tabs to file | Import tabs from file |
| Load | Import tabs from file | Export tabs to file |
| Unite | Pull same-domain tabs here | Send domain to a new window |
| Isolate | Send domain to a new window | Pull same-domain tabs here |

## Sidebar

| Section | Description |
|---------|-------------|
| Home | Dashboard with action buttons, toggles, and tab overview |
| Locks | Position locks for tabs and groups, plus per-domain sort priority |
| Rules | Custom grouping rules editor |
| AI | On-device grouping with Gemini Nano |
| More | All available actions with ★ toggle for dashboard |
| Settings | Ignore lists for auto-group/ungroup, and the automation activity log |
| Archive | Opens full-page archive in a new tab |

## Sort Priority

Locks hold a tab at a fixed slot. Sort priority instead changes the order a domain sort
produces, without holding anything — a locked tab still wins. Two knobs per domain, both set
by the order of the list in the Locks panel:

| Knob | Effect |
|------|--------|
| `first` | That domain leads the strip, ahead of every unlisted domain, in list order |
| Path patterns | Order tabs within that domain — the first pattern a URL matches decides |

Path patterns are segment-aware, and both ends are anchored:

| Pattern | Matches |
|---------|---------|
| `*` | Exactly one segment, never crossing a `/` |
| `**` | Any number of segments, including none |
| `/truyen/*` | `/truyen/9`, but not `/truyen/x/y` |
| `/truyen/**` | `/truyen` and everything beneath it |
| `/truyen/*/*/a/*` | Exactly those levels, with `a` fourth |
| `**/pulls/**` | `pulls` at any depth |

The leading `/` is optional — `truyen/*` and `/truyen/*` are the same pattern. Everything other
than a wildcard is literal, `?` included, so a query string can be pasted in as-is. A domain
entry also covers its subdomains, and rules higher in the list take precedence. Each row shows
how many open tabs it currently matches, so a pattern that matches nothing says so immediately.

## Triage Views

| Command | Shows |
|---------|-------|
| `@` | Overview: audio, muted, duplicate, recent, unloaded and paused tabs |
| `@a` | Tabs playing audio |
| `@d` | Duplicate tabs |
| `@m` | Muted tabs |
| `@r` | Recently active tabs |
| `@s` | Unloaded (discarded) tabs |
| `@u` | Ungrouped tabs |
| `@b` | This tab's branch — everything opened from it, as an outline |
| `@f` | Tabs Chrome has paused (frozen) |
| `@shared` | Tabs in shared groups |

Type after a view to search inside it (`@a youtube`). With nothing typed, a view lists its first 100 tabs; type to narrow.

## Development

```bash
mise install         # Node version from mise.toml (CI uses the same file)
npm install
npm run dev          # dev mode with hot reload
npm run build        # production build (minified)
npm run build:dev    # unminified build with inline sourcemaps, for debugging
npm run zip          # build + zip for CWS
npm run check        # svelte type checking
npm test             # unit tests
```

Releases follow the steps in [CLAUDE.md](CLAUDE.md): version bump, dated CHANGELOG section, annotated tag, then a GitHub Release, which submits the build to the Chrome Web Store.

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | WXT (WebExtension Tooling) |
| UI | Svelte 5, Tailwind CSS 4 |
| Search | uFuzzy, tiny-pinyin (Chinese pinyin matching) |
| Domains | tldts-icann (public-suffix list, ICANN section) |
| AI grouping | Chrome's built-in Prompt API (Gemini Nano, on-device) |
| Build | Vite |
| Tests | Vitest against a hand-written Chrome API stub |

## Privacy

All data stays in your browser. No analytics, no tracking, and no third-party services — favicons come from Chrome's local cache rather than a remote favicon service, and `/aigroup` runs Gemini Nano on-device. See [PRIVACY.md](PRIVACY.md).
