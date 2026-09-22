// Auto-discard: an alarm that unloads tabs nobody has looked at for a while.

import { getConfig } from "./rules.ts";

export const DISCARD_ALARM = "autoDiscard";
const DISCARD_PERIOD_MINUTES = 5;
const IDLE_DISCARD_MS = 45 * 60 * 1000;

/** From runtime.onInstalled. Creating an alarm that exists replaces it. */
export function startDiscardAlarm(): void {
  chrome.alarms.create(DISCARD_ALARM, { periodInMinutes: DISCARD_PERIOD_MINUTES });
}

/** From runtime.onStartup: recreate the alarm only if the browser lost it. */
export async function ensureDiscardAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(DISCARD_ALARM);
  if (!alarm) startDiscardAlarm();
}

/** The alarm's body: discard every idle tab, when the Discard toggle is on. */
export async function discardIdleTabs(): Promise<void> {
  const config = await getConfig();
  if (!config.autoDiscard) return;
  const cutoff = Date.now() - IDLE_DISCARD_MS;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.active || tab.pinned || tab.audible || tab.discarded || (tab as any).frozen) continue;
    if ((tab.lastAccessed || 0) < cutoff) {
      await chrome.tabs.discard(tab.id!).catch(() => {});
    }
  }
}
