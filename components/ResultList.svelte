<script lang="ts">
  import type { SearchResult } from "../lib/search.ts";

  let {
    results,
    selectedIndex = 0,
    loading = false,
    onselect,
    onclose,
  }: {
    results: SearchResult[];
    selectedIndex: number;
    loading?: boolean;
    onselect: (item: SearchResult) => void;
    onclose: (item: SearchResult) => void;
  } = $props();

  const typeIcons: Record<string, string> = {
    tab: "🔵",
    bookmark: "⭐",
    history: "🕐",
  };

  const groupColors: Record<string, string> = {
    blue: "bg-accent-blue",
    cyan: "bg-accent-cyan",
    green: "bg-accent-green",
    yellow: "bg-accent-yellow",
    orange: "bg-accent-orange",
    pink: "bg-accent-pink",
    purple: "bg-accent-purple",
    red: "bg-accent-red",
    grey: "bg-border",
  };

  function getDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

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
  {#if loading}
    <div class="flex items-center justify-center py-8 text-text-muted text-sm">
      Searching...
    </div>
  {:else if results.length === 0}
    <div class="flex items-center justify-center py-8 text-text-muted text-sm">
      No results
    </div>
  {:else}
    {#each results as item, i}
      <div
        role="button"
        tabindex="0"
        use:scrollIntoView={i === selectedIndex}
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors group cursor-pointer
          {i === selectedIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'}"
        onclick={() => onselect(item)}
        onkeydown={(e) => { if (e.key === 'Enter') onselect(item); }}
      >
        {#if item.favIconUrl}
          <img
            src={item.favIconUrl}
            alt=""
            class="w-4 h-4 shrink-0 rounded-sm"
            onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        {:else}
          <span class="w-4 h-4 shrink-0 text-center text-[10px] leading-4">{typeIcons[item.type] || "📄"}</span>
        {/if}

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            {#if item.groupColor}
              <span class="w-1.5 h-1.5 rounded-full shrink-0 {groupColors[item.groupColor] || 'bg-border'}"></span>
            {/if}
            {#if item.pinned}
              <span class="text-[10px] text-accent-yellow shrink-0">📌</span>
            {/if}
            {#if item.audible}
              <span class="text-[10px] text-accent-blue shrink-0">🔊</span>
            {/if}
            <span class="truncate text-sm text-text">{item.title || "Untitled"}</span>
          </div>
          <div class="truncate text-xs text-text-muted">
            {getDomain(item.url)}
            {#if item.groupTitle}
              <span class="ml-1 text-[10px] opacity-70">• {item.groupTitle}</span>
            {/if}
          </div>
        </div>

        {#if item.type === "tab"}
          <button
            class="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent-red/20 hover:text-accent-red transition-all"
            onclick={(e) => { e.stopPropagation(); onclose(item); }}
            title="Close tab (Ctrl+Delete)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>
