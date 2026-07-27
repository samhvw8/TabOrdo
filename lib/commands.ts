export type CommandCategory = "search" | "action" | "view";

export interface CommandDefinition {
  prefix: string;
  label: string;
  description: string;
  category: CommandCategory;
  color: string;
  /** Kept working, but left out of the browse list — aliases that duplicate another command. */
  hidden?: boolean;
}

export const CATEGORY_STYLES: Record<CommandCategory, { label: string; color: string; bg: string }> = {
  search: { label: "Search", color: "text-accent-blue", bg: "bg-accent-blue/10" },
  action: { label: "Actions", color: "text-accent-orange", bg: "bg-accent-orange/10" },
  view: { label: "View", color: "text-accent-purple", bg: "bg-accent-purple/10" },
};

export const SEARCH_COMMANDS: CommandDefinition[] = [
  { prefix: "b", label: "/b", description: "Search bookmarks", category: "search", color: "text-accent-blue" },
  { prefix: "h", label: "/h", description: "Search history", category: "search", color: "text-accent-cyan" },
  { prefix: "w", label: "/w", description: "Current window tabs", category: "search", color: "text-accent-blue" },
  { prefix: "p", label: "/p", description: "Chrome-pinned tabs only", category: "search", color: "text-accent-yellow" },
  { prefix: "g", label: "/g", description: "Current group tabs", category: "search", color: "text-accent-green" },
  { prefix: "re", label: "/re", description: "Regex search tabs", category: "search", color: "text-accent-purple" },
  { prefix: "rl", label: "/rl", description: "Search Reading List", category: "search", color: "text-accent-green" },
  { prefix: "rc", label: "/rc", description: "Search recently closed tabs", category: "search", color: "text-accent-blue" },
];

