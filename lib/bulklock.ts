// Suppresses the background auto-group / auto-sort / auto-ungroup listeners while a bulk
// operation rearranges tabs.
//
// This used to be a bare `bulkOpInProgress: true|false` in chrome.storage.session with no
// notion of who held it, written from three places across two realms (the popup and the
// side panel are the same component, so popup writers exist twice over). Any popup bulk
// action finishing — or merely reopening the popup, which reset the flag on mount — cleared
// a lock the service worker was still holding for a multi-second AI grouping run.
//
// A refcount cannot fix that: chrome.storage.session has no compare-and-swap, so two realms
// doing read-increment-write both read the same value and both write the same result. An
// owner token plus an expiry can: only the holder's release is honoured, and a popup that
// disappears mid-operation lets the lease lapse instead of stranding the lock forever.

const LOCK_KEY = "bulkOpLock";

/** Long enough to outlive an on-device AI run; only matters if the holder dies. */
export const AI_LEASE_MS = 10 * 60 * 1000;
/** Popup-driven bulk actions are sub-second in practice. */
export const UI_LEASE_MS = 60 * 1000;

interface Lease {
  owner: string;
  expiresAt: number;
}

export function newLockOwner(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `owner-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

async function readLease(): Promise<Lease | null> {
  try {
    const data = await chrome.storage.session.get(LOCK_KEY);
    const lease = data[LOCK_KEY] as Lease | undefined;
    return lease && typeof lease.owner === "string" ? lease : null;
  } catch {
    return null;
  }
}

/**
 * Take the lease if it is free or expired. Returns false when someone else already holds it —
 * the caller still runs, it just isn't the owner, so its release won't cut the holder short.
 * Suppression then covers the union of both operations, which is what we actually want.
 */
export async function acquireBulkLock(owner: string, ttlMs: number): Promise<boolean> {
  const lease = await readLease();
  if (lease && lease.owner !== owner && lease.expiresAt > Date.now()) return false;
  try {
    await chrome.storage.session.set({ [LOCK_KEY]: { owner, expiresAt: Date.now() + ttlMs } });
    return true;
  } catch {
    return false;
  }
}

export async function releaseBulkLock(owner: string): Promise<void> {
  const lease = await readLease();
  // Someone else's lease, or already expired and re-taken — leave it alone.
  if (!lease || lease.owner !== owner) return;
  try {
    await chrome.storage.session.remove(LOCK_KEY);
  } catch {}
}

export async function isBulkLocked(): Promise<boolean> {
  const lease = await readLease();
  return !!lease && lease.expiresAt > Date.now();
}

/** Run `fn` holding the lock, releasing it only if we still own it. */
export async function withBulkLock<T>(fn: () => Promise<T>, ttlMs = UI_LEASE_MS): Promise<T> {
  const owner = newLockOwner();
  await acquireBulkLock(owner, ttlMs);
  try {
    return await fn();
  } finally {
    await releaseBulkLock(owner);
  }
}
