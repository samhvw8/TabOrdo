---
type: Playbook
title: Chrome Web Store listing and privacy practices
description: What the Chrome Web Store dashboard needs besides the uploaded build (privacy practices answers per permission, data disclosure, screenshots), why automation cannot fill it, and how the store screenshots are captured.
tags: [release, chrome-web-store, privacy, permissions, screenshots]
generated: { by: claude-code/claude-opus-5, at: 2026-09-17T02:27:59Z }
sources:
  - id: wxt-config
    resource: https://github.com/samhvw8/TabOrdo/blob/main/wxt.config.ts
    title: wxt.config.ts manifest permissions
    last_modified: 2026-07-24
  - id: privacy-md
    resource: https://github.com/samhvw8/TabOrdo/blob/main/PRIVACY.md
    title: PRIVACY.md
    last_modified: 2026-07-27
  - id: bg-index
    resource: https://github.com/samhvw8/TabOrdo/blob/main/entrypoints/background/index.ts
    title: entrypoints/background/index.ts (context menus, auto-discard alarm)
    last_modified: 2026-09-17
  - id: publish-run-072
    resource: https://github.com/samhvw8/TabOrdo/actions/runs/32646251724
    title: Publish to Chrome Web Store run for v0.7.2
    last_modified: 2026-08-23
  - id: cws-privacy-docs
    resource: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
    title: Fill out the privacy fields (Chrome for Developers)
    author: team:chrome-web-store
  - id: cws-user-data-faq
    resource: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
    title: User data FAQ (Chrome Web Store program policies)
    author: team:chrome-web-store
  - id: cws-images-docs
    resource: https://developer.chrome.com/docs/webstore/images
    title: Supplying images (Chrome for Developers)
    author: team:chrome-web-store
---

# Overview

`wxt submit` in [the publish workflow](/processes/release.md) uploads a build and asks the store to publish it. Everything else on the listing lives only in the developer dashboard, and the store refuses to publish while a mandatory part is missing. v0.7.0, v0.7.1 and v0.7.2 all uploaded and then failed with 400 "Publish condition not met … provide mandatory privacy information … on the Privacy practices tab".[^publish-run-072]

Both the dashboard and the public listing refuse browser automation ("Not allowed" on both Web Store domains), so these steps are manual.

# Privacy practices answers

The store requires disclosure even when data never leaves the device.[^cws-user-data-faq] The tab has one justification field per manifest permission.[^cws-privacy-docs] Keep this table in step with the `permissions` array in the manifest.[^wxt-config]

**Single purpose:** Organise the user's open browser tabs: find, group, sort, deduplicate, close and restore them from a keyboard-driven command palette, dashboard and side panel.

| Permission | Justification |
|------------|---------------|
| `tabs` | Read tab titles and URLs to list, search, sort, group, deduplicate, move and close the user's tabs. |
| `tabGroups` | Create, name, colour, collapse and reorder tab groups, and put tabs back into their groups on undo. |
| `bookmarks` | Search bookmarks from the command palette (`/b`). |
| `history` | Search browsing history from the command palette (`/h`). |
| `storage` | Keep settings, grouping rules, position locks, archived tabs and the undo stack in the browser's local and session storage. Nothing is synced or sent. |
| `alarms` | Run the optional auto-discard check every 5 minutes, which unloads idle tabs to save memory.[^bg-index] |
| `scripting` | Inject a small built-in function into the tab the user acts on, to set its audio and video volume (`/vol`) and to add a 📌 title badge to a position-locked tab. |
| `activeTab` | Limit those injections to the tab the user just invoked TabOrdo on, instead of requesting access to every site. |
| `readingList` | Save tabs to Chrome's Reading List (`/readlater`) and search it (`/rl`). |
| `contextMenus` | Add group, dedup, sort, reading-list, discard and side-panel actions to the toolbar icon's right-click menu.[^bg-index] |
| `sessions` | List and restore recently closed tabs and windows (`/rc`, `/recent`, `/restore`). |
| `favicon` | Show site icons from Chrome's local favicon cache, so no request goes to a favicon service. |

**Remote code:** No. All code ships in the package.[^privacy-md]

**Data usage.** Tick **Web history**: tab URLs and titles, history search, recently closed tabs, Reading List entries and archived tabs, all handled locally.[^privacy-md] Leave the other categories unticked; nothing personal, financial, authentication-related, locational or communicative is read, and no clicks or keystrokes on web pages are recorded. Check the three certifications (no selling or transferring data, no use unrelated to the single purpose, no creditworthiness use) only if [PRIVACY.md](https://github.com/samhvw8/TabOrdo/blob/main/PRIVACY.md) is still true.

**Privacy policy URL:** `https://github.com/samhvw8/TabOrdo/blob/main/PRIVACY.md`

# Screenshots

| Rule | Value |
|------|-------|
| Size | 1280×800 (or 640×400), square corners, full bleed[^cws-images-docs] |
| Count | at least 1, up to 5[^cws-images-docs] |
| Local files | `cws-*.png` at the repo root, ignored by git |

The 2026-09-17 set was captured without the store version installed:

1. `npm run build`, then launch Playwright's Chromium with `--load-extension=.output/chrome-mv3` in a fresh persistent profile, `colorScheme: "dark"` (GitHub serves a dark favicon to light mode, invisible on the dark UI).
2. Open real pages, group them through `chrome.tabs.group` from the extension's service worker, and seed `tabOrdo_archive` in local storage.
3. Open `chrome-extension://<id>/popup.html` in a 450×600 tab at 2× scale; type into the search box for the search, `/` and `@` states. Capture `archive.html` at 1280×800.
4. Frame each capture onto a 1280×800 canvas with a headline, and check every image by eye.

# Gotchas

- `developer.chrome.com` titles its pages `browser.tabs` for any browser not branded Chrome; the capture rewrites them to the `chrome.tabs` title Chrome users see.
- The archive page groups entries by UTC date but labels groups in local time, so seed afternoon timestamps or one local day shows under two headings.
- The side panel clips its content at 400px wide; it is left out of the set.

# Related

[Releasing TabOrdo](/processes/release.md) · [No host permissions](/decisions/no-host-permissions.md) · [TabOrdo](/tabordo.md)

[^wxt-config]: wxt.config.ts
[^privacy-md]: PRIVACY.md
[^bg-index]: entrypoints/background/index.ts
[^publish-run-072]: GitHub Actions run 32646251724
[^cws-privacy-docs]: Fill out the privacy fields
[^cws-user-data-faq]: Chrome Web Store user data FAQ
[^cws-images-docs]: Supplying images