export const ACTION_COMMANDS: CommandDefinition[] = [
  { prefix: "close", label: "/close", description: "Close matching tabs", category: "action", color: "text-accent-red" },
  { prefix: "closeleft", label: "/closeleft", description: "Close tabs to left of active", category: "action", color: "text-accent-red" },
  { prefix: "closeright", label: "/closeright", description: "Close tabs to right of active", category: "action", color: "text-accent-red" },
  { prefix: "closeold", label: "/closeold", description: "Close tabs older than 7 days", category: "action", color: "text-accent-red" },
  { prefix: "closesite", label: "/closesite", description: "Close all tabs from same site", category: "action", color: "text-accent-red" },
  { prefix: "archive", label: "/archive", description: "Archive matching tabs", category: "action", color: "text-accent-yellow" },
  { prefix: "group", label: "/group", description: "Group matching tabs", category: "action", color: "text-accent-orange" },
  { prefix: "merge", label: "/merge", description: "Pull every tab from other windows into this one", category: "action", color: "text-accent-orange" },
  { prefix: "sort", label: "/sort", description: "Sort tabs (domain|title|url)", category: "action", color: "text-accent-orange" },
  { prefix: "dedup", label: "/dedup", description: "Remove duplicate tabs", category: "action", color: "text-accent-orange" },
  { prefix: "mute", label: "/mute", description: "Mute matching tabs", category: "action", color: "text-accent-purple" },
  { prefix: "unmute", label: "/unmute", description: "Unmute matching tabs", category: "action", color: "text-accent-purple" },
  { prefix: "split", label: "/split", description: "Send the active tab to a new window", category: "action", color: "text-accent-cyan" },
  { prefix: "extract", label: "/extract", description: "Send the active tab out of its group to a new window", category: "action", color: "text-accent-cyan" },
  { prefix: "shuffle", label: "/shuffle", description: "Randomly reorder tabs", category: "action", color: "text-accent-purple" },
  { prefix: "unite", label: "/unite", description: "Pull same-domain tabs into this window", category: "action", color: "text-accent-cyan" },
  { prefix: "isolate", label: "/isolate", description: "Send same-domain tabs to a new window", category: "action", color: "text-accent-cyan" },
  { prefix: "splitv", label: "/splitv", description: "Arrange two windows side by side (no tabs move)", category: "action", color: "text-accent-blue" },
  { prefix: "splith", label: "/splith", description: "Arrange two windows top and bottom (no tabs move)", category: "action", color: "text-accent-blue" },
  { prefix: "splitdomain", label: "/splitdomain", description: "Send each domain to its own window", category: "action", color: "text-accent-blue" },
  { prefix: "stack", label: "/stack", description: "Arrange all windows aligned left (no tabs move)", category: "action", color: "text-accent-blue" },
  { prefix: "focus", label: "/focus", description: "Save tabs & start fresh", category: "action", color: "text-accent-green" },
  { prefix: "unfocus", label: "/unfocus", description: "Restore saved workspace", category: "action", color: "text-accent-green" },
  { prefix: "save", label: "/save", description: "Export tabs to text file", category: "action", color: "text-accent-yellow" },
  { prefix: "load", label: "/load", description: "Load tabs from text file", category: "action", color: "text-accent-yellow" },
  { prefix: "feedback", label: "/feedback", description: "Submit feedback or bugs", category: "action", color: "text-accent-purple" },
  { prefix: "discard", label: "/discard", description: "Unload tabs from memory (reload on return)", category: "action", color: "text-accent-pink" },
  { prefix: "reload", label: "/reload", description: "Reload matching tabs", category: "action", color: "text-accent-green" },
  { prefix: "vol", label: "/vol", description: "Set volume (0-100) for matching tabs", category: "action", color: "text-accent-purple" },
  { prefix: "ungroup", label: "/ungroup", description: "Ungroup matching tabs (no query = current tab)", category: "action", color: "text-accent-orange" },
  { prefix: "collapse", label: "/collapse", description: "Collapse all tab groups", category: "action", color: "text-accent-purple" },
  { prefix: "move", label: "/move", description: "Move tab to position (^ $ or number)", category: "action", color: "text-accent-cyan" },
  { prefix: "movegroup", label: "/movegroup", description: "Move group to position (^ $ or number)", category: "action", color: "text-accent-cyan" },
  // "Lock", not "pin": Chrome already owns the word pin for its own tab pinning, and users
  // typing /pin expected that. The old prefixes still work, they just aren't advertised.
  { prefix: "lock", label: "/lock", description: "Hold tab at a position in its group (^ $ or number)", category: "action", color: "text-accent-yellow" },
  { prefix: "unlock", label: "/unlock", description: "Release a tab's held position", category: "action", color: "text-accent-yellow" },
  { prefix: "lockgroup", label: "/lockgroup", description: "Hold group at a position in the window (^ $ or number)", category: "action", color: "text-accent-yellow" },
  { prefix: "unlockgroup", label: "/unlockgroup", description: "Release a group's held position", category: "action", color: "text-accent-yellow" },
  { prefix: "pin", label: "/pin", description: "Alias of /lock", category: "action", color: "text-accent-yellow", hidden: true },
  { prefix: "unpin", label: "/unpin", description: "Alias of /unlock", category: "action", color: "text-accent-yellow", hidden: true },
  { prefix: "pingroup", label: "/pingroup", description: "Alias of /lockgroup", category: "action", color: "text-accent-yellow", hidden: true },
  { prefix: "unpingroup", label: "/unpingroup", description: "Alias of /unlockgroup", category: "action", color: "text-accent-yellow", hidden: true },
  { prefix: "readlater", label: "/readlater", description: "Save matching tabs to Reading List", category: "action", color: "text-accent-green" },
  { prefix: "recent", label: "/recent", description: "Show recently closed tabs", category: "action", color: "text-accent-blue" },
  { prefix: "restore", label: "/restore", description: "Restore last closed tab(s)", category: "action", color: "text-accent-blue" },
  { prefix: "aigroup", label: "/aigroup", description: "AI-powered smart grouping (on-device)", category: "action", color: "text-accent-cyan" },
  { prefix: "sidepanel", label: "/sidepanel", description: "Open TabOrdo in Side Panel", category: "action", color: "text-accent-blue" },
  // Runs discardTabs, exactly like /discard. Kept working for anyone who learned it, but off
  // the browse list: presenting it as a separate capability implied a freeze TabOrdo never did.
  { prefix: "freeze", label: "/freeze", description: "Alias of /discard", category: "action", color: "text-accent-cyan", hidden: true },
];

