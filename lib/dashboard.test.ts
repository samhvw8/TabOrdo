import { describe, it, expect } from "vitest";
import { TILES, TILE_BY_ID, DEFAULT_DASHBOARD_IDS, searchTiles } from "./dashboard.ts";

// Everything in dashboard.ts is derived from the action table, so these check the derivation
// and the promises made to users, not that hand-kept lists agree.

describe("dashboard tiles", () => {
  // dashboardActionIds in chrome.storage.local holds these ids. One that stops resolving is a
  // tile that silently vanishes from someone's grid.
  it("resolves every tile id a user may have stored", () => {
    const stored = [
      "sort", "group", "branch", "branchup", "dedup", "merge", "pin", "regroup", "ungroup",
      "shuffle", "collapse", "unite", "isolate", "splitv", "splith", "splitdomain", "stack",
      "closeleft", "closeright", "closeold", "closesite", "focus", "save", "load", "archive",
      "aigroup", "readlater", "recent", "sidepanel", "split", "extract", "restore", "mute",
      "freeze", "pingroup",
    ];
    expect(stored.filter((id) => !TILE_BY_ID.has(id))).toEqual([]);
  });

  it("ships defaults that are tiles", () => {
    expect(DEFAULT_DASHBOARD_IDS.filter((id) => !TILE_BY_ID.has(id))).toEqual([]);
  });

  it("gives every tile a label, an icon and a tooltip", () => {
    for (const t of TILES) {
      expect(t.label.length, `${t.id} label`).toBeGreaterThan(0);
      expect(t.tooltip.length, `${t.id} tooltip`).toBeGreaterThan(1);
      expect(t.icon, `${t.id} icon`).toMatch(/^<svg[\s\S]+<\/svg>$/);
    }
  });
});

describe("alt-click modes", () => {
  // Symmetry is the promise for a pair of tiles: alt on either reaches the other, so you can
  // drop one and keep both modes. It does not apply when the target is not a tile — Mute's alt
  // reaches Unmute, which deliberately has no tile.
  it("keeps tile-to-tile swap pairs symmetric", () => {
    for (const t of TILES) {
      if (!t.alt || t.alt.query !== undefined || t.alt.action === t.id) continue;
      if (!TILE_BY_ID.has(t.alt.action)) continue;
      expect(TILE_BY_ID.get(t.alt.action)!.alt?.action, `${t.id} <-> ${t.alt.action} is one-way`).toBe(t.id);
    }
  });

  it("shows the target tile's face while Alt is held", () => {
    const left = TILE_BY_ID.get("closeleft")!;
    const right = TILE_BY_ID.get("closeright")!;
    expect(left.alt).toMatchObject({ action: "closeright", label: right.label, icon: right.icon, tooltip: right.tooltip });
  });
});

describe("searchTiles (More panel filter)", () => {
  const ids = (q: string) => searchTiles(q).map((t) => t.id);

  it("returns nothing to rank for an empty query", () => {
    expect(searchTiles("  ")).toEqual([]);
  });

  it("puts a label prefix match first", () => {
    expect(ids("dedup")[0]).toBe("dedup");
    expect(ids("sor")[0]).toBe("sort");
  });

  it("matches the slash command form", () => {
    expect(ids("/closeold")[0]).toBe("closeold");
  });

  it("finds a tile by a word in its tooltip", () => {
    const archive = TILE_BY_ID.get("archive")!;
    const word = archive.tooltip.split(/\W+/).find((w) => w.length > 5)!;
    expect(ids(word)).toContain("archive");
  });

  it("tolerates a missing letter", () => {
    expect(ids("dedp")).toContain("dedup");
  });

  it("tolerates a one-letter typo", () => {
    expect(ids("grpup")).toContain("group");
  });

  it("needs every word to match somewhere", () => {
    const close = ids("close old");
    expect(close[0]).toBe("closeold");
    expect(close).not.toContain("sort");
  });

  it("returns nothing for gibberish", () => {
    expect(ids("zzqxj")).toEqual([]);
  });
});
