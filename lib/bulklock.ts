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
// So: a SET of leases keyed by owner, and release DECAYS its own entry to a short grace
// window rather than deleting it. Acquire always succeeds, so no operation can end up
// unsuppressed. Read-modify-write races remain — no CAS exists — but every outcome now fails
// toward suppressing slightly too long, which self-heals on expiry, instead of toward running
// an unsuppressed bulk operation.

const LOCK_KEY = "bulkOpLock";

/** Long enough to outlive an on-device AI run; only matters if the holder dies. */
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

async function readLeases(): Promise<Leases> {
  try {
    const data = await chrome.storage.session.get(LOCK_KEY);
    const raw = data[LOCK_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    // A lease written by the previous single-owner shape, still in session storage after an
    // extension reload. Honour its expiry rather than dropping suppression on the floor.
    if (typeof raw.owner === "string" && typeof raw.expiresAt === "number") {
      return { [raw.owner]: raw.expiresAt };
    }
    const out: Leases = {};
    for (const [owner, expiresAt] of Object.entries(raw)) {
      if (typeof expiresAt === "number") out[owner] = expiresAt;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeLeases(leases: Leases): Promise<void> {
  const now = Date.now();
  const live: Leases = {};
  for (const [owner, expiresAt] of Object.entries(leases)) {
    if (expiresAt > now) live[owner] = expiresAt;
  }
  try {
    if (Object.keys(live).length === 0) await chrome.storage.session.remove(LOCK_KEY);
    else await chrome.storage.session.set({ [LOCK_KEY]: live });
  } catch {}
}

/**
 * Add this owner's lease. Always succeeds — concurrent holders are the point, and an acquire
 * that could fail was the bug. Never shortens a lease this owner already holds.
 */
export async function acquireBulkLock(owner: string, ttlMs: number): Promise<void> {
  const leases = await readLeases();
  leases[owner] = Math.max(leases[owner] ?? 0, Date.now() + ttlMs);
  await writeLeases(leases);
}

/**
 * Give up this owner's lease, but leave suppression standing for ECHO_GRACE_MS so the
 * listeners don't wake on the echoes of the operation that just finished. Other owners'
 * leases are untouched — a short operation can no longer cut a long one short.
 */
export async function releaseBulkLock(owner: string): Promise<void> {
  const leases = await readLeases();
  if (leases[owner] === undefined) return;
  leases[owner] = Math.min(leases[owner], Date.now() + ECHO_GRACE_MS);
  await writeLeases(leases);
}

export async function isBulkLocked(): Promise<boolean> {
  const now = Date.now();
  return Object.values(await readLeases()).some((expiresAt) => expiresAt > now);
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
