<script lang="ts">
  import { onMount } from "svelte";
  import { getAllTabs, getCurrentWindowTabs, switchToTab, closeTabs, sortTabsInWindow, sortTabsInGroup, groupTabsByDomain, ungroupAll, removeDuplicates, mergeAllWindows, muteTab, splitTabToWindow, discardTabs, type TabInfo } from "../../lib/tabs.ts";
  import { search, tabsToSearchItems, searchBookmarks, searchHistory, parseCommand, SEARCH_MODES, type SearchResult, type SearchMode } from "../../lib/search.ts";
  import { matchCommands, ALL_COMMANDS, CATEGORY_STYLES, type CommandDefinition, type CommandCategory } from "../../lib/commands.ts";
  import SearchInput from "../../components/SearchInput.svelte";
  import ResultList from "../../components/ResultList.svelte";
  import CommandHints from "../../components/CommandHints.svelte";
  import StatusBar from "../../components/StatusBar.svelte";
  import ActionButton from "../../components/ActionButton.svelte";
  import TabCard from "../../components/TabCard.svelte";

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let selectedIndex = $state(0);
  let commandHints = $state<CommandDefinition[]>([]);
  let statusMessage = $state("");
  let loading = $state(false);
  let paletteMode = $state<"search" | "commands">("search");
  let searchModeIndex = $state(0);
  let searchMode = $derived<SearchMode>(SEARCH_MODES[searchModeIndex].mode);

  let showHelp = $state(false);

  function cycleSearchMode() {
    searchModeIndex = (searchModeIndex + 1) % SEARCH_MODES.length;
    if (query) updateResults();
  }

  let allTabs = $state<SearchResult[]>([]);
  let searchHaystack = $state<string[]>([]);

  let dashboardTabs = $state<TabInfo[]>([]);
  let groups = $state<Map<number, { title: string; color: string; tabs: TabInfo[] }>>(new Map());
  let ungrouped = $state<TabInfo[]>([]);
  let selectedTabs = $state<Set<number>>(new Set());
  let currentWindowId = $state(0);

  let showPalette = $derived(query.length > 0);

  const groupColors: Record<string, string> = {
    blue: "border-accent-blue/40", cyan: "border-accent-cyan/40", green: "border-accent-green/40",
    yellow: "border-accent-yellow/40", orange: "border-accent-orange/40", pink: "border-accent-pink/40",
    purple: "border-accent-purple/40", red: "border-accent-red/40", grey: "border-border",
  };
  const groupBg: Record<string, string> = {
    blue: "bg-accent-blue/5", cyan: "bg-accent-cyan/5", green: "bg-accent-green/5",
    yellow: "bg-accent-yellow/5", orange: "bg-accent-orange/5", pink: "bg-accent-pink/5",
    purple: "bg-accent-purple/5", red: "bg-accent-red/5", grey: "bg-surface-hover",
  };
  const dotColors: Record<string, string> = {
    blue: "bg-accent-blue", cyan: "bg-accent-cyan", green: "bg-accent-green",
    yellow: "bg-accent-yellow", orange: "bg-accent-orange", pink: "bg-accent-pink",
    purple: "bg-accent-purple", red: "bg-accent-red", grey: "bg-border",
  };

  async function loadTabs() {
    const tabs = await getAllTabs();
    const win = await chrome.windows.getCurrent();
    currentWindowId = win.id!;

    allTabs = tabsToSearchItems(tabs);
    searchHaystack = allTabs.map((t) => `${t.title} ${t.url}`);

    dashboardTabs = tabs.filter((t) => t.windowId === currentWindowId);
    const groupMap = new Map<number, { title: string; color: string; tabs: TabInfo[] }>();
    const ungroupedList: TabInfo[] = [];

    for (const tab of dashboardTabs) {
      if (tab.groupId !== -1) {
        if (!groupMap.has(tab.groupId)) {
          groupMap.set(tab.groupId, { title: tab.groupTitle || "Unnamed", color: tab.groupColor || "grey", tabs: [] });
        }
        groupMap.get(tab.groupId)!.tabs.push(tab);
      } else {
        ungroupedList.push(tab);
      }
    }
    groups = groupMap;
    ungrouped = ungroupedList;
  }

  function updateResults() {
    const { prefix, query: searchQuery } = parseCommand(query);

    if (query.startsWith("/") && !query.includes(" ")) {
      commandHints = matchCommands(query);
      if (commandHints.length > 0 && searchQuery === "") {
        paletteMode = "commands";
        results = [];
        return;
      }
    } else {
      commandHints = [];
    }

    paletteMode = "search";

    if (prefix) {
      handlePrefixSearch(prefix, searchQuery);
    } else {
      const indices = search(searchHaystack, query, searchMode);
      results = indices.map((i) => allTabs[i]);
    }
    selectedIndex = 0;
  }

  async function handlePrefixSearch(prefix: string, searchQuery: string) {
    loading = true;
    try {
      switch (prefix) {
        case "b": {
          results = await searchBookmarks(searchQuery);
          break;
        }
        case "h": {
          results = await searchHistory(searchQuery);
          break;
        }
        case "w": {
          const windowTabs = await getCurrentWindowTabs();
          const items = tabsToSearchItems(windowTabs);
          const hay = items.map((t) => `${t.title} ${t.url}`);
          const indices = search(hay, searchQuery, searchMode);
          results = indices.map((i) => items[i]);
          break;
        }
        case "p": {
          const pinned = allTabs.filter((t) => t.pinned);
          const hay = pinned.map((t) => `${t.title} ${t.url}`);
          const indices = search(hay, searchQuery, searchMode);
          results = indices.map((i) => pinned[i]);
          break;
        }
        case "g": {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const groupTabs = activeTab?.groupId && activeTab.groupId !== -1
            ? allTabs.filter((t) => t.groupTitle === allTabs.find((at) => at.tabId === activeTab.id)?.groupTitle)
            : allTabs.filter((t) => !t.groupTitle);
          const hay = groupTabs.map((t) => `${t.title} ${t.url}`);
          const indices = search(hay, searchQuery, searchMode);
          results = indices.map((i) => groupTabs[i]);
          break;
        }
        default:
          await handleActionCommand(prefix, searchQuery);
      }
    } finally {
      loading = false;
    }
    selectedIndex = 0;
  }

  async function handleActionCommand(prefix: string, searchQuery: string) {
    const matchingIndices = searchQuery ? search(searchHaystack, searchQuery, searchMode) : [];
    const matchingTabs = matchingIndices.map((i) => allTabs[i]).filter((t) => t.tabId);
    const tabIds = matchingTabs.map((t) => t.tabId!);

    switch (prefix) {
      case "close":
        if (tabIds.length > 0) { await closeTabs(tabIds); statusMessage = `Closed ${tabIds.length} tab(s)`; await loadTabs(); }
        break;
      case "group":
        if (tabIds.length > 0) {
          const gid = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(gid, { title: searchQuery || "Grouped" });
          statusMessage = `Grouped ${tabIds.length} tab(s)`; await loadTabs();
        }
        break;
      case "merge":
        await mergeAllWindows(); statusMessage = "Merged all windows"; await loadTabs(); break;
      case "sort":
        await sortTabsInWindow(currentWindowId); statusMessage = "Sorted tabs by domain"; await loadTabs(); break;
      case "dedup": {
        const count = await removeDuplicates();
        statusMessage = count > 0 ? `Removed ${count} duplicate(s)` : "No duplicates found"; await loadTabs(); break;
      }
      case "mute":
        for (const id of tabIds) await muteTab(id, true); statusMessage = `Muted ${tabIds.length} tab(s)`; break;
      case "unmute":
        for (const id of tabIds) await muteTab(id, false); statusMessage = `Unmuted ${tabIds.length} tab(s)`; break;
      case "split":
        if (tabIds.length > 0) { await splitTabToWindow(tabIds[0]); statusMessage = "Split tab to new window"; } break;
      case "discard":
        if (tabIds.length > 0) { await discardTabs(tabIds); statusMessage = `Discarded ${tabIds.length} tab(s)`; } break;
      case "reload":
        for (const id of tabIds) chrome.tabs.reload(id); statusMessage = `Reloaded ${tabIds.length} tab(s)`; break;
    }
    query = "";
  }

  async function handleSelect(item: SearchResult) {
    if (item.tabId) { await switchToTab(item.tabId); window.close(); }
    else if (item.url) { await chrome.tabs.create({ url: item.url }); window.close(); }
  }

  function handleClose(item: SearchResult) {
    if (item.tabId) {
      closeTabs([item.tabId]);
      results = results.filter((r) => r.id !== item.id);
      allTabs = allTabs.filter((t) => t.id !== item.id);
      searchHaystack = allTabs.map((t) => `${t.title} ${t.url}`);
      loadTabs();
    }
  }

  function handleCommandSelect(cmd: CommandDefinition) {
    query = `/${cmd.prefix} `;
    paletteMode = "search";
    commandHints = [];
    updateResults();
  }

  function toggleSelect(tabId: number) {
    const next = new Set(selectedTabs);
    if (next.has(tabId)) next.delete(tabId); else next.add(tabId);
    selectedTabs = next;
  }

  async function dashAction(fn: () => Promise<string | void>) {
    const msg = await fn();
    if (msg) statusMessage = msg;
    await loadTabs();
    selectedTabs = new Set();
    setTimeout(() => { statusMessage = ""; }, 3000);
  }

  onMount(() => {
    loadTabs();
  });

  function onQueryChange() {
    updateResults();
  }
