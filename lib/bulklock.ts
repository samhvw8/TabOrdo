// Suppresses the background auto-group / auto-sort / auto-ungroup listeners while a bulk
// operation rearranges tabs.
//
// One lease per owner, each under its own session key, because chrome.storage.session has no
// compare-and-swap: a writer that touches only its own key has no shared value to lose an
// update on, and an acquire that always succeeds leaves no operation unsuppressed. Release
// decays the lease to a short grace window instead of deleting it, to cover Chrome's trailing
// onUpdated echoes. The designs this replaced, and the bug each one had, are in
// .okf/architecture/bulk-lock.md.

const LOCK_PREFIX = "bulkOpLock:";
/** Sweep a key only once it has been expired at least this long — no live flow renews or
 *  releases a lease this stale, so sweeping can't clobber a concurrent write. */
const SWEEP_SLACK_MS = 60 * 1000;

/** Ceiling for one heartbeat interval of an AI run — the run renews while live (see
 *  runAIGroup), so this only bounds suppression if the holder dies. */
export const AI_LEASE_MS = 10 * 60 * 1000;
/** Popup-driven bulk actions are sub-second in practice. */
export const UI_LEASE_MS = 60 * 1000;
/** How long suppression lingers past a release, to cover Chrome's trailing onUpdated echoes. */
export const ECHO_GRACE_MS = 1000;

/** owner -> expiry timestamp. */
type Leases = Record<string, number>;

export function newLockOwner(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `owner-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/**
 * The lock keys and their values, without dragging the rest of the session area along.
 *
 * get(null) deserialises and structured-clones *every* value in the area, and isBulkLocked
 * sits on the auto-group and auto-sort paths, so that would happen per tab update, over an
 * area that also holds the undo stack and the tab-lineage map. getKeys returns names only, so
 * the values we pay to deserialise are just the handful of lock keys.
 */
async function readLockEntries(): Promise<Record<string, unknown>> {
  const area = chrome.storage.session;
  const names = (await area.getKeys()).filter((k) => k.startsWith(LOCK_PREFIX));
  return names.length > 0 ? area.get(names) : {};
}

/** Every lease in session storage, plus the keys stale enough to sweep. */
async function readAllLeases(): Promise<{ leases: Leases; staleKeys: string[] }> {
  try {
    const all = await readLockEntries();
    const leases: Leases = {};
    const staleKeys: string[] = [];
    const staleCutoff = Date.now() - SWEEP_SLACK_MS;
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(LOCK_PREFIX)) continue;
      if (typeof value === "number") {
        leases[key.slice(LOCK_PREFIX.length)] = value;
        if (value < staleCutoff) staleKeys.push(key);
      } else {
        staleKeys.push(key);
      }
    }
    return { leases, staleKeys };
  } catch {
    return { leases: {}, staleKeys: [] };
  }
}

/**
 * Add this owner's lease. Always succeeds — concurrent holders are the point, and an acquire
 * that could fail was the bug. Never shortens a lease this owner already holds. Touches only
 * this owner's key, so it cannot race another owner's acquire or release.
 */
export async function acquireBulkLock(owner: string, ttlMs: number): Promise<void> {
  const key = LOCK_PREFIX + owner;
  try {
    const data = await chrome.storage.session.get(key);
    const existing = typeof data[key] === "number" ? (data[key] as number) : 0;
    await chrome.storage.session.set({ [key]: Math.max(existing, Date.now() + ttlMs) });
  } catch {}
}

/**
 * Give up this owner's lease, but leave suppression standing for ECHO_GRACE_MS so the
 * listeners don't wake on the echoes of the operation that just finished. Other owners'
 * leases live in their own keys and are never touched.
 */
export async function releaseBulkLock(owner: string): Promise<void> {
  const key = LOCK_PREFIX + owner;
  try {
    const data = await chrome.storage.session.get(key);
    if (typeof data[key] !== "number") return;
    await chrome.storage.session.set({ [key]: Math.min(data[key] as number, Date.now() + ECHO_GRACE_MS) });
  } catch {}
}

export async function isBulkLocked(): Promise<boolean> {
  const { leases, staleKeys } = await readAllLeases();
  if (staleKeys.length > 0) {
    try {
      void chrome.storage.session.remove(staleKeys);
    } catch {}
  }
  const now = Date.now();
  return Object.values(leases).some((expiresAt) => expiresAt > now);
}

/** Run `fn` under suppression, dropping this call's lease (not anyone else's) afterwards. */
export async function withBulkLock<T>(fn: () => Promise<T>, ttlMs = UI_LEASE_MS): Promise<T> {
  const owner = newLockOwner();
  await acquireBulkLock(owner, ttlMs);
  try {
    return await fn();
  } finally {
    await releaseBulkLock(owner);
  }
}
