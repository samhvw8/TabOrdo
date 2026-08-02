// Finding and closing duplicate tabs.

import type { TabInfo } from "./types.ts";
import { getAllTabs } from "./query.ts";
import { snapshotBeforeClose } from "../undo.ts";

export async function findDuplicates(): Promise<Map<string, TabInfo[]>> {
  const tabs = await getAllTabs();
  const urlMap = new Map<string, TabInfo[]>();

  for (const tab of tabs) {
    const normalized = normalizeUrl(tab.url);
    if (!normalized) continue;
    if (!urlMap.has(normalized)) urlMap.set(normalized, []);
    urlMap.get(normalized)!.push(tab);
  }

  const duplicates = new Map<string, TabInfo[]>();
  for (const [url, group] of urlMap) {
    if (group.length > 1) duplicates.set(url, group);
  }
  return duplicates;
}

export async function removeDuplicates(): Promise<number> {
  const duplicates = await findDuplicates();
  const toClose: number[] = [];

  for (const [, tabs] of duplicates) {
    // A pinned tab is a deliberate keep. Picking the survivor purely by lastAccessed closed
    // it whenever an unpinned copy had been touched more recently — the one copy the user
    // asked to keep was the one that went.
    const pinned = tabs.filter((t) => t.pinned);
    const unpinned = tabs
      .filter((t) => !t.pinned)
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (unpinned.length === 0) continue;
    // A pinned copy is already the survivor, so every unpinned copy is a duplicate of it.
    const firstToClose = pinned.length > 0 ? 0 : 1;
    for (let i = firstToClose; i < unpinned.length; i++) {
      toClose.push(unpinned[i].id);
    }
  }

  if (toClose.length > 0) {
    // Snapshot here rather than at the call sites. Both popup paths took a *group* snapshot,
    // which dedup never changes — so undo restored grouping and left the closed duplicates
    // gone — and the action-menu entry took no snapshot at all. Owning it inside the mutation
    // is the only version that can't be forgotten at a fourth call site.
    await snapshotBeforeClose(toClose);
    await chrome.tabs.remove(toClose);
  }
  return toClose.length;
}

/** Params that identify the click, not the page — two copies of one article arriving from
 *  different campaigns are still the same tab. */
const TRACKING_PARAMS = new Set(["fbclid", "gclid"]);

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:") return null;
    // The query and hash are part of the page's identity: keying on the path alone made
    // youtube.com/watch?v=A and ?v=B the same tab, and closed one of them. Tracking cruft is
    // the exception — stripping it keeps a shared link deduping against the original.
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
    }
    return `${u.protocol}//${u.host}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}
