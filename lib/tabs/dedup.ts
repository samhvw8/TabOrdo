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
    const sorted = tabs.sort(
      (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
    );
    for (let i = 1; i < sorted.length; i++) {
      toClose.push(sorted[i].id);
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

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:") return null;
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}
