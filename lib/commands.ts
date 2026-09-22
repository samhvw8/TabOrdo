export type CommandCategory = "search" | "action" | "view";

export interface CommandDefinition {
  prefix: string;
  label: string;
  description: string;
  category: CommandCategory;
  color: string;
  /** Browse cluster, actions only: the sub-heading the hint list and help page break on. */
  group?: ActionGroup;
  /** Kept working, but left out of the browse list — aliases that duplicate another command. */
  hidden?: boolean;
}

export const CATEGORY_STYLES: Record<CommandCategory, { label: string; color: string; bg: string }> = {
  search: { label: "Search", color: "text-accent-blue", bg: "bg-accent-blue/10" },
  action: { label: "Actions", color: "text-accent-orange", bg: "bg-accent-orange/10" },
  view: { label: "View", color: "text-accent-purple", bg: "bg-accent-purple/10" },
};

/** What you type is the label, so it is never written out: "/b" for a command, "@a" for a view. */
function labelled(cmds: Omit<CommandDefinition, "label">[]): CommandDefinition[] {
  return cmds.map((c) => ({ ...c, label: c.prefix.startsWith("@") ? c.prefix : `/${c.prefix}` }));
}

export const SEARCH_COMMANDS: CommandDefinition[] = labelled([
  { prefix: "b", description: "Search bookmarks", category: "search", color: "text-accent-blue" },
  { prefix: "h", description: "Search history", category: "search", color: "text-accent-cyan" },
  { prefix: "w", description: "Current window tabs", category: "search", color: "text-accent-blue" },
  { prefix: "p", description: "Chrome-pinned tabs only", category: "search", color: "text-accent-yellow" },
  { prefix: "g", description: "Current group tabs", category: "search", color: "text-accent-green" },
  { prefix: "re", description: "Regex search tabs", category: "search", color: "text-accent-purple" },
  { prefix: "rl", description: "Search Reading List", category: "search", color: "text-accent-green" },
  { prefix: "rc", description: "Search recently closed tabs", category: "search", color: "text-accent-blue" },
]);

// The action table: one row per slash command and per dashboard tile. The palette's command
// list, its browse clusters, the tile grid, the More panel and the alt-click modes are all
// derived from it (below, and in dashboard.ts). The handlers are keyed by the same ids in
// actions.ts, whose types make a row without a handler, or a handler without a row, a
// compile error.
//
// Handlers stay out of the rows because this module is a leaf: search.ts's parser and the hint
// component import it, and the handlers import lib/tabs, the workspace and session stores, and
// search.ts itself — rows holding them would make commands → actions → search → commands a
// cycle, and search.ts reads TRIAGE_COMMANDS while it loads.

/** Browse clusters, in the order both browse surfaces render them. */
export const ACTION_GROUP_ORDER = ["Organize", "Windows", "Order", "Close", "Memory", "Session", "Audio", "Other"] as const;
export type ActionGroup = (typeof ACTION_GROUP_ORDER)[number];

export interface TileDef {
  /** Defaults to the id, capitalised. */
  label?: string;
  icon: string;
  /** Defaults to the row's description. */
  tooltip?: string;
  /**
   * The first click arms and a second within 3 s runs. For tiles that close tabs or throw away
   * the window's arrangement: one stray click on a grid should not do that. A typed command is
   * deliberate enough to skip it, and undo covers both.
   */
  confirm?: true;
  /** The tile runs its own handler (TILE_HANDLERS in actions.ts) instead of the bare command. */
  own?: true;
}

/**
 * Second mode for an alt-click. `to` names the row whose handler runs, `query` its argument.
 * The face shown while Alt is held defaults to the target tile's, so a swap pair states
 * nothing twice; a target with no tile of its own has to supply one.
 */
export interface AltDef {
  to?: string;
  query?: string;
  label?: string;
  tooltip?: string;
  icon?: string;
}

interface CommandRow {
  /** What you type after "/", and the tile id stored in dashboardActionIds. Never rename one. */
  id: string;
  description: string;
  group: ActionGroup;
  color: string;
  hidden?: true;
  tile?: TileDef;
  alt?: AltDef;
}

