export interface ActionLogEntry {
  ts: number;
  action: string;
  detail: string;
}

export const ACTION_LOG_KEY = "tabOrdo_actionLog";
const MAX_ENTRIES = 20;

// Entries waiting for the next write, oldest first, and the chain every write goes through.
// A burst of tab loads logs several auto-groups at once; one read-modify-write each let the
// overlapping ones overwrite each other. Queued, a burst lands in one write. The worker is the
// only writer, so serialising within it is enough.
let pending: ActionLogEntry[] = [];
let chain: Promise<void> = Promise.resolve();

export function logAction(action: string, detail: string): Promise<void> {
  pending.push({ ts: Date.now(), action, detail });
  chain = chain.then(async () => {
    // An earlier write in this chain may already have taken this entry with its batch.
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      const data = await chrome.storage.local.get(ACTION_LOG_KEY);
      const log: ActionLogEntry[] = Array.isArray(data[ACTION_LOG_KEY]) ? data[ACTION_LOG_KEY] : [];
      await chrome.storage.local.set({ [ACTION_LOG_KEY]: [...batch.reverse(), ...log].slice(0, MAX_ENTRIES) });
    } catch {
      // logging must never break the automation that calls it
    }
  });
  return chain;
}

export async function getActionLog(): Promise<ActionLogEntry[]> {
  const data = await chrome.storage.local.get(ACTION_LOG_KEY);
  return Array.isArray(data[ACTION_LOG_KEY]) ? data[ACTION_LOG_KEY] : [];
}

export async function clearActionLog(): Promise<void> {
  await chrome.storage.local.remove(ACTION_LOG_KEY);
}