</script>

<div class="w-[400px] flex flex-col max-h-[560px] overflow-hidden">
  <!-- Search bar — always visible -->
  <div class="flex items-center gap-1.5 px-3 pt-3 pb-2">
    <div class="flex-1 min-w-0">
    <SearchInput
      bind:value={query}
      oninput={onQueryChange}
      placeholder="Search tabs... (/ for commands)"
      onkeydown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          cycleSearchMode();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          selectedIndex = Math.min(selectedIndex + 1, (paletteMode === "commands" ? commandHints.length : results.length) - 1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          selectedIndex = Math.max(selectedIndex - 1, 0);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (paletteMode === "commands" && commandHints[selectedIndex]) handleCommandSelect(commandHints[selectedIndex]);
          else if (results[selectedIndex]) handleSelect(results[selectedIndex]);
        } else if (e.key === "Delete" && e.ctrlKey && results[selectedIndex]) {
          e.preventDefault();
          handleClose(results[selectedIndex]);
        } else if (e.key === "Escape" && query) {
          e.preventDefault();
          query = "";
          onQueryChange();
        }
      }}
    />
    </div>
    <button
      class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold transition-colors
        {showHelp ? 'bg-primary text-white' : 'bg-surface-hover text-text-muted hover:text-text'}"
      onclick={() => { showHelp = !showHelp; }}
      title="Command guide"
    >?</button>
  </div>
  <div class="flex items-center gap-1 px-3 pb-1">
    {#each SEARCH_MODES as m, i}
      <button
        class="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors
          {i === searchModeIndex ? 'bg-primary text-white' : 'bg-surface-hover text-text-muted hover:text-text'}"
        onclick={() => { searchModeIndex = i; if (query) updateResults(); }}
      >{m.label}</button>
      {/each}
    <span class="text-[10px] text-text-muted ml-auto">Tab to cycle</span>
  </div>

  {#if showHelp}
    <!-- Help guide -->
    <div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
      <div class="text-xs font-semibold text-text mb-2">Command Guide</div>
      {#each (["search", "action"] as CommandCategory[]) as cat}
        <div class="flex items-center gap-2 mb-1 mt-2">
          <span class="text-[10px] font-semibold uppercase tracking-wider {CATEGORY_STYLES[cat].color}">{CATEGORY_STYLES[cat].label}</span>
          <div class="flex-1 h-px bg-border/50"></div>
        </div>
        {#each ALL_COMMANDS.filter(c => c.category === cat) as cmd}
          <button
            class="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover transition-colors text-left"
            onclick={() => { query = `/${cmd.prefix} `; showHelp = false; updateResults(); }}
          >
            <span class="font-mono text-xs font-medium w-16 shrink-0 {cmd.color}">{cmd.label}</span>
            <span class="text-xs text-text-muted">{cmd.description}</span>
          </button>
        {/each}
      {/each}
      <div class="mt-3 pt-2 border-t border-border">
        <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Keyboard</div>
        <div class="grid grid-cols-2 gap-y-1 text-xs text-text-muted">
          <span><kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px]">Tab</kbd> Cycle search mode</span>
          <span><kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px]">↑↓</kbd> Navigate results</span>
          <span><kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px]">Enter</kbd> Open / run</span>
          <span><kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px]">Ctrl+Del</kbd> Close tab</span>
          <span><kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px]">Esc</kbd> Clear / back</span>
          <span><kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px]">/</kbd> Commands</span>
        </div>
      </div>
    </div>
  {:else if showPalette}
    <!-- Command palette mode -->
    {#if paletteMode === "commands"}
      <CommandHints commands={commandHints} {selectedIndex} onselect={handleCommandSelect} />
    {:else}
      <ResultList {results} {selectedIndex} {loading} onselect={handleSelect} onclose={handleClose} />
    {/if}
  {:else}
    <!-- Dashboard mode -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <!-- Action buttons -->
      <div class="grid grid-cols-4 gap-1.5 px-3 pb-2">
        <ActionButton label="Sort All" icon="↕️" onclick={() => dashAction(async () => { await sortTabsInWindow(currentWindowId); return "Sorted"; })} />
        <ActionButton label="Group+" icon="📁" onclick={() => dashAction(async () => { await groupTabsByDomain("additive"); return "Grouped (kept existing)"; })} />
        <ActionButton label="Regroup" icon="🔀" onclick={() => dashAction(async () => { await groupTabsByDomain("rebuild"); return "Regrouped from scratch"; })} />
        <ActionButton label="Dedup" icon="🔄" onclick={() => dashAction(async () => { const n = await removeDuplicates(); return n > 0 ? `${n} removed` : "No dupes"; })} />
        <ActionButton label="Ungroup" icon="📤" onclick={() => dashAction(async () => { await ungroupAll(); return "Ungrouped all"; })} />
        <ActionButton label="Merge" icon="🔗" onclick={() => dashAction(async () => { await mergeAllWindows(); return "Merged"; })} />
        <ActionButton label="Close Sel." icon="✕" variant="danger" disabled={selectedTabs.size === 0}
          onclick={() => dashAction(async () => { await closeTabs([...selectedTabs]); return `Closed ${selectedTabs.size}`; })} />
        <ActionButton label="Discard Sel." icon="💤" disabled={selectedTabs.size === 0}
          onclick={() => dashAction(async () => { await discardTabs([...selectedTabs]); return `Discarded ${selectedTabs.size}`; })} />
      </div>

      <!-- Selection controls -->
      <div class="flex items-center gap-3 px-3 pb-2 text-xs">
        <button onclick={() => { selectedTabs = new Set(dashboardTabs.map((t) => t.id)); }} class="text-primary hover:text-primary-hover transition-colors">All</button>
        <button onclick={() => { selectedTabs = new Set(); }} class="text-text-muted hover:text-text transition-colors">None</button>
        {#if selectedTabs.size > 0}
          <span class="text-text-muted">{selectedTabs.size} selected</span>
        {/if}
      </div>

      <!-- Tab groups -->
      {#each [...groups.entries()] as [groupId, group]}
        <div class="mx-3 mb-2 border rounded-lg overflow-hidden {groupColors[group.color] || 'border-border'} {groupBg[group.color] || 'bg-surface-hover'}">
          <div class="flex items-center gap-2 px-2.5 py-1.5 border-b {groupColors[group.color] || 'border-border'}">
            <span class="w-2 h-2 rounded-full {dotColors[group.color] || 'bg-border'}"></span>
            <span class="text-xs font-medium text-text">{group.title}</span>
            <span class="text-[10px] text-text-muted">({group.tabs.length})</span>
            <div class="flex-1"></div>
            <button class="text-[10px] text-text-muted hover:text-text transition-colors"
              onclick={() => dashAction(async () => { await sortTabsInGroup(groupId); return `Sorted "${group.title}"`; })}>
              Sort
            </button>
          </div>
          <div class="p-1 grid gap-0.5">
            {#each group.tabs as tab}
              <TabCard {tab} selected={selectedTabs.has(tab.id)}
                ontoggle={() => toggleSelect(tab.id)}
                onclose={() => dashAction(async () => { await closeTabs([tab.id]); })} />
            {/each}
          </div>
        </div>
      {/each}

      <!-- Ungrouped -->
      {#if ungrouped.length > 0}
        <div class="mx-3 mb-2 border border-border rounded-lg">
          <div class="px-2.5 py-1.5 border-b border-border">
            <span class="text-xs font-medium text-text-muted">Ungrouped</span>
            <span class="text-[10px] text-text-muted ml-1">({ungrouped.length})</span>
          </div>
          <div class="p-1 grid gap-0.5">
            {#each ungrouped as tab}
              <TabCard {tab} selected={selectedTabs.has(tab.id)}
                ontoggle={() => toggleSelect(tab.id)}
                onclose={() => dashAction(async () => { await closeTabs([tab.id]); })} />
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <StatusBar tabCount={allTabs.length} message={statusMessage} />
</div>
