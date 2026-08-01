import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { installChromeStub } from "./testing/chrome-stub.ts";
import {
  acquireBulkLock,
  releaseBulkLock,
  isBulkLocked,
  newLockOwner,
  withBulkLock,
  ECHO_GRACE_MS,
} from "./bulklock.ts";

beforeEach(() => {
  installChromeStub();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Release leaves an echo-grace window standing; step past it to reach a quiet state. */
async function settle(): Promise<void> {
  vi.advanceTimersByTime(ECHO_GRACE_MS + 1);
}

describe("bulk lock", () => {
  it("reports locked while a lease is held, unlocked once the grace window lapses", async () => {
    vi.useFakeTimers();
    const owner = newLockOwner();
    expect(await isBulkLocked()).toBe(false);
    await acquireBulkLock(owner, 60_000);
    expect(await isBulkLocked()).toBe(true);
    await releaseBulkLock(owner);
    await settle();
    expect(await isBulkLocked()).toBe(false);
  });

  // Chrome dispatches a bulk operation's onUpdated echoes after the call that caused them
  // resolves, and scheduleAutoUngroup debounces 150ms before checking. A release that dropped
  // suppression immediately left those echoes to wake the very listeners it was suppressing.
  it("keeps suppressing briefly after release, to cover the trailing echoes", async () => {
    vi.useFakeTimers();
    const owner = newLockOwner();
    await acquireBulkLock(owner, 60_000);
    await releaseBulkLock(owner);

    expect(await isBulkLocked()).toBe(true);
    vi.advanceTimersByTime(ECHO_GRACE_MS - 50);
    expect(await isBulkLocked()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(await isBulkLocked()).toBe(false);
  });

  // The regression that let /aigroup run unsuppressed. The SHORT holder acquires first, so it
  // is the incumbent; under the old single-owner lease the long holder's acquire failed and
  // wrote nothing, and then the incumbent's own release removed the key outright.
  it("a short holder acquiring FIRST cannot cut a long holder short", async () => {
    vi.useFakeTimers();
    const popup = newLockOwner();
    const background = newLockOwner();

    await acquireBulkLock(popup, 60_000);
    await acquireBulkLock(background, 10 * 60_000);
    await releaseBulkLock(popup);

    vi.advanceTimersByTime(90_000);
    expect(await isBulkLocked()).toBe(true);

    await releaseBulkLock(background);
    await settle();
    expect(await isBulkLocked()).toBe(false);
  });

  it("ignores a release from an owner that holds no lease", async () => {
    vi.useFakeTimers();
    const background = newLockOwner();
    const popup = newLockOwner();

    await acquireBulkLock(background, 60_000);
    await releaseBulkLock(popup);

    vi.advanceTimersByTime(30_000);
    expect(await isBulkLocked()).toBe(true);
    await releaseBulkLock(background);
    await settle();
    expect(await isBulkLocked()).toBe(false);
  });

  it("treats an expired lease as unlocked, so a dead holder cannot strand it", async () => {
    vi.useFakeTimers();
    await acquireBulkLock(newLockOwner(), 1_000);
    expect(await isBulkLocked()).toBe(true);

    vi.advanceTimersByTime(1_001);
    expect(await isBulkLocked()).toBe(false);
  });

  it("never shortens a lease the same owner already holds", async () => {
    vi.useFakeTimers();
    const owner = newLockOwner();
    await acquireBulkLock(owner, 60_000);
    await acquireBulkLock(owner, 1_000);

    vi.advanceTimersByTime(5_000);
    expect(await isBulkLocked()).toBe(true);
  });

  it("releases the lock when the wrapped function throws", async () => {
    vi.useFakeTimers();
    await expect(
      withBulkLock(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await settle();
    expect(await isBulkLocked()).toBe(false);
  });

  it("holds the lock for the duration of the wrapped function", async () => {
    vi.useFakeTimers();
    let lockedDuring = false;
    await withBulkLock(async () => {
      lockedDuring = await isBulkLocked();
    });
    expect(lockedDuring).toBe(true);
    await settle();
    expect(await isBulkLocked()).toBe(false);
  });

  it("a nested quick op does not unlock the outer holder", async () => {
    vi.useFakeTimers();
    const outer = newLockOwner();
    await acquireBulkLock(outer, 60_000);

    await withBulkLock(async () => {});
    await settle();

    expect(await isBulkLocked()).toBe(true);
  });

  it("honours a lease left behind in the previous single-owner shape", async () => {
    vi.useFakeTimers();
    const stub = installChromeStub();
    stub.sessionData["bulkOpLock"] = { owner: "legacy", expiresAt: Date.now() + 30_000 };

    expect(await isBulkLocked()).toBe(true);
    vi.advanceTimersByTime(30_001);
    expect(await isBulkLocked()).toBe(false);
  });
});
