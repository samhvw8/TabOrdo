import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSelfWriteLedger, SELF_WRITE_TTL_MS } from "./selfwrite.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSelfWriteLedger", () => {
  it("knows an id it marked, and only that id", () => {
    const ledger = createSelfWriteLedger();
    ledger.mark([1, 2]);
    expect(ledger.has(1)).toBe(true);
    expect(ledger.has(2)).toBe(true);
    expect(ledger.has(3)).toBe(false);
  });

  it("forgets an id once the TTL has passed, so a genuine change after it is not suppressed", () => {
    const ledger = createSelfWriteLedger();
    ledger.mark([1]);
    vi.advanceTimersByTime(SELF_WRITE_TTL_MS);
    expect(ledger.has(1)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ledger.has(1)).toBe(false);
  });

  it("restarts the TTL when an id is marked again", () => {
    const ledger = createSelfWriteLedger();
    ledger.mark([1]);
    vi.advanceTimersByTime(SELF_WRITE_TTL_MS - 100);
    ledger.mark([1]);
    vi.advanceTimersByTime(500);
    expect(ledger.has(1)).toBe(true);
  });

  it("keeps two ledgers apart", () => {
    const groups = createSelfWriteLedger();
    const pins = createSelfWriteLedger();
    groups.mark([1]);
    expect(pins.has(1)).toBe(false);
  });
});
