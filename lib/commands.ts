export interface CommandDefinition {
  prefix: string;
  label: string;
  description: string;
  category: "search" | "action";
}

export const SEARCH_COMMANDS: CommandDefinition[] = [
  { prefix: "b", label: "/b", description: "Search bookmarks", category: "search" },
  { prefix: "h", label: "/h", description: "Search history", category: "search" },
  { prefix: "w", label: "/w", description: "Search current window tabs", category: "search" },
  { prefix: "p", label: "/p", description: "Search pinned tabs", category: "search" },
  { prefix: "g", label: "/g", description: "Search tabs in current group", category: "search" },
];

export const ACTION_COMMANDS: CommandDefinition[] = [
  { prefix: "close", label: "/close", description: "Close matching tabs", category: "action" },
  { prefix: "group", label: "/group", description: "Group matching tabs", category: "action" },
  { prefix: "merge", label: "/merge", description: "Merge all windows", category: "action" },
  { prefix: "sort", label: "/sort", description: "Sort tabs by domain", category: "action" },
  { prefix: "dedup", label: "/dedup", description: "Remove duplicate tabs", category: "action" },
  { prefix: "mute", label: "/mute", description: "Mute matching tabs", category: "action" },
  { prefix: "unmute", label: "/unmute", description: "Unmute matching tabs", category: "action" },
  { prefix: "split", label: "/split", description: "Split tab to new window", category: "action" },
  { prefix: "discard", label: "/discard", description: "Discard matching tabs", category: "action" },
  { prefix: "reload", label: "/reload", description: "Reload matching tabs", category: "action" },
];

export const ALL_COMMANDS = [...SEARCH_COMMANDS, ...ACTION_COMMANDS];

export function matchCommands(input: string): CommandDefinition[] {
  if (!input.startsWith("/")) return [];
  const typed = input.slice(1).toLowerCase();
  if (!typed) return ALL_COMMANDS;
  return ALL_COMMANDS.filter(
    (cmd) => cmd.prefix.startsWith(typed) || cmd.label.startsWith(input)
  );
}
