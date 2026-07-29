// Bulk closing and unloading. Every path here snapshots for undo first.

import { getDomain } from "../url.ts";
import { snapshotClosedTabs } from "../undo.ts";

export async function discardTabs(tabIds: number[]): Promise<void> {
  for (const id of tabIds) {
    await chrome.tabs.discard(id).catch(() => {});
  }
}

async function closeTabsRelativeTo(direction: "left" | "right"): Promise<number> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find((t) => t.active);
  if (!active) return 0;
  const toClose = tabs.filter((t) =>
    !t.pinned && (direction === "left" ? t.index < active.index : t.index > active.index)
  );
  if (toClose.length > 0) {
    await snapshotClosedTabs(toClose);
    await chrome.tabs.remove(toClose.map((t) => t.id!));
  }
  return toClose.length;
}

export async function closeTabsToLeft(): Promise<number> {
  return closeTabsRelativeTo("left");
}

export async function closeTabsToRight(): Promise<number> {
  return closeTabsRelativeTo("right");
}

export async function closeTabsSameSite(): Promise<number> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.url) return 0;
  const activeDomain = getDomain(active.url);
  if (!activeDomain) return 0;
  const tabs = await chrome.tabs.query({});
  const toClose = tabs.filter(
    (t) => !t.pinned && t.id !== active.id && getDomain(t.url || "") === activeDomain
  );
  if (toClose.length > 0) {
    await snapshotClosedTabs(toClose);
    await chrome.tabs.remove(toClose.map((t) => t.id!));
  }
  return toClose.length;
}

export async function closeOldTabs(maxAgeDays: number = 7): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const tabs = await chrome.tabs.query({});
  const toClose = tabs.filter(
    (t) => !t.pinned && !t.active && (t.lastAccessed || 0) < cutoff
  );
  if (toClose.length > 0) {
    await snapshotClosedTabs(toClose);
    await chrome.tabs.remove(toClose.map((t) => t.id!));
  }
  return toClose.length;
}
