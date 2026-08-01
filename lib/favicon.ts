// Chrome's local favicon cache. Requires the "favicon" permission in the manifest.
// Every favicon in the extension goes through here so no caller reaches for a remote
// favicon service again — that would leak the user's URLs to a third party.
export function faviconCacheUrl(pageUrl: string, size = 16): string {
  return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}
