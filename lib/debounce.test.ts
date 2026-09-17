import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncer } from "./debounce.ts";

describe("createDebouncer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("runs only the last call scheduled within the wait", () => {
    const d = createDebouncer(200);
    const ran: string[] = [];
    d.schedule(() => ran.push("r"));
    vi.advanceTimersByTime(150);
    d.schedule(() => ran.push("re"));
    vi.advanceTimersByTime(150);
    d.schedule(() => ran.push("rea"));
    expect(ran).toEqual([]);
    expect(d.pending).toBe(true);
    vi.advanceTimersByTime(200);
    expect(ran).toEqual(["rea"]);
    expect(d.pending).toBe(false);
  });

  it("drops a cancelled call", () => {
    const d = createDebouncer(200);
    const fn = vi.fn();
    d.schedule(fn);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(d.pending).toBe(false);
  });

  it("flush runs the pending call at once and waits for it, and the timer doesn't run it again", async () => {
    const d = createDebouncer(200);
    let done = false;
    const fn = vi.fn(async () => { await Promise.resolve(); done = true; });
    d.schedule(fn);
    await d.flush();
    expect(done).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush waits for a call the timer already started", async () => {
    const d = createDebouncer(200);
    let release!: () => void;
    let done = false;
    d.schedule(() => new Promise<void>((r) => { release = r; }).then(() => { done = true; }));
    vi.advanceTimersByTime(200);
    const flushed = d.flush();
    let settled = false;
    void flushed.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await flushed;
    expect(done).toBe(true);
  });

  it("flush with nothing scheduled or running resolves", async () => {
    await expect(createDebouncer(200).flush()).resolves.toBeUndefined();
  });
});
