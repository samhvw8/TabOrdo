<script lang="ts">
  import { getAllTabs, closeTabs, sortTabsInWindow, sortTabsInGroup, groupTabsByDomain, removeDuplicates, mergeAllWindows, discardTabs, type TabInfo, type TabGroup } from "../../lib/tabs.ts";
  import ActionButton from "../../components/ActionButton.svelte";
  import TabCard from "../../components/TabCard.svelte";

  let tabs = $state<TabInfo[]>([]);
  let groups = $state<Map<number, { title: string; color: string; tabs: TabInfo[] }>>(new Map());
  let ungrouped = $state<TabInfo[]>([]);
  let selectedTabs = $state<Set<number>>(new Set());
  let statusMessage = $state("");
  let currentWindowId = $state(0);

  async function loadTabs() {
    const allTabs = await getAllTabs();
    const win = await chrome.windows.getCurrent();
    currentWindowId = win.id!;
    tabs = allTabs.filter((t) => t.windowId === currentWindowId);

    const groupMap = new Map<number, { title: string; color: string; tabs: TabInfo[] }>();
    const ungroupedList: TabInfo[] = [];

    for (const tab of tabs) {
      if (tab.groupId !== -1) {
        if (!groupMap.has(tab.groupId)) {
          groupMap.set(tab.groupId, {
            title: tab.groupTitle || "Unnamed",
            color: tab.groupColor || "grey",
            tabs: [],
          });
        }
        groupMap.get(tab.groupId)!.tabs.push(tab);
      } else {
        ungroupedList.push(tab);
      }
    }

    groups = groupMap;
    ungrouped = ungroupedList;
  }

  function toggleSelect(tabId: number) {
    const next = new Set(selectedTabs);
    if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    selectedTabs = next;
  }

  function selectAll() {
    selectedTabs = new Set(tabs.map((t) => t.id));
  }

  function selectNone() {
    selectedTabs = new Set();
  }

  async function action(fn: () => Promise<string | void>) {
    const msg = await fn();
    if (msg) statusMessage = msg;
    await loadTabs();
    selectedTabs = new Set();
    setTimeout(() => { statusMessage = ""; }, 3000);
  }

  $effect(() => {
    loadTabs();
  });

  const groupColors: Record<string, string> = {
    blue: "border-accent-blue/40",
    cyan: "border-accent-cyan/40",
    green: "border-accent-green/40",
    yellow: "border-accent-yellow/40",
    orange: "border-accent-orange/40",
    pink: "border-accent-pink/40",
    purple: "border-accent-purple/40",
    red: "border-accent-red/40",
    grey: "border-border",
  };

  const groupBg: Record<string, string> = {
    blue: "bg-accent-blue/5",
    cyan: "bg-accent-cyan/5",
    green: "bg-accent-green/5",
    yellow: "bg-accent-yellow/5",
    orange: "bg-accent-orange/5",
    pink: "bg-accent-pink/5",
    purple: "bg-accent-purple/5",
    red: "bg-accent-red/5",
    grey: "bg-surface-hover",
  };

  const dotColors: Record<string, string> = {
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
</script>

<div class="min-h-screen bg-surface p-6">
  <div class="max-w-5xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-semibold text-text">TabOrdo</h1>
        <p class="text-sm text-text-muted">{tabs.length} tabs in current window</p>
      </div>
      {#if statusMessage}
        <span class="text-sm text-accent-green">{statusMessage}</span>
      {/if}
    </div>

    <!-- Actions Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-6">
      <ActionButton
        label="Sort All"
        icon="↕️"
        onclick={() => action(async () => { await sortTabsInWindow(currentWindowId); return "Sorted by domain"; })}
      />
      <ActionButton
        label="Group by Domain"
        icon="📁"
        onclick={() => action(async () => { await groupTabsByDomain(currentWindowId); return "Grouped by domain"; })}
      />
      <ActionButton
        label="Remove Dupes"
        icon="🔄"
        onclick={() => action(async () => { const n = await removeDuplicates(); return n > 0 ? `Removed ${n} dupe(s)` : "No dupes"; })}
      />
      <ActionButton
        label="Merge Windows"
        icon="🔗"
        onclick={() => action(async () => { await mergeAllWindows(); return "Merged all windows"; })}
      />
      <ActionButton
        label="Close Selected"
        icon="✕"
        variant="danger"
        disabled={selectedTabs.size === 0}
        onclick={() => action(async () => { await closeTabs([...selectedTabs]); return `Closed ${selectedTabs.size} tab(s)`; })}
      />
      <ActionButton
        label="Discard Selected"
        icon="💤"
        disabled={selectedTabs.size === 0}
        onclick={() => action(async () => { await discardTabs([...selectedTabs]); return `Discarded ${selectedTabs.size} tab(s)`; })}
      />
    </div>

    <!-- Selection controls -->
    <div class="flex items-center gap-3 mb-4 text-sm">
      <button onclick={selectAll} class="text-primary hover:text-primary-hover transition-colors">Select All</button>
      <button onclick={selectNone} class="text-text-muted hover:text-text transition-colors">Deselect</button>
      {#if selectedTabs.size > 0}
        <span class="text-text-muted">{selectedTabs.size} selected</span>
      {/if}
    </div>

    <!-- Tab Groups -->
    {#each [...groups.entries()] as [groupId, group]}
      <div class="mb-4 border rounded-lg {groupColors[group.color] || 'border-border'} {groupBg[group.color] || 'bg-surface-hover'}">
        <div class="flex items-center gap-2 px-3 py-2 border-b {groupColors[group.color] || 'border-border'}">
          <span class="w-2.5 h-2.5 rounded-full {dotColors[group.color] || 'bg-border'}"></span>
          <span class="text-sm font-medium text-text">{group.title}</span>
          <span class="text-xs text-text-muted">({group.tabs.length})</span>
          <div class="flex-1"></div>
          <button
            class="text-xs text-text-muted hover:text-text transition-colors"
            onclick={() => action(async () => { await sortTabsInGroup(groupId); return `Sorted "${group.title}"`; })}
          >
            Sort
          </button>
        </div>
        <div class="p-2 grid gap-1">
          {#each group.tabs as tab}
            <TabCard
              {tab}
              selected={selectedTabs.has(tab.id)}
              ontoggle={() => toggleSelect(tab.id)}
              onclose={() => action(async () => { await closeTabs([tab.id]); })}
            />
          {/each}
        </div>
      </div>
    {/each}

    <!-- Ungrouped Tabs -->
    {#if ungrouped.length > 0}
      <div class="mb-4 border border-border rounded-lg">
        <div class="px-3 py-2 border-b border-border">
          <span class="text-sm font-medium text-text-muted">Ungrouped</span>
          <span class="text-xs text-text-muted ml-1">({ungrouped.length})</span>
        </div>
        <div class="p-2 grid gap-1">
          {#each ungrouped as tab}
            <TabCard
              {tab}
              selected={selectedTabs.has(tab.id)}
              ontoggle={() => toggleSelect(tab.id)}
              onclose={() => action(async () => { await closeTabs([tab.id]); })}
            />
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
