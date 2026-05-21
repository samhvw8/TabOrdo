<script lang="ts">
  import type { TabInfo } from "../lib/tabs.ts";
  import { switchToTab, getFullHostname } from "../lib/tabs.ts";

  let {
    tab,
    selected = false,
    ontoggle,
    onclose,
  }: {
    tab: TabInfo;
    selected: boolean;
    ontoggle: () => void;
    onclose: () => void;
  } = $props();
</script>

<div
  class="flex items-center gap-2 px-2 py-1.5 rounded-md group transition-colors overflow-hidden
    {selected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-surface-hover border border-transparent'}"
>
  <input
    type="checkbox"
    checked={selected}
    onchange={ontoggle}
    class="shrink-0 w-3.5 h-3.5 rounded accent-primary"
  />

  {#if tab.favIconUrl}
    <img
      src={tab.favIconUrl}
      alt=""
      class="w-4 h-4 shrink-0 rounded-sm"
      onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  {:else}
    <span class="w-4 h-4 shrink-0 rounded-sm bg-surface-active flex items-center justify-center text-[9px] text-text-muted">
      {getFullHostname(tab.url).charAt(0).toUpperCase()}
    </span>
  {/if}

  <button
    class="flex-1 min-w-0 text-left"
    onclick={() => switchToTab(tab.id)}
  >
    <div class="flex items-center gap-1 min-w-0">
      {#if tab.pinned}
        <span class="text-[10px]">📌</span>
      {/if}
      {#if tab.audible}
        <span class="text-[10px]">🔊</span>
      {/if}
      {#if tab.discarded}
        <span class="text-[10px]">💤</span>
      {/if}
      <span class="truncate text-sm text-text">{tab.title || "Untitled"}</span>
    </div>
    <div class="truncate text-xs text-text-muted">{getFullHostname(tab.url)}</div>
  </button>

  <button
    class="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent-red/20 hover:text-accent-red text-text-muted transition-all"
    onclick={(e) => { e.stopPropagation(); onclose(); }}
    title="Close tab"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  </button>
</div>
