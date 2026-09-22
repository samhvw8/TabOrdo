// The dashboard's view of the action table in commands.ts: which rows are tiles, what each one
// looks like, what an alt-click does instead, and how the More panel lists them.
//
// This was four hand-kept lists (pool, More panel, alt modes, dashboard-only set) that had to
// agree with each other and with the handlers. They drifted: the Lock Tab tile was still "Pin
// Tab" in the More panel. Everything here is now derived, so there is nothing to keep in step.

import { ACTIONS, ACTION_BY_ID, ACTION_GROUP_ORDER, UNPIN_ICON, commandRow, type ActionGroup, type ActionRow } from "./commands.ts";

const ROWS: readonly ActionRow[] = ACTIONS;

export interface TileFace { label: string; icon: string; tooltip: string; }

/** What an alt-click runs: `action`'s handler, with `query` as its argument. */
export interface AltMode extends TileFace { action: string; query?: string; }

export interface Tile extends TileFace {
  /** Also the id stored in dashboardActionIds. */
  id: string;
  group: ActionGroup;
  confirm: boolean;
  alt?: AltMode;
}

function restingFace(row: ActionRow): Tile | undefined {
  if (!row.tile) return undefined;
  const cmd = commandRow(row);
  const { label, icon, tooltip, confirm } = row.tile;
  return {
    id: row.id,
    label: label ?? row.id[0].toUpperCase() + row.id.slice(1),
    icon,
    // Only a command row may leave its tooltip out; the other two kinds are typed to carry one.
    tooltip: tooltip ?? ("description" in cmd ? `${cmd.description}.` : ""),
    group: cmd.group,
    confirm: confirm === true,
  };
}

export const TILES: Tile[] = ROWS.flatMap((row) => restingFace(row) ?? []);

export const TILE_BY_ID: ReadonlyMap<string, Tile> = new Map(TILES.map((t) => [t.id, t]));

// Alt faces borrow from the target's tile, so they resolve once every tile exists.
for (const row of ROWS) {
  const alt = "alt" in row ? row.alt : undefined;
  if (!alt) continue;
  const tile = TILE_BY_ID.get(row.id);
  if (!tile) throw new Error(`"${row.id}" has an alt-click but no tile to click`);
  const { to = row.id, query, label, tooltip, icon } = alt;
  if (!ACTION_BY_ID.has(to)) throw new Error(`Alt-click on "${row.id}" runs "${to}", which is not in the table`);
  const target = TILE_BY_ID.get(to);
  const face = { label: label ?? target?.label, tooltip: tooltip ?? target?.tooltip, icon: icon ?? target?.icon ?? tile.icon };
  if (face.label === undefined || face.tooltip === undefined) {
    throw new Error(`Alt-click on "${row.id}" runs "${to}", which has no tile to borrow a label and tooltip from`);
  }
  tile.alt = { action: to, query, label: face.label, tooltip: face.tooltip, icon: face.icon };
}

/** The Lock Tab tile's face while the active tab is held: a click releases it. */
export const UNLOCK_FACE: TileFace = { label: "Unlock", icon: UNPIN_ICON, tooltip: "Release this tab's held position." };

export const DEFAULT_DASHBOARD_IDS = ["sort", "group", "dedup", "merge", "pin"];

/** The More panel's browse list: every tile, under the same clusters the palette uses. */
export const MORE_SECTIONS: { title: ActionGroup; tiles: Tile[] }[] = ACTION_GROUP_ORDER
  .map((title) => ({ title, tiles: TILES.filter((t) => t.group === title) }))
  .filter((s) => s.tiles.length > 0);
