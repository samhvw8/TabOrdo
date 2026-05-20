<script lang="ts">
  import type { CommandDefinition } from "../lib/commands.ts";

  let {
    commands,
    selectedIndex = 0,
    onselect,
  }: {
    commands: CommandDefinition[];
    selectedIndex: number;
    onselect: (cmd: CommandDefinition) => void;
  } = $props();

  const categoryLabels: Record<string, string> = {
    search: "Search",
    action: "Actions",
  };
</script>

<div class="flex-1 overflow-y-auto px-1 py-1 min-h-0">
  {#each ["search", "action"] as cat}
    {@const catCommands = commands.filter((c) => c.category === cat)}
    {#if catCommands.length > 0}
      <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {categoryLabels[cat]}
      </div>
      {#each catCommands as cmd}
        {@const globalIdx = commands.indexOf(cmd)}
        <button
          class="w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left transition-colors
            {globalIdx === selectedIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
          onclick={() => onselect(cmd)}
        >
          <span class="font-mono text-xs text-primary font-medium w-14 shrink-0">{cmd.label}</span>
          <span class="text-sm text-text-muted">{cmd.description}</span>
        </button>
      {/each}
    {/if}
  {/each}
</div>
