// Tab ids TabOrdo itself just wrote to, so a listener can tell the echo of its own change from
// someone else's and skip re-reacting to it. Chrome delivers the onUpdated an update causes
// *after* the call has resolved, so no "busy" flag cleared at the end of the call can catch it;
// the id has to be marked before the write and remembered for a moment after.

export const SELF_WRITE_TTL_MS = 1000;

export interface SelfWriteLedger {
  /** Call before the write, so an echo that arrives while it is still in flight is covered. */
  mark(tabIds: number[]): void;
  /** True while `tabId` was marked within the TTL. */
  has(tabId: number): boolean;
}

export function createSelfWriteLedger(ttlMs = SELF_WRITE_TTL_MS): SelfWriteLedger {
  const marks = new Map<number, number>();
  return {
    mark(tabIds) {
      const now = Date.now();
      // Entries used to be pruned only when the *same* id was asked about again, so ids nobody
      // asked about again (a long AI run marks hundreds) sat here for the life of the worker, and
      // a recycled tab id landing on one would suppress a genuine external change. Sweeping on
      // write is enough: nothing reads an entry it would not also have to write past.
      for (const [id, t] of marks) {
        if (now - t > ttlMs) marks.delete(id);
      }
      for (const id of tabIds) marks.set(id, now);
    },
    has(tabId) {
      const t = marks.get(tabId);
      if (t === undefined) return false;
      if (Date.now() - t > ttlMs) {
        marks.delete(tabId);
        return false;
      }
      return true;
    },
  };
}
