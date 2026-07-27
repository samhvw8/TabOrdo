<script lang="ts" module>
  export type SidebarSection = "dashboard" | "pins" | "rules" | "settings" | "more" | "archive" | "ai";
</script>

<script lang="ts">
  let {
    active = $bindable<SidebarSection>("dashboard"),
    archiveCount = 0,
    helpActive = false,
    onarchive,
    onhelp,
  }: {
    active: SidebarSection;
    archiveCount?: number;
    helpActive?: boolean;
    onarchive?: () => void;
    onhelp?: () => void;
  } = $props();

  type RailId = SidebarSection | "help";
  interface RailItem { id: RailId; label: string; external?: boolean }

  // Everything above the divider swaps the pane in place. The two below it don't — Help is an
  // overlay and Archive opens a separate page — so they sit apart instead of reading as more
  // destinations in the same run.
  const panels: RailItem[] = [
    { id: "dashboard", label: "Home" },
    { id: "pins", label: "Locks" },
    { id: "rules", label: "Rules" },
    { id: "ai", label: "AI" },
    { id: "more", label: "More" },
    { id: "settings", label: "Settings" },
  ];

  const extras: RailItem[] = [
    { id: "help", label: "Help" },
    { id: "archive", label: "Archive", external: true },
  ];

  function isActive(id: RailId): boolean {
    if (id === "help") return helpActive;
    if (id === "archive") return false; // navigates away; never a resting state
    return active === id && !helpActive;
  }

  function activate(id: RailId) {
    if (id === "archive") onarchive?.();
    else if (id === "help") onhelp?.();
    else active = id;
  }
</script>

{#snippet railButton(item: RailItem)}
  <button
    class="w-12 flex flex-col items-center gap-0.5 py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface
      {isActive(item.id) ? 'bg-primary text-white' : 'text-text-muted hover:text-text hover:bg-surface-hover'}"
    onmousedown={(e) => { e.preventDefault(); }}
    onclick={() => activate(item.id)}
    title={item.external ? `${item.label} (opens a new tab)` : item.label}
    aria-label={item.external ? `${item.label} (opens a new tab)` : item.label}
    aria-pressed={isActive(item.id)}
  >
    {#if item.id === "dashboard"}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1"/>
        <rect x="14" y="3" width="7" height="5" rx="1"/>
        <rect x="14" y="12" width="7" height="9" rx="1"/>
        <rect x="3" y="16" width="7" height="5" rx="1"/>
      </svg>
    {:else if item.id === "pins"}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 17v5"/>
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1z"/>
      </svg>
    {:else if item.id === "rules"}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="6" x2="20" y2="6"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="4" y1="18" x2="20" y2="18"/>
        <circle cx="8" cy="6" r="2" fill="currentColor"/>
        <circle cx="16" cy="12" r="2" fill="currentColor"/>
        <circle cx="10" cy="18" r="2" fill="currentColor"/>
      </svg>
    {:else if item.id === "ai"}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="12" cy="15" r="2"/><path d="M12 13v-2"/>
      </svg>
    {:else if item.id === "more"}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
      </svg>
    {:else if item.id === "help"}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    {:else if item.id === "archive"}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>
      </svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    {/if}
    <span class="text-[8px] font-medium leading-none">{item.id === "archive" && archiveCount > 0 ? `${item.label} ${archiveCount}` : item.label}{#if item.external}<span class="ml-px align-super text-[7px] opacity-70">↗</span>{/if}</span>
  </button>
{/snippet}

<aside class="w-14 shrink-0 flex flex-col items-center gap-0.5 py-1.5 border-r border-border bg-surface">
  {#each panels as item}
    {@render railButton(item)}
  {/each}
  <div class="flex-1"></div>
  <div class="w-8 h-px bg-border my-1"></div>
  {#each extras as item}
    {@render railButton(item)}
  {/each}
</aside>
