# TabOrdo

A keyboard-first tab manager for Chrome. Press `Cmd+E` to open a command palette that lets you search, sort, group, deduplicate, and manage your tabs.

## Install

[Chrome Web Store](https://chromewebstore.google.com) (pending review)

## Commands

| Command | Description |
|---------|-------------|
| `/b` | Search bookmarks |
| `/h` | Search history |
| `/w` | Current window tabs |
| `/p` | Pinned tabs only |
| `/g` | Current group tabs |
| `/sort` | Sort tabs by domain |
| `/group` | Group matching tabs |
| `/ungroup` | Ungroup matching tabs |
| `/collapse` | Collapse all tab groups |
| `/dedup` | Remove duplicate tabs |
| `/merge` | Merge all windows |
| `/move` | Move tab to position (`^` `$` or number) |
| `/movegroup` | Move group to position (`^` `$` or number) |
| `/pin` | Pin tab at fixed position in its group (`^` `$` or number) |
| `/unpin` | Remove tab position pin |
| `/pingroup` | Pin group at fixed position in window (`^` `$` or number) |
| `/unpingroup` | Remove group position pin |
| `/close` | Close matching tabs |
| `/closeold` | Close tabs older than 7 days |
| `/archive` | Archive matching tabs (supports group names) |
| `/focus` | Save tabs and start fresh |
| `/unfocus` | Restore saved workspace |
| `/mute` `/unmute` | Control tab audio |
| `/split` `/splitv` `/splith` | Split tabs to new windows |
| `/save` `/load` | Export/import tabs as text |

## Dashboard

The dashboard shows a live 🔊 banner when any tabs are playing audio — click it to jump to `@a` triage. `/pin` and `/pingroup` positions persist across Group+ and Sort operations. The **Archive** button opens a full-page archive view with search, date grouping, bulk restore/delete, and group name filtering.

## Triage Views

| Command | Shows |
|---------|-------|
| `@a` | Tabs playing audio |
| `@d` | Duplicate tabs |
| `@m` | Muted tabs |
| `@r` | Recently active tabs |
| `@s` | Suspended tabs |
| `@u` | Ungrouped tabs |

## Development

```bash
npm install
npm run dev          # dev mode with hot reload
npm run build        # production build
npm run zip          # build + zip for CWS
npm run check        # svelte type checking
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | WXT (WebExtension Tooling) |
| UI | Svelte 5, Tailwind CSS 4 |
| Search | uFuzzy |
| Build | Vite |

## Privacy

All data stays in your browser. No analytics, no tracking, no external requests. See [PRIVACY.md](PRIVACY.md).