/** Another command under an older name. Runs the target's handler, off the browse list. */
interface AliasRow {
  id: string;
  aliasOf: string;
  tile?: TileDef & { label: string; tooltip: string };
  alt?: AltDef;
}

/** A tile with no slash command behind it. */
interface TileOnlyRow {
  id: string;
  group: ActionGroup;
  tile: TileDef & { tooltip: string; own: true };
}

export type ActionRow = CommandRow | AliasRow | TileOnlyRow;

const ICON = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const PIN_BODY = '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1z"/>';
const SPEAKER = '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/>';

/** The Lock Tab tile's face once the active tab is held; see dashboard.ts. */
export const UNPIN_ICON = ICON('<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v2.34"/><path d="m2 2 20 20"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76"/>');

export const ACTIONS = [
  { id: "close", description: "Close matching tabs", group: "Close", color: "text-accent-red" },
  { id: "closeleft", description: "Close tabs to left of active", group: "Close", color: "text-accent-red",
    tile: { label: "Close Left", icon: ICON('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'), confirm: true },
    alt: { to: "closeright" } },
  { id: "closeright", description: "Close tabs to right of active", group: "Close", color: "text-accent-red",
    tile: { label: "Close Right", icon: ICON('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'), confirm: true },
    alt: { to: "closeleft" } },
  { id: "closeold", description: "Close tabs older than 7 days", group: "Close", color: "text-accent-red",
    tile: { label: "Close Old", icon: ICON('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'), confirm: true } },
  { id: "closesite", description: "Close all tabs from same site", group: "Close", color: "text-accent-red",
    tile: { label: "Close Site", icon: ICON('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'), tooltip: "Close other tabs from this domain.", confirm: true } },
  // The tile opens the archive page (App.svelte); /archive archives what the query matched.
  { id: "archive", description: "Archive matching tabs", group: "Close", color: "text-accent-yellow",
    tile: { icon: ICON('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'), tooltip: "Open archive." } },
  { id: "group", description: "Group matching tabs", group: "Organize", color: "text-accent-orange",
    tile: { label: "Group+", icon: ICON('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/>'), tooltip: "Group ungrouped tabs by domain.", own: true } },
  { id: "branch", description: "Group this tab and every tab opened from it", group: "Organize", color: "text-accent-orange",
    tile: { icon: ICON('<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'), tooltip: "Group this tab and every tab opened from it. Alt-click to start one level up." },
    alt: { to: "branchup" } },
  { id: "branchup", description: "Group its parent's branch (parent + siblings)", group: "Organize", color: "text-accent-orange",
    tile: { label: "Branch Up", icon: ICON('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'), tooltip: "Group the parent tab's branch: parent, siblings, and everything they opened." },
    // Branch's own tooltip advertises the alt-click back up, which is the one thing this face is not.
    alt: { to: "branch", tooltip: "Group this tab and every tab opened from it." } },
  { id: "parent", description: "Switch to the tab that opened this one", group: "Organize", color: "text-accent-orange" },
  { id: "merge", description: "Pull every tab from other windows into this one", group: "Windows", color: "text-accent-orange",
    tile: { icon: ICON('<path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/>'), tooltip: "Move all tabs from other windows here.", confirm: true } },
  { id: "sort", description: "Sort tabs (domain|title|url)", group: "Organize", color: "text-accent-orange",
    tile: { label: "Sort All", icon: ICON('<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>'), tooltip: "Sort tabs by domain." } },
  { id: "dedup", description: "Remove duplicate tabs", group: "Organize", color: "text-accent-orange",
    tile: { icon: ICON('<rect width="8" height="14" x="2" y="6" rx="2"/><rect width="8" height="14" x="14" y="4" rx="2" opacity="0.5"/><path d="m15 2-3 3-3-3"/>'), tooltip: "Close duplicate tabs.", confirm: true } },
  { id: "mute", description: "Mute matching tabs", group: "Audio", color: "text-accent-purple",
    tile: { label: "Mute Tab", icon: ICON(`${SPEAKER}<line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>`), tooltip: "Mute the active tab. Alt-click to unmute." },
    // Unmute is deliberately not a tile, so there is no face to borrow.
    alt: { to: "unmute", label: "Unmute", tooltip: "Unmute the active tab.", icon: ICON(`${SPEAKER}<path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 5.6a9 9 0 0 1 0 12.7"/>`) } },
  { id: "unmute", description: "Unmute matching tabs", group: "Audio", color: "text-accent-purple" },
  { id: "split", description: "Send the active tab to a new window", group: "Windows", color: "text-accent-cyan",
    tile: { label: "Split Out", icon: ICON('<rect width="10" height="18" x="3" y="3" rx="2"/><path d="M14 12h7"/><path d="m18 9 3 3-3 3"/>') } },
  { id: "extract", description: "Send the active tab out of its group to a new window", group: "Windows", color: "text-accent-cyan",
    tile: { icon: ICON('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>') } },
  { id: "shuffle", description: "Randomly reorder tabs", group: "Order", color: "text-accent-purple",
    tile: { icon: ICON('<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>') } },
  { id: "unite", description: "Pull same-domain tabs into this window", group: "Windows", color: "text-accent-cyan",
    tile: { icon: ICON('<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>'), tooltip: "Pull same-domain tabs here." },
    alt: { to: "isolate" } },
  { id: "isolate", description: "Send same-domain tabs to a new window", group: "Windows", color: "text-accent-cyan",
    tile: { icon: ICON('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'), tooltip: "Move domain to new window." },
    alt: { to: "unite" } },
  { id: "splitv", description: "Arrange two windows side by side (no tabs move)", group: "Windows", color: "text-accent-blue",
    tile: { label: "Split V", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>'), tooltip: "Side by side windows." },
    alt: { to: "splith" } },
  { id: "splith", description: "Arrange two windows top and bottom (no tabs move)", group: "Windows", color: "text-accent-blue",
    tile: { label: "Split H", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/>'), tooltip: "Top/bottom windows." },
    alt: { to: "splitv" } },
  { id: "splitdomain", description: "Send each domain to its own window", group: "Windows", color: "text-accent-blue",
    tile: { label: "Split Dom", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'), tooltip: "One window per domain." } },
  { id: "stack", description: "Arrange all windows aligned left (no tabs move)", group: "Windows", color: "text-accent-blue",
    tile: { icon: ICON('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m2 12 8.58 3.91a2 2 0 0 0 1.66 0L21 12"/>'), tooltip: "Stack windows to left." } },
  // The tile runs /unfocus instead while a workspace is saved (App.svelte), and only the closing
  // direction confirms.
  { id: "focus", description: "Save tabs & start fresh", group: "Session", color: "text-accent-green",
    tile: { icon: ICON('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'), confirm: true } },
  { id: "unfocus", description: "Restore saved workspace", group: "Session", color: "text-accent-green" },
  { id: "save", description: "Export tabs to text file", group: "Session", color: "text-accent-yellow",
    tile: { icon: ICON('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'), tooltip: "Export tabs as text." },
    alt: { to: "load" } },
  { id: "load", description: "Load tabs from text file", group: "Session", color: "text-accent-yellow",
    tile: { icon: ICON('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>'), tooltip: "Import tabs from text." },
    alt: { to: "save" } },
  { id: "feedback", description: "Submit feedback or bugs", group: "Other", color: "text-accent-purple" },
  { id: "discard", description: "Unload tabs from memory (reload on return)", group: "Memory", color: "text-accent-pink" },
  { id: "reload", description: "Reload matching tabs", group: "Memory", color: "text-accent-green" },
  { id: "vol", description: "Set volume (0-100) for matching tabs", group: "Audio", color: "text-accent-purple" },
  { id: "ungroup", description: "Ungroup matching tabs (no query = current tab)", group: "Organize", color: "text-accent-orange",
    tile: { icon: ICON('<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/>'), tooltip: "Remove all tab groups.", own: true } },
  { id: "regroup", group: "Organize",
    tile: { icon: ICON('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>'), tooltip: "Ungroup all, then regroup from scratch.", own: true } },
  { id: "collapse", description: "Collapse all tab groups", group: "Organize", color: "text-accent-purple",
    tile: { icon: ICON('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>') } },
  { id: "move", description: "Move tab to position (^ $ or number)", group: "Order", color: "text-accent-cyan" },
  { id: "movegroup", description: "Move group to position (^ $ or number)", group: "Order", color: "text-accent-cyan" },
  // "Lock", not "pin": Chrome already owns the word pin for its own tab pinning, and users
  // typing /pin expected that. The old prefixes still work, they just aren't advertised — and
  // the two lock tiles keep the old ids, because those are what users have stored.
  { id: "lock", description: "Hold tab at a position in its group (^ $ or number)", group: "Order", color: "text-accent-yellow" },
  { id: "unlock", description: "Release a tab's held position", group: "Order", color: "text-accent-yellow" },
  { id: "lockgroup", description: "Hold group at a position in the window (^ $ or number)", group: "Order", color: "text-accent-yellow" },
  { id: "unlockgroup", description: "Release a group's held position", group: "Order", color: "text-accent-yellow" },
  // The tile toggles, releasing a held tab (App.svelte); its faces for that live in dashboard.ts.
  { id: "pin", aliasOf: "lock",
    tile: { label: "Lock Tab", icon: ICON(PIN_BODY), tooltip: "Hold current tab at its position in the group." },
    alt: { query: "^", label: "Lock Top", tooltip: "Hold tab at the first position in its group.", icon: ICON(`${PIN_BODY}<path d="M5 3h14"/>`) } },
  { id: "unpin", aliasOf: "unlock" },
  { id: "pingroup", aliasOf: "lockgroup",
    tile: { label: "Lock Group", icon: ICON(`${PIN_BODY}<path d="M3 3h18"/>`), tooltip: "Hold the active group at its position. Alt-click for first." },
    alt: { query: "^", label: "Lock Grp Top", tooltip: "Hold the active group at the first position." } },
  { id: "unpingroup", aliasOf: "unlockgroup" },
  { id: "readlater", description: "Save matching tabs to Reading List", group: "Session", color: "text-accent-green",
    tile: { label: "Read Later", icon: ICON('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="m9 9.5 2 2 4-4"/>'), tooltip: "Save active tab to Reading List." } },
  // The tile opens the palette on /recent so the list has somewhere to show (App.svelte).
  { id: "recent", description: "Show recently closed tabs", group: "Session", color: "text-accent-blue",
    tile: { icon: ICON('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>') } },
  { id: "restore", description: "Restore last closed tab(s)", group: "Session", color: "text-accent-blue",
    tile: { icon: ICON('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'), tooltip: "Reopen the last closed tab or window." } },
  // No handler: App.svelte hands it to the background before taking the bulk lock.
  { id: "aigroup", description: "AI-powered smart grouping (on-device)", group: "Organize", color: "text-accent-cyan",
    tile: { label: "AI Group", icon: ICON('<path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="12" cy="15" r="2"/><path d="M12 13v-2"/>'), tooltip: "Smart group tabs with on-device AI." } },
  { id: "sidepanel", description: "Open TabOrdo in Side Panel", group: "Other", color: "text-accent-blue",
    tile: { label: "Side Panel", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>') } },
  // Kept working for anyone who learned it, but off the browse list: presenting it as a separate
  // capability implied a freeze TabOrdo never did. With matches it discards them like /discard;
  // bare, it unloads every inactive tab, which is what its tile is for.
  { id: "freeze", description: "Alias of /discard", group: "Memory", color: "text-accent-cyan", hidden: true,
    tile: { label: "Unload", icon: ICON('<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>'), tooltip: "Drop inactive tabs from memory." } },
] as const satisfies readonly ActionRow[];

type Row = (typeof ACTIONS)[number];
/** Slash commands whose handler is in ACTION_HANDLERS: all but the aliases and /aigroup. */
export type HandledCommand = Exclude<Extract<Row, { description: string }>["id"], "aigroup">;
/** Tiles whose handler is in TILE_HANDLERS. */
export type OwnTile = Extract<Row, { tile: { own: true } }>["id"];

export const ACTION_BY_ID: ReadonlyMap<string, ActionRow> = new Map(ACTIONS.map((r) => [r.id, r]));

/** The command row an alias stands for, or the row itself. Throws on a dangling alias. */
export function commandRow(row: ActionRow): CommandRow | TileOnlyRow {
  if (!("aliasOf" in row)) return row;
  const target = ACTION_BY_ID.get(row.aliasOf);
  if (!target || !("description" in target)) {
    throw new Error(`/${row.id} is an alias of /${row.aliasOf}, which is not a command`);
  }
  return target;
}

export const ACTION_COMMANDS: CommandDefinition[] = labelled(ACTIONS.flatMap((row) => {
  const cmd = commandRow(row);
  if (!("description" in cmd)) return [];
  return [{
    prefix: row.id,
    description: "aliasOf" in row ? `Alias of /${cmd.id}` : cmd.description,
    category: "action" as const,
    color: cmd.color,
    group: cmd.group,
    hidden: "aliasOf" in row || cmd.hidden,
  }];
}));

export const VIEW_COMMANDS: CommandDefinition[] = labelled([
  { prefix: "@", description: "Smart tab triage", category: "view", color: "text-accent-cyan" },
]);

export const TRIAGE_COMMANDS: CommandDefinition[] = labelled([
  { prefix: "@a", description: "Tabs playing audio", category: "view", color: "text-accent-red" },
  { prefix: "@m", description: "Muted tabs", category: "view", color: "text-accent-purple" },
  { prefix: "@d", description: "Duplicate tabs", category: "view", color: "text-accent-orange" },
  { prefix: "@r", description: "Recently active tabs", category: "view", color: "text-accent-blue" },
  { prefix: "@s", description: "Unloaded tabs (reload when you return)", category: "view", color: "text-accent-pink" },
  { prefix: "@u", description: "Ungrouped tabs", category: "view", color: "text-accent-orange" },
  { prefix: "@b", description: "This tab's branch — everything opened from it", category: "view", color: "text-accent-orange" },
  { prefix: "@f", description: "Tabs Chrome paused to save memory", category: "view", color: "text-accent-cyan" },
  { prefix: "@shared", description: "Tabs in shared groups", category: "view", color: "text-accent-green" },
]);

export const ALL_COMMANDS = [...SEARCH_COMMANDS, ...ACTION_COMMANDS, ...VIEW_COMMANDS];

/**
 * Bucket a category's commands into their browse clusters, in ACTION_GROUP_ORDER. Anything
 * without a cluster lands in a trailing unnamed bucket rather than disappearing.
 */
export function groupCommands(cmds: CommandDefinition[]): { group: string; commands: CommandDefinition[] }[] {
  const buckets = new Map<string, CommandDefinition[]>();
  for (const c of cmds) {
    const g = c.group ?? "";
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(c);
  }
  const out: { group: string; commands: CommandDefinition[] }[] = [];
  for (const g of ACTION_GROUP_ORDER) {
    const list = buckets.get(g);
    if (list?.length) out.push({ group: g, commands: list });
  }
  const rest = buckets.get("");
  if (rest?.length) out.push({ group: "", commands: rest });
  return out;
}

function fuzzyMatch(text: string, pattern: string): boolean {
  let j = 0;
  for (let i = 0; i < text.length && j < pattern.length; i++) {
    if (text[i] === pattern[j]) j++;
  }
  return j === pattern.length;
}

function fuzzyFilterCommands(commands: CommandDefinition[], typed: string): CommandDefinition[] {
  const exact = commands.filter(
    (cmd) => cmd.prefix.startsWith(typed) || cmd.label.toLowerCase().includes(typed)
  );
  if (exact.length > 0) return exact;
  return commands.filter(
    (cmd) => fuzzyMatch(cmd.prefix, typed) || fuzzyMatch(cmd.description.toLowerCase(), typed)
  );
}

export function matchCommands(input: string): CommandDefinition[] {
  if (input.startsWith("@")) {
    const typed = input.toLowerCase();
    if (typed === "@") return TRIAGE_COMMANDS.filter((c) => !c.hidden);
    return fuzzyFilterCommands(TRIAGE_COMMANDS, typed.slice(1));
  }
  if (!input.startsWith("/")) return [];
  const typed = input.slice(1).toLowerCase();
  // Bare "/" is the browse list — hidden aliases stay out of it, but still resolve once typed.
  if (!typed) return ALL_COMMANDS.filter((c) => !c.hidden);

  return fuzzyFilterCommands(ALL_COMMANDS, typed);
}