export const VIEW_COMMANDS: CommandDefinition[] = [
  { prefix: "@", label: "@", description: "Smart tab triage", category: "view", color: "text-accent-cyan" },
];

export const TRIAGE_COMMANDS: CommandDefinition[] = [
  { prefix: "@a", label: "@a", description: "Tabs playing audio", category: "view", color: "text-accent-red" },
  { prefix: "@m", label: "@m", description: "Muted tabs", category: "view", color: "text-accent-purple" },
  { prefix: "@d", label: "@d", description: "Duplicate tabs", category: "view", color: "text-accent-orange" },
  { prefix: "@r", label: "@r", description: "Recently active tabs", category: "view", color: "text-accent-blue" },
  { prefix: "@s", label: "@s", description: "Unloaded tabs (reload when you return)", category: "view", color: "text-accent-pink" },
  { prefix: "@u", label: "@u", description: "Ungrouped tabs", category: "view", color: "text-accent-orange" },
  { prefix: "@f", label: "@f", description: "Tabs Chrome paused to save memory", category: "view", color: "text-accent-cyan" },
  { prefix: "@shared", label: "@shared", description: "Tabs in shared groups", category: "view", color: "text-accent-green" },
];

export const ALL_COMMANDS = [...SEARCH_COMMANDS, ...ACTION_COMMANDS, ...VIEW_COMMANDS];

// Forty-odd actions in one flat list read as noise. These sub-clusters give the browse surfaces
// something to break on; the order of the keys is the order they render in.
const ACTION_GROUPS: Record<string, string[]> = {
  Organize: ["group", "ungroup", "collapse", "sort", "dedup", "aigroup"],
  Windows: ["merge", "unite", "split", "extract", "isolate", "splitdomain", "splitv", "splith", "stack"],
  Order: ["move", "movegroup", "lock", "unlock", "lockgroup", "unlockgroup", "pin", "unpin", "pingroup", "unpingroup", "shuffle"],
  Close: ["close", "closeleft", "closeright", "closeold", "closesite", "archive"],
  Memory: ["discard", "freeze", "reload"],
  Session: ["focus", "unfocus", "save", "load", "recent", "restore", "readlater"],
  Audio: ["mute", "unmute", "vol"],
  Other: ["feedback", "sidepanel"],
};

const GROUP_BY_PREFIX = new Map<string, string>();
for (const [group, prefixes] of Object.entries(ACTION_GROUPS)) {
  for (const p of prefixes) GROUP_BY_PREFIX.set(p, group);
}

export function commandGroup(cmd: CommandDefinition): string {
  return cmd.category === "action" ? GROUP_BY_PREFIX.get(cmd.prefix) ?? "" : "";
}

/**
 * Bucket a category's commands into their sub-clusters, in ACTION_GROUPS order. Anything
 * unmapped lands in a trailing unnamed bucket rather than disappearing.
 */
export function groupCommands(cmds: CommandDefinition[]): { group: string; commands: CommandDefinition[] }[] {
  const buckets = new Map<string, CommandDefinition[]>();
  for (const c of cmds) {
    const g = commandGroup(c);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(c);
  }
  const out: { group: string; commands: CommandDefinition[] }[] = [];
  for (const g of Object.keys(ACTION_GROUPS)) {
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
