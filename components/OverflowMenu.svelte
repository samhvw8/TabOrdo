<script lang="ts">
  let {
    open = $bindable(false),
    hasWorkspace = false,
    onaction,
  }: {
    open: boolean;
    hasWorkspace: boolean;
    onaction: (action: string) => void;
  } = $props();

  interface MenuItem { action: string; label: string; }
  interface MenuSection { title: string; items: MenuItem[]; }

  const sections: MenuSection[] = $derived([
    { title: "Organize", items: [
      { action: "regroup", label: "Regroup All" },
      { action: "ungroup", label: "Ungroup All" },
      { action: "shuffle", label: "Shuffle" },
    ]},
    { title: "Windows", items: [
      { action: "unite", label: "Unite Domain" },
      { action: "isolate", label: "Isolate Domain" },
      { action: "splitv", label: "Split Vertical" },
      { action: "splith", label: "Split Horizontal" },
      { action: "splitdomain", label: "Split by Domain" },
      { action: "stack", label: "Stack Windows" },
    ]},
    { title: "Close", items: [
      { action: "closeleft", label: "Close Left" },
      { action: "closeright", label: "Close Right" },
      { action: "closeold", label: "Close Old (7d)" },
      { action: "closesite", label: "Close Same Site" },
    ]},
    { title: "Workspace", items: [
      { action: "focus", label: hasWorkspace ? "Unfocus (Restore)" : "Focus (Save & Clear)" },
      { action: "save", label: "Save to File" },
      { action: "load", label: "Load from File" },
    ]},
    { title: "Other", items: [
      { action: "feedback", label: "Feedback" },
    ]},
  ]);

  function handleClick(action: string) {
    onaction(action);
    open = false;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".overflow-menu") && !target.closest(".overflow-menu-trigger")) {
      open = false;
    }
  }
</script>

<svelte:document onclick={handleClickOutside} />

{#if open}
<div class="overflow-menu absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface shadow-lg z-50 py-1 text-xs max-h-[300px] overflow-y-auto">
  {#each sections as section, si}
    {#if si > 0}
      <div class="mx-2 my-1 h-px bg-border/50"></div>
    {/if}
    <div class="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">{section.title}</div>
    {#each section.items as item}
      <button
        class="w-full text-left px-2.5 py-1.5 hover:bg-surface-hover text-text transition-colors"
        onclick={() => handleClick(item.action)}
      >{item.label}</button>
    {/each}
  {/each}
</div>
{/if}
