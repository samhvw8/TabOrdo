export interface ActionLogEntry {
  ts: number;
  action: string;
  detail: string;
}

export const ACTION_LOG_KEY = "tabOrdo_actionLog";
const MAX_ENTRIES = 20;

export async function logAction(action: string, detail: string): Promise<void> {
  try {
    const data = await chrome.storage.local.get(ACTION_LOG_KEY);
    const log: ActionLogEntry[] = Array.isArray(data[ACTION_LOG_KEY]) ? data[ACTION_LOG_KEY] : [];
    log.unshift({ ts: Date.now(), action, detail });
    await chrome.storage.local.set({ [ACTION_LOG_KEY]: log.slice(0, MAX_ENTRIES) });
  } catch {
    // logging must never break the automation that calls it
  }
}

export async function getActionLog(): Promise<ActionLogEntry[]> {
  const data = await chrome.storage.local.get(ACTION_LOG_KEY);
  return Array.isArray(data[ACTION_LOG_KEY]) ? data[ACTION_LOG_KEY] : [];
}

export async function clearActionLog(): Promise<void> {
  await chrome.storage.local.remove(ACTION_LOG_KEY);
}
