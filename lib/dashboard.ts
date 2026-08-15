// Dashboard tile catalogue: what can sit on the action grid, what it looks like, where it is
// offered, and what an alt-click does instead.
//
// These four lists have to agree with each other and with ACTION_HANDLERS, and nothing checked
// that while they lived inside App.svelte — /collapse ended up absent from three of the four,
// and /split was added to the More panel with no pool row, which would have let you star a tile
// that then vanished. Out here they are ordinary data that dashboard.test.ts can import.

const ICON = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const PIN_BODY = '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1z"/>';
const SPEAKER = '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/>';

// Branch out / gather up. Kept as constants rather than inlined because the two tiles are an
// alt-click pair, so each one has to show the other's icon while Alt is held.
const BRANCH_ICON = ICON('<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>');
const BRANCH_UP_ICON = ICON('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>');

export const PIN_ICON = ICON(PIN_BODY);
export const UNPIN_ICON = ICON('<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v2.34"/><path d="m2 2 20 20"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76"/>');
export const PIN_TOP_ICON = ICON(`${PIN_BODY}<path d="M5 3h14"/>`);
export const MUTE_ICON = ICON(`${SPEAKER}<line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>`);
export const UNMUTE_ICON = ICON(`${SPEAKER}<path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 5.6a9 9 0 0 1 0 12.7"/>`);

export interface DashActionDef { id: string; label: string; icon: string; tooltip: string; }

