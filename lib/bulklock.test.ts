import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { installChromeStub } from "./testing/chrome-stub.ts";
import {
  acquireBulkLock,
  releaseBulkLock,
  isBulkLocked,
  newLockOwner,
  withBulkLock,
} from "./bulklock.ts";

beforeEach(() => {
  installChromeStub();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bulk lock", () => {
  it("reports locked while a lease is held, unlocked after release", async () => {
    const owner = newLockOwner();
    expect(await isBulkLocked()).toBe(false);
    await acquireBulkLock(owner, 60_000);
    expect(await isBulkLocked()).toBe(true);
    await releaseBulkLock(owner);
    expect(await isBulkLocked()).toBe(false);
  });

  // The whole point of the owner token: the popup finishing a quick Merge, or being
  // reopened, must not unlock the background's still-running AI grouping.
  it("ignores a release from a different owner", async () => {
    const background = newLockOwner();
    const popup = newLockOwner();

    await acquireBulkLock(background, 60_000);
    await releaseBulkLock(popup);

    expect(await isBulkLocked()).toBe(true);
    await releaseBulkLock(background);
    expect(await isBulkLocked()).toBe(false);
  });

  it("treats an expired lease as unlocked, so a dead holder cannot strand it", async () => {
    vi.useFakeTimers();
    await acquireBulkLock(newLockOwner(), 1_000);
    expect(await isBulkLocked()).toBe(true);

    vi.advanceTimersByTime(1_001);
    expect(await isBulkLocked()).toBe(false);
  });

  it("releases the lock when the wrapped function throws", async () => {
    await expect(
      withBulkLock(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await isBulkLocked()).toBe(false);
  });

  it("holds the lock for the duration of the wrapped function", async () => {
    let lockedDuring = false;
    await withBulkLock(async () => {
      lockedDuring = await isBulkLocked();
    });
    expect(lockedDuring).toBe(true);
    expect(await isBulkLocked()).toBe(false);
  });

  it("a nested quick op does not unlock the outer holder", async () => {
    const outer = newLockOwner();
    await acquireBulkLock(outer, 60_000);

    // A popup action running concurrently takes and drops its own lease.
    await withBulkLock(async () => {});

    // The outer lease is gone from storage only if its owner released it — it did not.
    expect(await isBulkLocked()).toBe(true);
  });
});
