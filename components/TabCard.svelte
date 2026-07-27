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
    {selected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-surface-hover border border-transparent active:bg-surface-active'}"
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
        <svg class="w-2.5 h-2.5 shrink-0 text-text-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1z"/></svg>
      {/if}
      {#if positionPinned}
        <svg class="w-2.5 h-2.5 shrink-0 text-accent-yellow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Pinned to position in group</title><circle cx="12" cy="12" r="1"/><circle cx="12" cy="12" r="5"/></svg>
      {/if}
      {#if tab.audible && !tab.mutedInfo?.muted}
        <svg class="w-2.5 h-2.5 shrink-0 text-text-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
      {/if}
      {#if tab.mutedInfo?.muted}
        <svg class="w-2.5 h-2.5 shrink-0 text-text-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><line x1="23" x2="17" y1="9" y2="15"/><line x1="17" x2="23" y1="9" y2="15"/></svg>
      {/if}
      {#if tab.frozen}
        <svg class="w-2.5 h-2.5 shrink-0 text-accent-cyan" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Frozen</title><path d="M12 2v20"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m4.93 19.07 4.24-4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="M2 12h20"/></svg>
      {:else if tab.discarded}
        <svg class="w-2.5 h-2.5 shrink-0 text-text-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      {/if}
      <span class="truncate text-sm text-text">{tab.title || "Untitled"}</span>
    </div>
    {#if showVolume}
      <div class="flex items-center gap-1.5 mt-0.5">
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
      class="shrink-0 p-1 rounded hover:bg-accent-purple/20 text-text-muted transition-colors
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
      class="shrink-0 p-1 rounded hover:bg-accent-purple/20 hover:text-accent-purple text-text-muted transition-colors"
      onclick={(e) => { e.stopPropagation(); toggleMute(); }}
      title={tab.mutedInfo?.muted ? "Unmute" : "Mute"}
    >
      {#if tab.mutedInfo?.muted}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><line x1="23" x2="17" y1="9" y2="15"/><line x1="17" x2="23" y1="9" y2="15"/></svg>
      {/if}
    </button>
  {/if}

  <button
    class="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent-red/20 hover:text-accent-red text-text-muted transition-[color,background-color,opacity]"
    onclick={(e) => { e.stopPropagation(); onclose(); }}
    title="Close tab"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  </button>
</div>
