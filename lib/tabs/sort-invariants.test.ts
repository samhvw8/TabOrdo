import { describe, it, expect } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { buildSortFixture, loadSortFixture, stripLayout, type SortFixture } from "../testing/sort-fixtures.ts";
import { sortTabsInWindow } from "./sort.ts";
import { applyGroupPinsToWindow } from "../pin.ts";

// What a group lock promises, checked on seeded windows (lib/testing/sort-fixtures.ts) rather than
// against a recorded end state:
//  - a locked group sits at min(position, groups - 1) among its window's groups, whether that slot
//    is left or right of where it started;
//  - running the same thing again moves nothing, two locks clamped to one slot included.
// Locks that share a slot cannot all hold it, so those windows are held to the second promise only.

const SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1);

/** A window's group ids in strip order. A group split in two would appear twice. */
function groupOrder(stub: ChromeStub, windowId: number): number[] {
  return stub.openTabs
    .filter((t) => t.windowId === windowId)
    .sort((a, b) => a.index! - b.index!)
    .map((t) => t.groupId)
    .filter((id, i, all) => id !== -1 && id !== all[i - 1]);
}

interface Claim {
  groupId: number;
  /** Where the group starts, among the window's groups. */
  from: number;
  slot: number;
}

function lockClaims(stub: ChromeStub, fx: SortFixture, windowId: number): { claims: Claim[]; shared: boolean } {
  const order = groupOrder(stub, windowId);
  const claims = order.flatMap((groupId, from) => {
    const title = stub.groups.find((g) => g.id === groupId)?.title;
    const pin = fx.pinnedGroups.find((p) => p.groupTitle === title);
    return pin ? [{ groupId, from, slot: Math.min(pin.position, order.length - 1) }] : [];
  });
  return { claims, shared: new Set(claims.map((c) => c.slot)).size < claims.length };
}

/** Which group and window every tab is in, and whether it is Chrome-pinned. */
const membership = (stub: ChromeStub) =>
  stub.openTabs.map((t) => `${t.id}:${t.windowId}:${t.groupId}:${t.pinned}`).sort();

const coverage = () => ({ left: 0, right: 0, shared: 0 });
type Coverage = ReturnType<typeof coverage>;

function expectClaimsHeld(stub: ChromeStub, fx: SortFixture, before: ReturnType<typeof lockClaims>[], seen: Coverage) {
  fx.windowIds.forEach((w, i) => {
    const order = groupOrder(stub, w);
    expect(new Set(order).size, `seed ${fx.seed}, window ${w}: a group was split`).toBe(order.length);
    if (before[i].shared) {
      seen.shared++;
      return;
    }
    for (const c of before[i].claims) {
      if (c.slot > c.from) seen.right++;
      if (c.slot < c.from) seen.left++;
      expect(order.indexOf(c.groupId), `seed ${fx.seed}, window ${w}, group ${c.groupId}`).toBe(c.slot);
    }
  });
}

async function expectNoMoves(stub: ChromeStub, fx: SortFixture, label: string, run: (w: number) => Promise<unknown>) {
  const layout = stripLayout(stub, fx.windowIds);
  stub.moves.length = 0;
  stub.groupMoves.length = 0;
  for (const w of fx.windowIds) await run(w);
  expect({ moves: stub.moves, groupMoves: stub.groupMoves }, `seed ${fx.seed}, ${label}`)
    .toEqual({ moves: [], groupMoves: [] });
  expect(stripLayout(stub, fx.windowIds), `seed ${fx.seed}, ${label}`).toEqual(layout);
}

/** Enough of each case that a pass cannot come from the fixtures missing it. */
function expectCovered(seen: Coverage) {
  expect(seen.left).toBeGreaterThan(20);
  expect(seen.right).toBeGreaterThan(20);
  expect(seen.shared).toBeGreaterThan(5);
}

describe("group locks on seeded windows", () => {
  it("sortTabsInWindow puts each locked group in its slot, and sorting again moves nothing", async () => {
    const seen = coverage();
    for (const seed of SEEDS) {
      const fx = buildSortFixture(seed);
      const stub = installChromeStub();
      loadSortFixture(stub, fx);
      const before = fx.windowIds.map((w) => lockClaims(stub, fx, w));
      const members = membership(stub);

      for (const w of fx.windowIds) await sortTabsInWindow(w, fx.by);
      expectClaimsHeld(stub, fx, before, seen);
      expect(membership(stub), `seed ${seed}`).toEqual(members);

      await expectNoMoves(stub, fx, "sorting again", (w) => sortTabsInWindow(w, fx.by));
    }
    expectCovered(seen);
  });

  // /lockgroup's pass: only locked groups move, and the others keep the order they had.
  it("applyGroupPinsToWindow puts each locked group in its slot and moves nothing else", async () => {
    const seen = coverage();
    for (const seed of SEEDS) {
      const fx = buildSortFixture(seed);
      const stub = installChromeStub();
      loadSortFixture(stub, fx);
      const before = fx.windowIds.map((w) => lockClaims(stub, fx, w));
      const unlocked = (w: number) => {
        const locked = new Set(lockClaims(stub, fx, w).claims.map((c) => c.groupId));
        return groupOrder(stub, w).filter((id) => !locked.has(id));
      };
      const unlockedBefore = fx.windowIds.map(unlocked);
      const members = membership(stub);

      for (const w of fx.windowIds) await applyGroupPinsToWindow(w);
      expectClaimsHeld(stub, fx, before, seen);
      expect(fx.windowIds.map(unlocked), `seed ${seed}`).toEqual(unlockedBefore);
      expect(membership(stub), `seed ${seed}`).toEqual(members);
      expect(stub.moves, `seed ${seed}: a group moved as loose tabs`).toEqual([]);

      await expectNoMoves(stub, fx, "applying again", (w) => applyGroupPinsToWindow(w));
    }
    expectCovered(seen);
  });

  // The sort and /lockgroup agree on where a locked group goes, so locking on a sorted window and
  // the auto-sort that follows do not pull a group back and forth.
  it("applyGroupPinsToWindow finds nothing to move on a window the sort just laid out", async () => {
    for (const seed of SEEDS) {
      const fx = buildSortFixture(seed);
      const stub = installChromeStub();
      loadSortFixture(stub, fx);
      for (const w of fx.windowIds) await sortTabsInWindow(w, fx.by);
      await expectNoMoves(stub, fx, "locking after a sort", (w) => applyGroupPinsToWindow(w));
    }
  });
});
