import type { SearchResult } from "./search.ts";

function isSessionsAvailable(): boolean {
  return typeof chrome !== "undefined" && !!chrome.sessions;
}

export async function getRecentlyClosed(maxResults = 25): Promise<SearchResult[]> {
  if (!isSessionsAvailable()) return [];
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults });
  const results: SearchResult[] = [];

  for (const session of sessions) {
    if (session.tab) {
      const t = session.tab;
      results.push({
        type: "history",
        id: `session-tab-${t.sessionId}`,
        title: t.title || "",
        url: t.url || "",
        favIconUrl: t.favIconUrl,
      });
    }
    if (session.window) {
      for (const t of session.window.tabs || []) {
        results.push({
          type: "history",
          id: `session-win-${t.sessionId}`,
          title: t.title || "",
          url: t.url || "",
          favIconUrl: t.favIconUrl,
        });
      }
    }
  }
  return results;
}

export async function restoreSession(sessionId: string): Promise<void> {
  if (!isSessionsAvailable()) return;
  await chrome.sessions.restore(sessionId);
}
