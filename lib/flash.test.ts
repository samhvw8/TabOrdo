import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFlash } from "./flash.ts";

describe("createFlash", () => {
  let shown: string;
  const flash = () => createFlash((m) => { shown = m; }, 3000);
  beforeEach(() => { vi.useFakeTimers(); shown = ""; });
  afterEach(() => { vi.useRealTimers(); });

  it("shows a message and clears it after the default time", () => {
    const f = flash();
    f("Saved");
    expect(shown).toBe("Saved");
    vi.advanceTimersByTime(2999);
    expect(shown).toBe("Saved");
    vi.advanceTimersByTime(1);
    expect(shown).toBe("");
  });

  it("gives a newer message its full time instead of the older one's remainder", () => {
    const f = flash();
    f("First");
    vi.advanceTimersByTime(2000);
    f("Second");
    vi.advanceTimersByTime(1500);
    expect(shown).toBe("Second");
    vi.advanceTimersByTime(1500);
    expect(shown).toBe("");
  });

  it("takes a per-message time", () => {
    const f = flash();
    f("Error: failed", 5000);
    vi.advanceTimersByTime(4999);
    expect(shown).toBe("Error: failed");
    vi.advanceTimersByTime(1);
    expect(shown).toBe("");
  });
});
