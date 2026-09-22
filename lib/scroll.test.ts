import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { keepVisible } from "./scroll.ts";

// No DOM in the test environment: a fake observer the test can answer, and a bare node.
let observers: FakeObserver[];

class FakeObserver {
  observed: unknown[] = [];
  disconnected = false;
  constructor(public callback: (entries: { intersectionRatio: number }[]) => void) {
    observers.push(this);
  }
  observe(el: unknown) { this.observed.push(el); }
  disconnect() { this.disconnected = true; }
  answer(ratio: number) { this.callback([{ intersectionRatio: ratio }]); }
}

function row() {
  return { parentElement: null, scrollIntoView: vi.fn() } as unknown as HTMLElement & { scrollIntoView: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("keepVisible", () => {
  it("does not scroll a selected row that is already fully visible", () => {
    const node = row();
    keepVisible(node, true);
    observers[0].answer(1);
    expect(node.scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls a selected row that is cut off", () => {
    const node = row();
    keepVisible(node, true);
    observers[0].answer(0.4);
    expect(node.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("watches nothing while the row is not selected", () => {
    keepVisible(row(), false);
    expect(observers).toEqual([]);
  });

  it("starts watching when the row becomes selected, and stops when it no longer is", () => {
    const node = row();
    const action = keepVisible(node, false);
    action.update(true);
    expect(observers).toHaveLength(1);
    action.update(false);
    expect(observers[0].disconnected).toBe(true);
  });

  it("disconnects on destroy", () => {
    const action = keepVisible(row(), true);
    action.destroy();
    expect(observers[0].disconnected).toBe(true);
  });
});
