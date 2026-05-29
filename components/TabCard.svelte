<script lang="ts">
  import type { TabInfo } from "../lib/tabs.ts";
  import { switchToTab, getFullHostname, muteTab, setTabVolume } from "../lib/tabs.ts";

  let {
    tab,
    selected = false,
    positionPinned = false,
    ontoggle,
    onclose,
    onmute,
  }: {
    tab: TabInfo;
    selected: boolean;
    positionPinned?: boolean;
    ontoggle: () => void;
    onclose: () => void;
    onmute?: () => void;
  } = $props();

  let showVolume = $state(false);
  let volume = $state(100);

  async function toggleMute() {
    const muted = !tab.mutedInfo?.muted;
    await muteTab(tab.id, muted);
    onmute?.();
  }

  async function handleVolume(e: Event) {
    volume = parseInt((e.target as HTMLInputElement).value, 10);
    await setTabVolume(tab.id, volume / 100);
  }
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
      {#if positionPinned}
        <span class="text-[10px] text-accent-yellow" title="Pinned to position in group">⊙</span>
      {/if}
      {#if tab.audible && !tab.mutedInfo?.muted}
        <span class="text-[10px]">🔊</span>
      {/if}
      {#if tab.mutedInfo?.muted}
        <span class="text-[10px]">🔇</span>
      {/if}
      {#if tab.discarded}
        <span class="text-[10px]">💤</span>
      {/if}
      <span class="truncate text-sm text-text">{tab.title || "Untitled"}</span>
    </div>
    {#if showVolume}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="flex items-center gap-1.5 mt-0.5" onclick={(e) => e.stopPropagation()}>
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          oninput={handleVolume}
          onclick={(e) => e.stopPropagation()}
          class="w-full h-1 accent-primary cursor-pointer"
        />
        <span class="text-[10px] text-text-muted w-7 text-right shrink-0">{volume}%</span>
      </div>
    {:else}
      <div class="truncate text-xs text-text-muted">{getFullHostname(tab.url)}</div>
    {/if}
  </button>

  {#if tab.audible || tab.mutedInfo?.muted}
    <button
      class="shrink-0 p-1 rounded hover:bg-accent-purple/20 text-text-muted transition-all
        {showVolume ? 'bg-accent-purple/15 text-accent-purple' : 'hover:text-accent-purple'}"
      onclick={(e) => { e.stopPropagation(); showVolume = !showVolume; }}
      title="Adjust volume"
    >
      {#if tab.mutedInfo?.muted}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 5 6 9H2v6h4l5 4V5Z"/><line x1="23" x2="17" y1="9" y2="15"/><line x1="17" x2="23" y1="9" y2="15"/>
        </svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      {/if}
    </button>
    <button
      class="shrink-0 p-1 rounded hover:bg-accent-purple/20 hover:text-accent-purple text-text-muted transition-all text-[10px]"
      onclick={(e) => { e.stopPropagation(); toggleMute(); }}
      title={tab.mutedInfo?.muted ? "Unmute" : "Mute"}
    >
      {tab.mutedInfo?.muted ? "🔈" : "🔇"}
    </button>
  {/if}

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
