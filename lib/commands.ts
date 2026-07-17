export type CommandCategory = "search" | "action" | "view";

export interface CommandDefinition {
  prefix: string;
  label: string;
  description: string;
  category: CommandCategory;
  color: string;
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
  { prefix: "p", label: "/p", description: "Pinned tabs only", category: "search", color: "text-accent-yellow" },
  { prefix: "g", label: "/g", description: "Current group tabs", category: "search", color: "text-accent-green" },
  { prefix: "re", label: "/re", description: "Regex search tabs", category: "search", color: "text-accent-purple" },
];

export const ACTION_COMMANDS: CommandDefinition[] = [
  { prefix: "close", label: "/close", description: "Close matching tabs", category: "action", color: "text-accent-red" },
  { prefix: "closeleft", label: "/closeleft", description: "Close tabs to left of active", category: "action", color: "text-accent-red" },
  { prefix: "closeright", label: "/closeright", description: "Close tabs to right of active", category: "action", color: "text-accent-red" },
  { prefix: "closeold", label: "/closeold", description: "Close tabs older than 7 days", category: "action", color: "text-accent-red" },
  { prefix: "closesite", label: "/closesite", description: "Close all tabs from same site", category: "action", color: "text-accent-red" },
  { prefix: "archive", label: "/archive", description: "Archive matching tabs", category: "action", color: "text-accent-yellow" },
  { prefix: "group", label: "/group", description: "Group matching tabs", category: "action", color: "text-accent-orange" },
  { prefix: "merge", label: "/merge", description: "Merge all windows", category: "action", color: "text-accent-orange" },
  { prefix: "sort", label: "/sort", description: "Sort tabs (domain|title|url)", category: "action", color: "text-accent-orange" },
  { prefix: "dedup", label: "/dedup", description: "Remove duplicate tabs", category: "action", color: "text-accent-orange" },
  { prefix: "mute", label: "/mute", description: "Mute matching tabs", category: "action", color: "text-accent-purple" },
  { prefix: "unmute", label: "/unmute", description: "Unmute matching tabs", category: "action", color: "text-accent-purple" },
  { prefix: "split", label: "/split", description: "Split tab to new window", category: "action", color: "text-accent-cyan" },
  { prefix: "extract", label: "/extract", description: "Extract active tab from group to new window", category: "action", color: "text-accent-cyan" },
  { prefix: "shuffle", label: "/shuffle", description: "Randomly reorder tabs", category: "action", color: "text-accent-purple" },
  { prefix: "unite", label: "/unite", description: "Bring same-domain tabs here", category: "action", color: "text-accent-cyan" },
  { prefix: "isolate", label: "/isolate", description: "Move same-domain to new window", category: "action", color: "text-accent-cyan" },
  { prefix: "splitv", label: "/splitv", description: "Split window vertically side-by-side", category: "action", color: "text-accent-blue" },
  { prefix: "splith", label: "/splith", description: "Split window horizontally", category: "action", color: "text-accent-blue" },
  { prefix: "splitdomain", label: "/splitdomain", description: "Each domain gets own window", category: "action", color: "text-accent-blue" },
  { prefix: "stack", label: "/stack", description: "Stack all windows to left", category: "action", color: "text-accent-blue" },
  { prefix: "focus", label: "/focus", description: "Save tabs & start fresh", category: "action", color: "text-accent-green" },
  { prefix: "unfocus", label: "/unfocus", description: "Restore saved workspace", category: "action", color: "text-accent-green" },
  { prefix: "save", label: "/save", description: "Export tabs to text file", category: "action", color: "text-accent-yellow" },
  { prefix: "load", label: "/load", description: "Load tabs from text file", category: "action", color: "text-accent-yellow" },
  { prefix: "feedback", label: "/feedback", description: "Submit feedback or bugs", category: "action", color: "text-accent-purple" },
  { prefix: "discard", label: "/discard", description: "Discard matching tabs", category: "action", color: "text-accent-pink" },
  { prefix: "reload", label: "/reload", description: "Reload matching tabs", category: "action", color: "text-accent-green" },
  { prefix: "vol", label: "/vol", description: "Set volume (0-100) for matching tabs", category: "action", color: "text-accent-purple" },
  { prefix: "ungroup", label: "/ungroup", description: "Ungroup matching tabs (no query = current tab)", category: "action", color: "text-accent-orange" },
  { prefix: "collapse", label: "/collapse", description: "Collapse all tab groups", category: "action", color: "text-accent-purple" },
  { prefix: "move", label: "/move", description: "Move tab to position (^ $ or number)", category: "action", color: "text-accent-cyan" },
  { prefix: "movegroup", label: "/movegroup", description: "Move group to position (^ $ or number)", category: "action", color: "text-accent-cyan" },
  { prefix: "pin", label: "/pin", description: "Pin tab at position in group (^ $ or number)", category: "action", color: "text-accent-yellow" },
  { prefix: "unpin", label: "/unpin", description: "Unpin tab from fixed position in group", category: "action", color: "text-accent-yellow" },
  { prefix: "pingroup", label: "/pingroup", description: "Pin group at position in window (^ $ or number)", category: "action", color: "text-accent-yellow" },
  { prefix: "unpingroup", label: "/unpingroup", description: "Unpin group from fixed position in window", category: "action", color: "text-accent-yellow" },
];

export const VIEW_COMMANDS: CommandDefinition[] = [
  { prefix: "@", label: "@", description: "Smart tab triage", category: "view", color: "text-accent-cyan" },
];

export const TRIAGE_COMMANDS: CommandDefinition[] = [
  { prefix: "@a", label: "@a", description: "Tabs playing audio", category: "view", color: "text-accent-red" },
  { prefix: "@m", label: "@m", description: "Muted tabs", category: "view", color: "text-accent-purple" },
  { prefix: "@d", label: "@d", description: "Duplicate tabs", category: "view", color: "text-accent-orange" },
  { prefix: "@r", label: "@r", description: "Recently active tabs", category: "view", color: "text-accent-blue" },
  { prefix: "@s", label: "@s", description: "Suspended tabs", category: "view", color: "text-accent-pink" },
  { prefix: "@u", label: "@u", description: "Ungrouped tabs", category: "view", color: "text-accent-orange" },
];

export const ALL_COMMANDS = [...SEARCH_COMMANDS, ...ACTION_COMMANDS, ...VIEW_COMMANDS];

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
    if (typed === "@") return TRIAGE_COMMANDS;
    return fuzzyFilterCommands(TRIAGE_COMMANDS, typed.slice(1));
  }
  if (!input.startsWith("/")) return [];
  const typed = input.slice(1).toLowerCase();
  if (!typed) return ALL_COMMANDS;

  return fuzzyFilterCommands(ALL_COMMANDS, typed);
}
