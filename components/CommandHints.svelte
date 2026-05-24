<script lang="ts">
  import { type CommandDefinition, CATEGORY_STYLES, type CommandCategory } from "../lib/commands.ts";

  let {
    commands,
    selectedIndex = 0,
    onselect,
  }: {
    commands: CommandDefinition[];
    selectedIndex: number;
    onselect: (cmd: CommandDefinition) => void;
  } = $props();

  const categories: CommandCategory[] = ["search", "action", "view"];

  function scrollIntoView(node: HTMLElement, active: boolean) {
    if (active) node.scrollIntoView({ block: "nearest" });
    return {
      update(active: boolean) {
        if (active) node.scrollIntoView({ block: "nearest" });
      },
    };
  }
</script>

<div class="flex-1 overflow-y-auto px-1 py-1 min-h-0">
  {#each categories as cat}
    {@const catCommands = commands.filter((c) => c.category === cat)}
    {#if catCommands.length > 0}
      <div class="flex items-center gap-2 px-2 py-1">
        <span class="text-[10px] font-semibold uppercase tracking-wider {CATEGORY_STYLES[cat].color}">
          {CATEGORY_STYLES[cat].label}
        </span>
        <div class="flex-1 h-px bg-border/50"></div>
      </div>
      {#each catCommands as cmd}
        {@const globalIdx = commands.indexOf(cmd)}
        <button
          use:scrollIntoView={globalIdx === selectedIndex}
          class="w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left transition-colors
            {globalIdx === selectedIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
          onclick={() => onselect(cmd)}
        >
          <span class="font-mono text-xs font-medium w-16 shrink-0 {cmd.color}">{cmd.label}</span>
          <span class="text-sm text-text-muted flex-1">{cmd.description}</span>
          <span class="text-[9px] px-1 py-0.5 rounded {CATEGORY_STYLES[cat].bg} {CATEGORY_STYLES[cat].color}">{cat}</span>
        </button>
      {/each}
    {/if}
  {/each}
</div>
