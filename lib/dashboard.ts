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

/**
 * The More panel's filter: tiles matching every word of `query`, best first. A word scores by
 * where it lands — the start of the label or id, a word inside the label, anywhere in the label
 * or id, the tooltip or cluster, the label's letters in order ("dedp"), then one typo ("grpup").
 * An empty query returns nothing; the panel shows MORE_SECTIONS instead.
 */
export function searchTiles(query: string): Tile[] {
  const words = query.toLowerCase().replace(/^\//, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { tile: Tile; score: number; order: number }[] = [];
  TILES.forEach((tile, order) => {
    let score = 0;
    for (const word of words) {
      const s = wordScore(tile, word);
      if (s === undefined) return;
      score += s;
    }
    scored.push({ tile, score, order });
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((s) => s.tile);
}

function wordScore(tile: Tile, word: string): number | undefined {
  const label = tile.label.toLowerCase();
  const id = tile.id;
  if (label.startsWith(word) || id.startsWith(word)) return 0;
  const labelWords = label.split(/[^a-z0-9]+/).filter(Boolean);
  if (labelWords.some((w) => w.startsWith(word))) return 1;
  if (label.includes(word) || id.includes(word)) return 2;
  const rest = `${tile.tooltip} ${tile.group}`.toLowerCase();
  if (rest.includes(word)) return 3;
  if (inOrder(label, word) || inOrder(id, word)) return 4;
  // A typo is only told apart from noise once the word is long enough to mean something.
  if (word.length >= 4 && [...labelWords, id, ...rest.split(/[^a-z0-9]+/)].some((w) => oneEdit(w, word))) return 5;
  return undefined;
}

function inOrder(text: string, word: string): boolean {
  let j = 0;
  for (let i = 0; i < text.length && j < word.length; i++) if (text[i] === word[j]) j++;
  return j === word.length;
}

/** True when `a` and `b` differ by one substitution, insertion, deletion or adjacent swap. */
function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
