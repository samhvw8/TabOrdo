import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACTION_HANDLERS } from "./actions.ts";
import {
  DASHBOARD_ACTION_POOL, ACTION_POOL_MAP, DEFAULT_DASHBOARD_IDS,
  ALT_MODE, MORE_SECTIONS, DASHBOARD_ONLY_ACTIONS,
} from "./dashboard.ts";

/**
 * Adding a dashboard tile means four things must agree: the pool (icon + label), the More panel
 * (what you can star), the click dispatcher, and the alt-click table. Nothing checked that, so
 * `/collapse` shipped absent from three of the four and `/split` was briefly in the More panel
 * with no pool row — which would have let you star a tile that then vanished from the grid.
 *
 * Three of the four are now plain data in dashboard.ts and checked by import. The dispatcher is
 * still a switch inside App.svelte, so that one case is still read as text.
 */

const poolIds = DASHBOARD_ACTION_POOL.map((a) => a.id);
const moreIds = MORE_SECTIONS.flatMap((s) => s.items.map((i) => i.action));

describe("dashboard catalogue", () => {
  it("has no duplicate pool ids", () => {
    expect(poolIds.length).toBe(new Set(poolIds).size);
    expect(ACTION_POOL_MAP.size).toBe(poolIds.length);
  });

  it("has no duplicate More panel entries", () => {
    expect(moreIds.length).toBe(new Set(moreIds).size);
  });

  it("gives every pool action a non-empty label, icon and tooltip", () => {
    for (const a of DASHBOARD_ACTION_POOL) {
      expect(a.label.length, `${a.id} label`).toBeGreaterThan(0);
      expect(a.tooltip.length, `${a.id} tooltip`).toBeGreaterThan(0);
      expect(a.icon, `${a.id} icon`).toMatch(/^<svg[\s\S]+<\/svg>$/);
    }
  });

  it("offers every pool action in the More panel, so all of them can be starred", () => {
    expect(poolIds.filter((id) => !moreIds.includes(id))).toEqual([]);
  });

  // The inverse: a More row with no pool entry renders iconless, and starring it adds an id
  // that dashboardActions filters straight back out — the tile silently never appears.
  it("backs every More panel entry with a pool action", () => {
    expect(moreIds.filter((id) => !poolIds.includes(id))).toEqual([]);
  });

  it("ships defaults that exist in the pool", () => {
    expect(DEFAULT_DASHBOARD_IDS.filter((id) => !poolIds.includes(id))).toEqual([]);
  });
});

describe("alt-click modes", () => {
  it("attaches every alt mode to a real pool action", () => {
    expect(Object.keys(ALT_MODE).filter((id) => !poolIds.includes(id))).toEqual([]);
  });

  it("labels every alt mode, so the tile can relabel while Alt is held", () => {
    for (const [id, m] of Object.entries(ALT_MODE)) {
      expect(m.label.length, `${id} alt label`).toBeGreaterThan(0);
      expect(m.tooltip.length, `${id} alt tooltip`).toBeGreaterThan(0);
    }
  });

  // Symmetry is the promise for a *pair of tiles*: alt on either reaches the other, so you can
  // drop one and keep both modes. A one-way entry means one tile silently lacks the affordance
  // its partner advertises. It does NOT apply when the target isn't a tile at all — Mute's alt
  // reaches Unmute, which is deliberately not in the pool and so has no tile to be symmetric on.
  it("keeps tile-to-tile swap pairs symmetric", () => {
    for (const [id, m] of Object.entries(ALT_MODE)) {
      if (m.query !== undefined || m.action === id) continue;
      if (!poolIds.includes(m.action)) continue;
      expect(ALT_MODE[m.action]?.action, `${id} <-> ${m.action} is one-way`).toBe(id);
    }
  });

  it("resolves an icon for every alt mode", () => {
    for (const [id, m] of Object.entries(ALT_MODE)) {
      const icon = m.icon ?? ACTION_POOL_MAP.get(m.action)?.icon;
      expect(icon, `${id} alt mode has no icon to show`).toBeTruthy();
    }
  });
});

describe("dashboard to command registry", () => {
  it("maps pool actions to a palette handler unless declared dashboard-only", () => {
    const unmapped = poolIds.filter(
      (id) => !DASHBOARD_ONLY_ACTIONS.has(id) && typeof ACTION_HANDLERS[id] !== "function"
    );
    expect(unmapped).toEqual([]);
  });

  it("keeps the dashboard-only list honest — no stale ids", () => {
    expect([...DASHBOARD_ONLY_ACTIONS].filter((id) => !poolIds.includes(id))).toEqual([]);
  });

  it("routes every alt-mode target to a handler or a dashboard-only action", () => {
    for (const [id, m] of Object.entries(ALT_MODE)) {
      const ok = typeof ACTION_HANDLERS[m.action] === "function" || DASHBOARD_ONLY_ACTIONS.has(m.action);
      expect(ok, `${id} alt target "${m.action}" reaches nothing`).toBe(true);
    }
  });
});

// The click dispatcher is still a switch in the component, so this last link is read as text.
// Lifting handleOverflowAction into lib/ would retire the file read entirely.
describe("click dispatch (reads App.svelte)", () => {
  const APP = readFileSync(new URL("../entrypoints/popup/App.svelte", import.meta.url), "utf8");
  const dispatchBlock = APP.split("async function handleOverflowAction")[1]?.split("\n  }")[0] ?? "";
  const caseIds = [...dispatchBlock.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);

  it("found the dispatcher", () => {
    expect(caseIds.length, "handleOverflowAction anchor moved").toBeGreaterThan(0);
  });

  it("dispatches every pool action", () => {
    // "pin" has its own click handler (state-dependent lock/unlock), so it needs no case.
    expect(poolIds.filter((id) => id !== "pin" && !caseIds.includes(id))).toEqual([]);
  });

  it("dispatches every alt-mode target", () => {
    const targets = [...new Set(Object.values(ALT_MODE).map((m) => m.action))];
    expect(targets.filter((id) => id !== "pin" && !caseIds.includes(id))).toEqual([]);
  });
});