export const DASHBOARD_ACTION_POOL: DashActionDef[] = [
  { id: "sort", label: "Sort All", icon: ICON('<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>'), tooltip: "Sort tabs by domain." },
  { id: "group", label: "Group+", icon: ICON('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/>'), tooltip: "Group ungrouped tabs by domain." },
  { id: "branch", label: "Branch", icon: BRANCH_ICON, tooltip: "Group this tab and every tab opened from it. Alt-click to start one level up." },
  { id: "branchup", label: "Branch Up", icon: BRANCH_UP_ICON, tooltip: "Group the parent tab's branch: parent, siblings, and everything they opened." },
  { id: "dedup", label: "Dedup", icon: ICON('<rect width="8" height="14" x="2" y="6" rx="2"/><rect width="8" height="14" x="14" y="4" rx="2" opacity="0.5"/><path d="m15 2-3 3-3-3"/>'), tooltip: "Close duplicate tabs." },
  { id: "merge", label: "Merge", icon: ICON('<path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/>'), tooltip: "Move all tabs from other windows here." },
  { id: "pin", label: "Lock Tab", icon: PIN_ICON, tooltip: "Hold current tab at its position in the group." },
  { id: "regroup", label: "Regroup", icon: ICON('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>'), tooltip: "Ungroup all, then regroup from scratch." },
  { id: "ungroup", label: "Ungroup", icon: ICON('<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/>'), tooltip: "Remove all tab groups." },
  { id: "shuffle", label: "Shuffle", icon: ICON('<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>'), tooltip: "Randomly reorder tabs." },
  { id: "collapse", label: "Collapse", icon: ICON('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>'), tooltip: "Collapse all tab groups." },
  { id: "unite", label: "Unite", icon: ICON('<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>'), tooltip: "Pull same-domain tabs here." },
  { id: "isolate", label: "Isolate", icon: ICON('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'), tooltip: "Move domain to new window." },
  { id: "splitv", label: "Split V", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>'), tooltip: "Side by side windows." },
  { id: "splith", label: "Split H", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/>'), tooltip: "Top/bottom windows." },
  { id: "splitdomain", label: "Split Dom", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'), tooltip: "One window per domain." },
  { id: "stack", label: "Stack", icon: ICON('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m2 12 8.58 3.91a2 2 0 0 0 1.66 0L21 12"/>'), tooltip: "Stack windows to left." },
  { id: "closeleft", label: "Close Left", icon: ICON('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'), tooltip: "Close tabs left of active." },
  { id: "closeright", label: "Close Right", icon: ICON('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'), tooltip: "Close tabs right of active." },
  { id: "closeold", label: "Close Old", icon: ICON('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'), tooltip: "Close tabs older than 7 days." },
  { id: "closesite", label: "Close Site", icon: ICON('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'), tooltip: "Close other tabs from this domain." },
  { id: "focus", label: "Focus", icon: ICON('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'), tooltip: "Save tabs & start fresh." },
  { id: "save", label: "Save", icon: ICON('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'), tooltip: "Export tabs as text." },
  { id: "load", label: "Load", icon: ICON('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>'), tooltip: "Import tabs from text." },
  { id: "archive", label: "Archive", icon: ICON('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'), tooltip: "Open archive." },
  { id: "aigroup", label: "AI Group", icon: ICON('<path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="12" cy="15" r="2"/><path d="M12 13v-2"/>'), tooltip: "Smart group tabs with on-device AI." },
  { id: "readlater", label: "Read Later", icon: ICON('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="m9 9.5 2 2 4-4"/>'), tooltip: "Save active tab to Reading List." },
  { id: "recent", label: "Recent", icon: ICON('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'), tooltip: "Show recently closed tabs." },
  { id: "sidepanel", label: "Side Panel", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>'), tooltip: "Open TabOrdo in Side Panel." },
  { id: "split", label: "Split Out", icon: ICON('<rect width="10" height="18" x="3" y="3" rx="2"/><path d="M14 12h7"/><path d="m18 9 3 3-3 3"/>'), tooltip: "Send the active tab to a new window." },
  { id: "extract", label: "Extract", icon: ICON('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'), tooltip: "Send the active tab out of its group to a new window." },
  { id: "restore", label: "Restore", icon: ICON('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'), tooltip: "Reopen the last closed tab or window." },
  { id: "mute", label: "Mute Tab", icon: MUTE_ICON, tooltip: "Mute the active tab. Alt-click to unmute." },
  { id: "freeze", label: "Unload", icon: ICON('<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>'), tooltip: "Drop inactive tabs from memory." },
  { id: "pingroup", label: "Lock Group", icon: ICON(`${PIN_BODY}<path d="M3 3h18"/>`), tooltip: "Hold the active group at its position. Alt-click for first." },
];

export const ACTION_POOL_MAP = new Map(DASHBOARD_ACTION_POOL.map((a) => [a.id, a]));

export const DEFAULT_DASHBOARD_IDS = ["sort", "group", "dedup", "merge", "pin"];

/**
 * Second mode for an alt-click, the affordance the Lock Tab tile already used. Pairs are
 * symmetric so either tile reaches both modes — drop one to reclaim a dashboard slot, or keep
 * both. `query` re-runs the same handler with a different argument; `action` routes elsewhere.
 */
export interface AltMode { action: string; query?: string; label: string; tooltip: string; icon?: string; }

export const ALT_MODE: Record<string, AltMode> = {
  closeleft:  { action: "closeright", label: "Close Right", tooltip: "Close tabs right of active." },
  closeright: { action: "closeleft",  label: "Close Left",  tooltip: "Close tabs left of active." },
  splitv:     { action: "splith",     label: "Split H",     tooltip: "Top/bottom windows." },
  splith:     { action: "splitv",     label: "Split V",     tooltip: "Side by side windows." },
  save:       { action: "load",       label: "Load",        tooltip: "Import tabs from text." },
  load:       { action: "save",       label: "Save",        tooltip: "Export tabs as text." },
  unite:      { action: "isolate",    label: "Isolate",     tooltip: "Move domain to new window." },
  isolate:    { action: "unite",      label: "Unite",       tooltip: "Pull same-domain tabs here." },
  mute:       { action: "unmute",     label: "Unmute",      tooltip: "Unmute the active tab.", icon: UNMUTE_ICON },
  branch:     { action: "branchup",   label: "Branch Up",   tooltip: "Group the parent tab's branch: parent, siblings, and everything they opened.", icon: BRANCH_UP_ICON },
  branchup:   { action: "branch",     label: "Branch",      tooltip: "Group this tab and every tab opened from it.", icon: BRANCH_ICON },
  pingroup:   { action: "pingroup", query: "^", label: "Lock Grp Top", tooltip: "Hold the active group at the first position." },
};

export interface MoreItem { action: string; label: string; tip: string; }
export interface MoreSection { title: string; items: MoreItem[]; }

/** The More panel's browsable list — every entry carries a ★ that toggles it onto the grid. */
export const MORE_SECTIONS: MoreSection[] = [
  { title: "Organize", items: [
    { action: "sort", label: "Sort All", tip: "Sort tabs by domain" },
    { action: "group", label: "Group+", tip: "Group ungrouped tabs by domain" },
    { action: "branch", label: "Branch", tip: "This tab and everything opened from it (alt: branch up)" },
    { action: "branchup", label: "Branch Up", tip: "The parent tab's branch — parent and siblings (alt: branch)" },
    { action: "dedup", label: "Dedup", tip: "Close duplicate tabs" },
    { action: "pin", label: "Pin Tab", tip: "Pin current tab at position" },
    { action: "regroup", label: "Regroup All", tip: "Ungroup all, then regroup from scratch" },
    { action: "ungroup", label: "Ungroup All", tip: "Remove all tab groups" },
    { action: "shuffle", label: "Shuffle", tip: "Randomly reorder tabs" },
    { action: "collapse", label: "Collapse Groups", tip: "Collapse every tab group" },
    { action: "pingroup", label: "Lock Group", tip: "Hold active group at its position (alt: first)" },
  ]},
  { title: "Windows", items: [
    { action: "merge", label: "Merge", tip: "Move all tabs from other windows here" },
    { action: "unite", label: "Unite Domain", tip: "Pull same-domain tabs here" },
    { action: "isolate", label: "Isolate Domain", tip: "Move domain to new window" },
    { action: "splitv", label: "Split Vertical", tip: "Side by side windows" },
    { action: "splith", label: "Split Horizontal", tip: "Top/bottom windows" },
    { action: "splitdomain", label: "Split by Domain", tip: "One window per domain" },
    { action: "stack", label: "Stack", tip: "Stack windows to left" },
    { action: "split", label: "Split Tab Out", tip: "Send the active tab to a new window" },
    { action: "extract", label: "Extract from Group", tip: "Send active tab out of its group" },
  ]},
  { title: "Tab", items: [
    { action: "mute", label: "Mute Tab", tip: "Mute active tab (alt: unmute)" },
    { action: "freeze", label: "Unload Inactive", tip: "Drop inactive tabs from memory" },
    { action: "restore", label: "Restore Last Closed", tip: "Reopen the last closed tab or window" },
  ]},
  { title: "Close", items: [
    { action: "closeleft", label: "Close Left", tip: "Tabs left of active" },
    { action: "closeright", label: "Close Right", tip: "Tabs right of active" },
    { action: "closeold", label: "Close Old", tip: "Tabs older than 7 days" },
    { action: "closesite", label: "Close Same Site", tip: "Other tabs from this domain" },
  ]},
  { title: "Smart", items: [
    { action: "aigroup", label: "AI Group", tip: "Group tabs with on-device AI" },
    { action: "readlater", label: "Read Later", tip: "Save tab to Reading List" },
    { action: "recent", label: "Recently Closed", tip: "Restore closed tabs" },
    { action: "sidepanel", label: "Side Panel", tip: "Open persistent sidebar" },
  ]},
  // focus's label and archive's tip are overridden live in the markup (workspace state, count).
  { title: "Workspace", items: [
    { action: "focus", label: "Focus", tip: "Save tabs & start fresh" },
    { action: "save", label: "Save to File", tip: "Export as text" },
    { action: "load", label: "Load from File", tip: "Import from text" },
    { action: "archive", label: "Open Archive", tip: "Browse archived tabs" },
  ]},
];

/**
 * Tiles that deliberately run something other than the palette command of the same name — the
 * Group+ tile groups by domain, while /group groups whatever your query matched. Listed so the
 * consistency test can tell a deliberate divergence from a missing handler.
 */
export const DASHBOARD_ONLY_ACTIONS = new Set(["regroup", "aigroup", "archive", "group", "ungroup", "sort", "pin"]);
