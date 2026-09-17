import { describe, it, expect } from "vitest";
import { installChromeStub } from "../testing/chrome-stub.ts";
import { buildSortFixture, loadSortFixture, stripLayout } from "../testing/sort-fixtures.ts";
import { sortTabsInWindow, organizeWindow } from "./sort.ts";
import { applyAllGroupPins } from "../pin.ts";
import expected from "./sort-endstate.expected.json";

// Characterization, not specification. sort-endstate.expected.json is what sortTabsInWindow and
// organizeWindow + applyAllGroupPins produced on these seeded windows BEFORE the auto-sort path
// was reworked to skip no-op moves and lay pinned groups out itself. That rework is meant to
// remove calls, never to move a tab somewhere else, and this is the check that it did not.
//
// Some recorded layouts are not what the pins ask for: applyGroupPinsToWindow computes a
// rightward move's index before the moving group is lifted out, so the group lands past its
// slot (seed 132 even splits a group in the stub). Those are recorded as-is on purpose. Do not
// re-record this file to make a change pass; a change that is meant to move tabs differently
// should say so and update the affected seeds by hand.

type Layouts = Record<string, Record<string, string>>;
const SEEDS = Object.keys(expected).map(Number);

describe("auto-sort end state", () => {
  it("covers the seeds it was recorded with", () => {
    expect(SEEDS.length).toBe(160);
  });

  it("sortTabsInWindow lands every window where it did before", async () => {
    for (const seed of SEEDS) {
      const fx = buildSortFixture(seed);
      const want = (expected as Record<string, Layouts>)[seed];
      const stub = installChromeStub();
      loadSortFixture(stub, fx);

      for (const w of fx.windowIds) await sortTabsInWindow(w, fx.by);
      expect(stripLayout(stub, fx.windowIds), `seed ${seed}, first sort`).toEqual(want.sort);

      for (const w of fx.windowIds) await sortTabsInWindow(w, fx.by);
      expect(stripLayout(stub, fx.windowIds), `seed ${seed}, sorting again`).toEqual(want.resort);
    }
  });

  // groupTabsByDomain's tail: every window organized, then the group pins applied once.
  it("organizeWindow then applyAllGroupPins lands every window where it did before", async () => {
    for (const seed of SEEDS) {
      const fx = buildSortFixture(seed);
      const want = (expected as Record<string, Layouts>)[seed];
      const stub = installChromeStub();
      loadSortFixture(stub, fx);

      for (const w of fx.windowIds) await organizeWindow(w, fx.by);
      await applyAllGroupPins();
      expect(stripLayout(stub, fx.windowIds), `seed ${seed}`).toEqual(want.organize);
    }
  });
});
