// Closing and unloading. closeTabs is the only place in the extension that removes a tab.

import { getDomainMapper } from "../url.ts";
import { snapshotBeforeClose } from "../undo.ts";

// allSettled, like /reload: discards are independent, and awaiting each in turn made /freeze on a
// thousand tabs a thousand round-trips end to end. A tab Chrome won't discard still skips only
// itself.
export async function discardTabs(tabIds: number[]): Promise<void> {
  await Promise.allSettled(tabIds.map((id) => chrome.tabs.discard(id)));
}

/** Chrome's rejection for an id it no longer knows. The tab is gone, which is what was asked. */
function isAlreadyGone(reason: unknown): boolean {
  return reason instanceof Error && reason.message.startsWith("No tab with id");
}

/**
 * The one caller of chrome.tabs.remove — close.test.ts fails the build if a second appears.
 * Five closers each used to snapshot, remove and count on their own, and every release fixed
 * whichever of the three had drifted at whichever site; a dashboard button that closed with
 * no snapshot at all is the version of that which reaches the user. Owning all three here is
 * the only shape a new call site can't get wrong.
 *
 * Order matters: the snapshot is pushed, durably, before anything is removed (pushUndo's
 * contract — a write it cannot make throws, and then nothing closes, for one tab or fifty).
 * Removal is per id, not one remove(array): Chrome walks an array in order and stops at the
 * first id it can't resolve, so a single stale entry used to leave everything after it open.
 *
 * Rejections come in two kinds and are kept apart. "No tab with id" means the tab went
 * between the caller's scan and this call; the intent is satisfied and it counts as closed.
 * Anything else — a tab mid-drag — means the tab is still there, and is thrown once the rest
 * of the batch has been attempted, so one refused tab neither hides behind "Closed 4" nor
 * keeps the other three open. Undo copes with the entry naming a tab that is still open:
 * executeUndo restores only what is actually gone.
 *
 * A page whose "Leave site?" prompt the user answers with Stay is not a rejection. That
 * remove never settles, so neither does this call; a per-id timeout was judged a tuning knob
 * for a hang nobody has reported.
 *
 * Resolves to the number of ids that are no longer open.
 *
 * `snapshot: false` is for a close that has its own recovery — focus mode's workspace stack,
 * the switch-to-existing bounce whose tab is a second old — where a Ctrl+Z entry would either
 * double-restore or evict something the user wanted from the 20-slot stack.
 */
export async function closeTabs(
  tabIds: number[],
  opts: { snapshot?: boolean } = {}
): Promise<number> {
  if (tabIds.length === 0) return 0;
  if (opts.snapshot !== false) await snapshotBeforeClose(tabIds);
  const results = await Promise.allSettled(tabIds.map((id) => chrome.tabs.remove(id)));
  let gone = 0;
  const refused: unknown[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" || isAlreadyGone(r.reason)) gone++;
    else refused.push(r.reason);
  }
  if (refused.length > 0) {
    const why = refused[0] instanceof Error ? refused[0].message : String(refused[0]);
    throw new Error(`${refused.length} tab(s) could not be closed: ${why}`);
  }
  return gone;
}

async function closeTabsRelativeTo(direction: "left" | "right"): Promise<number> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find((t) => t.active);
  if (!active) return 0;
  const toClose = tabs.filter((t) =>
    !t.pinned && (direction === "left" ? t.index < active.index : t.index > active.index)
  );
  return closeTabs(toClose.map((t) => t.id!));
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
  const domainOf = await getDomainMapper();
  const activeDomain = domainOf(active.url);
  if (!activeDomain) return 0;
  const tabs = await chrome.tabs.query({});
  const toClose = tabs.filter(
    (t) => !t.pinned && t.id !== active.id && domainOf(t.url || "") === activeDomain
  );
  return closeTabs(toClose.map((t) => t.id!));
}

export async function closeOldTabs(maxAgeDays: number = 7): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const tabs = await chrome.tabs.query({});
  const toClose = tabs.filter(
    (t) => !t.pinned && !t.active && (t.lastAccessed || 0) < cutoff
  );
  return closeTabs(toClose.map((t) => t.id!));
}
