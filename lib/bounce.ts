export interface BounceCandidate {
  id?: number;
  url?: string;
  windowId?: number;
  lastAccessed?: number;
}

export function isBounceEligibleUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

// Find an already-open tab with the same URL to switch to instead of keeping a fresh duplicate.
// Returns null when the duplicate looks intentional: same URL as its opener (Chrome's "Duplicate Tab").
export function findBounceTarget(
  tabs: BounceCandidate[],
  newTabId: number,
  url: string,
  openerTabId?: number
): { id: number; windowId: number } | null {
  if (!isBounceEligibleUrl(url)) return null;
  if (openerTabId !== undefined) {
    const opener = tabs.find((t) => t.id === openerTabId);
    if (opener && opener.url === url) return null;
  }
  const matches = tabs.filter(
    (t) => t.id !== undefined && t.id !== newTabId && t.windowId !== undefined && t.url === url
  );
  if (matches.length === 0) return null;
  const best = matches.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));
  return { id: best.id!, windowId: best.windowId! };
}
