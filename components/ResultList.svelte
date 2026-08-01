<script lang="ts">
  import { highlightSegments, type SearchResult } from "../lib/search.ts";
  import { getFullHostname } from "../lib/tabs/index.ts";

  let {
    results,
    selectedIndex = 0,
    loading = false,
    currentWindowId = 0,
    windowIds = [] as number[],
    query = "",
    onselect,
    onclose,
  }: {
    results: SearchResult[];
    selectedIndex: number;
    loading?: boolean;
    currentWindowId?: number;
    windowIds?: number[];
    query?: string;
    onselect: (item: SearchResult) => void;
    onclose: (item: SearchResult) => void;
  } = $props();

  function windowLabel(wid: number | undefined): string | null {
    if (!wid || !currentWindowId || windowIds.length <= 1) return null;
    if (wid === currentWindowId) return null;
    const idx = windowIds.indexOf(wid);
    return idx >= 0 ? `W${idx + 1}` : "Other";
  }

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
    <div class="flex flex-col items-center justify-center py-10 gap-2">
      <svg class="animate-spin text-text-muted" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      <span class="text-text-muted text-xs">Searching...</span>
    </div>
  {:else if results.length === 0}
    <div class="flex flex-col items-center justify-center py-10 gap-2">
      <svg class="text-text-muted/50" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>
      <span class="text-text-muted text-xs">No matching tabs</span>
      <span class="text-text-muted/50 text-[10px]">Try a different search or press Esc to clear</span>
    </div>
  {:else}
    {#each results as item, i}
      {#if item.type === "divider"}
        <div class="flex items-center gap-2 px-2 py-1 mt-1">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{item.title}</span>
          <div class="flex-1 h-px bg-border/50"></div>
        </div>
      {:else}
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
            {#if item.muted}
              <span class="text-[10px] text-accent-purple shrink-0">🔇</span>
            {/if}
            {#if item.discarded}
              <span class="text-[10px] text-text-muted shrink-0">💤</span>
            {/if}
            <span class="truncate text-sm text-text">{#each highlightSegments(item.title || "Untitled", query) as seg}{#if seg.matched}<span class="text-primary font-semibold">{seg.text}</span>{:else}{seg.text}{/if}{/each}</span>
          </div>
          <div class="truncate text-xs text-text-muted">
            {getFullHostname(item.url)}
            {#if item.groupTitle}
              <span class="ml-1 text-[10px] opacity-70">• {item.groupTitle}</span>
            {/if}
            {#if windowLabel(item.windowId)}
              <span class="ml-1 px-1 py-px rounded text-[9px] font-medium bg-accent-cyan/15 text-accent-cyan">{windowLabel(item.windowId)}</span>
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
      {/if}
    {/each}
  {/if}
</div>
