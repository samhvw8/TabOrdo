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
  { prefix: "sort", label: "/sort", description: "Sort tabs by domain", category: "action", color: "text-accent-orange" },
  { prefix: "dedup", label: "/dedup", description: "Remove duplicate tabs", category: "action", color: "text-accent-orange" },
  { prefix: "mute", label: "/mute", description: "Mute matching tabs", category: "action", color: "text-accent-purple" },
  { prefix: "unmute", label: "/unmute", description: "Unmute matching tabs", category: "action", color: "text-accent-purple" },
  { prefix: "split", label: "/split", description: "Split tab to new window", category: "action", color: "text-accent-cyan" },
  { prefix: "extract", label: "/extract", description: "Extract tab group to new window", category: "action", color: "text-accent-cyan" },
  { prefix: "discard", label: "/discard", description: "Discard matching tabs", category: "action", color: "text-accent-pink" },
  { prefix: "reload", label: "/reload", description: "Reload matching tabs", category: "action", color: "text-accent-green" },
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
