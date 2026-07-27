# Privacy Policy — TabOrdo

**Last updated:** July 25, 2026

## Data Collection

TabOrdo does **not** collect, transmit, or store any personal data. All data remains entirely within your browser.

## What TabOrdo Accesses

| Data | Purpose | Stored? | Transmitted? |
|------|---------|---------|--------------|
| Tab titles and URLs | Display in command palette, search, sort, group, deduplicate | No (in-memory only) | No |
| Bookmarks | Search via /b command | No | No |
| Browsing history | Search via /h command | No | No |
| Reading List entries | Read and add entries via /rl and /readlater | No | No |
| Recently closed tabs | Restore via /rc, /recent and /restore | No | No |
| Favicons | Display site icons. Open tabs use the icon the browser has already loaded; the archive and pins panel read Chrome's local favicon cache | No | No |
| User preferences | Persist settings, auto-group rules, archived tabs, activity log | Yes (local storage only) | No |

## Permissions

TabOrdo requests browser permissions solely to provide tab management features. No data is sent to any external server, analytics service, or third party.

## On-Device AI

The optional `/aigroup` command sends tab titles and URLs to **Gemini Nano, which runs entirely inside your own browser**. Nothing leaves your device, and the feature is off unless you invoke it. If the on-device model is unavailable, the command reports an error rather than falling back to any remote service.

## Third-Party Services

TabOrdo uses **no** third-party services, analytics, tracking, remote code, or remote favicon services.

## Changes

If this policy changes, the updated version will be posted here with a new date.

## Contact

For questions, open an issue at [github.com/samhvw8/TabOrdo/issues](https://github.com/samhvw8/TabOrdo/issues).
