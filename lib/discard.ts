// Discarding: which tabs may be unloaded, the auto-discard alarm, and "unload inactive tabs" for
// the menu entry and bare /freeze.

import { getConfig } from "./rules.ts";
import { discardTabs } from "./tabs/index.ts";

export const DISCARD_ALARM = "autoDiscard";
const DISCARD_PERIOD_MINUTES = 5;
export const IDLE_DISCARD_MS = 45 * 60 * 1000;

/**
 * The tabs that may be discarded: not the active tab of any window, not Chrome-pinned, not
 * playing sound, not discarded already. With `idleSince`, also only those last used before it;
 * a tab Chrome reports no access time for counts as idle.
 *
 * The alarm, the menu entry and /freeze each had a copy of this, and the alarm's also spared
 * tabs Chrome had frozen. Frozen is the step before discarded in Chrome's tab lifecycle: the
 * page is paused but still holds its memory, and freeing that is the point of discarding.
 */
export function discardableTabs(tabs: chrome.tabs.Tab[], idleSince?: number): chrome.tabs.Tab[] {
  return tabs.filter((t) =>
    !t.active && !t.pinned && !t.audible && !t.discarded &&
    (idleSince === undefined || (t.lastAccessed || 0) < idleSince)
  );
}

/** "Discard inactive tabs" and bare /freeze: every discardable tab, however recently used. */
export async function discardInactiveTabs(): Promise<number> {
  const tabs = discardableTabs(await chrome.tabs.query({}));
  await discardTabs(tabs.map((t) => t.id!));
  return tabs.length;
}

/** From runtime.onInstalled. Creating an alarm that exists replaces it. */
export function startDiscardAlarm(): void {
  chrome.alarms.create(DISCARD_ALARM, { periodInMinutes: DISCARD_PERIOD_MINUTES });
}

/** From runtime.onStartup: recreate the alarm only if the browser lost it. */
export async function ensureDiscardAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(DISCARD_ALARM);
  if (!alarm) startDiscardAlarm();
}

/** The alarm's body: discard the tabs idle for IDLE_DISCARD_MS, when the Discard toggle is on. */
export async function discardIdleTabs(): Promise<void> {
  const config = await getConfig();
  if (!config.autoDiscard) return;
  const idle = discardableTabs(await chrome.tabs.query({}), Date.now() - IDLE_DISCARD_MS);
  await discardTabs(idle.map((t) => t.id!));
}
