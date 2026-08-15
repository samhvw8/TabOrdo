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
// doing read-increment-write both read the same value and both write the same result.
//
// A SINGLE owner token plus an expiry was the next attempt, and it was still wrong in two
// ways that a code review caught before either bit a user:
//
//  1. A losing acquire wrote nothing, so the loser had no lease of its own — and when the
//     incumbent finished first it removed the key, leaving the loser's operation running
//     completely unsuppressed. The old header claimed suppression "covers the union of both
//     operations"; it covers the union only when the first acquirer happens to finish last.
//     That is exactly backwards for the case that matters: a quick popup action taken just
//     before a ten-minute AI run.
//  2. Release was mistimed regardless of ownership. Chrome dispatches the onUpdated echoes of
//     a bulk operation AFTER the call that caused them resolves, and scheduleAutoUngroup
//     debounces 150ms before it checks — by which point a release-on-completion lock is
//     already gone. Background-originated writes were covered by the separate selfWrites
//     ledger; popup-originated ones were covered by nothing.
//
// A SET of leases in one shared map fixed both, but left one lost-update race standing:
// acquire and release each rewrote the whole map, so a release whose read predated a
// concurrent acquire wrote the map back without the new lease — silently dropping, say, the
// AI run's ten-minute lease at the exact popup→background hand-off, leaving the run
// unsuppressed for its full duration. (The old header claimed every race "fails toward
// suppressing slightly too long"; that interleaving failed the other way.)
//
// So: one lease PER OWNER, each in its own storage key, and release DECAYS its own entry to
// a short grace window rather than deleting it. Acquire always succeeds, so no operation can
// end up unsuppressed — and since no writer ever touches another owner's key, there is no
// shared map to lose an update on. Expired keys are swept opportunistically, and only once
// they are stale by a wide margin, so a sweep can never race a live renewal.

const LOCK_PREFIX = "bulkOpLock:";
/** The pre-per-owner-key shape (single owner or owner→expiry map) under one shared key.
 *  Still honoured on read so a lease from before an extension reload keeps suppressing. */
const LEGACY_LOCK_KEY = "bulkOpLock";
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
 * sits on the auto-group and auto-sort paths — so that clone was happening per tab update,
 * over an area that also holds the undo stack (up to twenty snapshots, each covering every
 * unpinned tab) and the tab-lineage map. getKeys returns names only, so the values we pay to
 * deserialise are just the handful of lock keys.
 *
 * getKeys is Chrome 130+; older builds fall back to the read this replaced.
 */
async function readLockEntries(): Promise<Record<string, unknown>> {
  const area = chrome.storage.session;
  const getKeys = (area as { getKeys?: () => Promise<string[]> }).getKeys;
  if (typeof getKeys !== "function") return area.get(null);
  const names = (await getKeys.call(area)).filter(
    (k) => k.startsWith(LOCK_PREFIX) || k === LEGACY_LOCK_KEY
  );
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
      if (key.startsWith(LOCK_PREFIX)) {
        if (typeof value === "number") {
          leases[key.slice(LOCK_PREFIX.length)] = value;
          if (value < staleCutoff) staleKeys.push(key);
        } else {
          staleKeys.push(key);
        }
      } else if (key === LEGACY_LOCK_KEY && value && typeof value === "object" && !Array.isArray(value)) {
        const raw = value as Record<string, unknown>;
        let allStale = true;
        if (typeof raw.owner === "string" && typeof raw.expiresAt === "number") {
          leases[raw.owner] = raw.expiresAt;
          allStale = raw.expiresAt < staleCutoff;
        } else {
          for (const [owner, expiresAt] of Object.entries(raw)) {
            if (typeof expiresAt === "number") {
              leases[owner] = expiresAt;
              if (expiresAt >= staleCutoff) allStale = false;
            }
          }
        }
        if (allStale) staleKeys.push(key);
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
