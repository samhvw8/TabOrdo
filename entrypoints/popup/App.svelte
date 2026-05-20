<script lang="ts">
  import { onMount } from "svelte";
  import { getAllTabs, getCurrentWindowTabs, switchToTab, closeTabs, sortTabsInWindow, sortTabsInGroup, groupTabsByDomain, ungroupAll, removeDuplicates, mergeAllWindows, muteTab, splitTabToWindow, discardTabs, type TabInfo } from "../../lib/tabs.ts";
  import { search, tabsToSearchItems, searchBookmarks, searchHistory, parseCommand, SEARCH_MODES, type SearchResult, type SearchMode } from "../../lib/search.ts";
  import { getAutoGroup, setAutoGroup, getUseRules, setUseRules } from "../../lib/rules.ts";
  import { matchCommands, ALL_COMMANDS, CATEGORY_STYLES, type CommandDefinition, type CommandCategory } from "../../lib/commands.ts";
  import { snapshotBeforeClose, snapshotBeforeGroup, executeUndo, peekUndo } from "../../lib/undo.ts";
  import SearchInput from "../../components/SearchInput.svelte";
  import ResultList from "../../components/ResultList.svelte";
  import CommandHints from "../../components/CommandHints.svelte";
  import ActionButton from "../../components/ActionButton.svelte";
  import TabCard from "../../components/TabCard.svelte";
  import RulesEditor from "../../components/RulesEditor.svelte";

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
  let showRules = $state(false);

  function cycleSearchMode() {
    searchModeIndex = (searchModeIndex + 1) % SEARCH_MODES.length;
    if (query) updateResults();
  }

  let autoGroupEnabled = $state(false);
  let useRulesEnabled = $state(false);
  let inputFocused = $state(true);
  let canUndo = $state(false);

  async function handleUndo() {
    const msg = await executeUndo();
    statusMessage = msg;
    canUndo = !!peekUndo();
    await loadTabs();
    setTimeout(() => { statusMessage = ""; }, 3000);
  }
  let collapsedGroups = $state<Set<number>>(new Set());

  function setCollapsed(s: Set<number>) {
    collapsedGroups = s;
    chrome.storage.local.set({ collapsedGroups: [...s] });
  }

  function toggleGroupCollapse(groupId: number) {
    const next = new Set(collapsedGroups);
    if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
    setCollapsed(next);
  }

  let allTabs = $state<SearchResult[]>([]);
  let searchHaystack = $state<string[]>([]);

  interface WindowData {
    windowId: number;
    isCurrent: boolean;
    groups: Map<number, { title: string; color: string; tabs: TabInfo[] }>;
    ungrouped: TabInfo[];
    tabCount: number;
  }

  let windows = $state<WindowData[]>([]);
  let dashboardTabs = $state<TabInfo[]>([]);
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
    dashboardTabs = tabs;

    const windowMap = new Map<number, WindowData>();
    for (const tab of tabs) {
      if (!windowMap.has(tab.windowId)) {
        windowMap.set(tab.windowId, {
          windowId: tab.windowId,
          isCurrent: tab.windowId === currentWindowId,
          groups: new Map(),
          ungrouped: [],
          tabCount: 0,
        });
      }
      const w = windowMap.get(tab.windowId)!;
      w.tabCount++;
      if (tab.groupId !== -1) {
        if (!w.groups.has(tab.groupId)) {
          w.groups.set(tab.groupId, { title: tab.groupTitle || "Unnamed", color: tab.groupColor || "grey", tabs: [] });
        }
        w.groups.get(tab.groupId)!.tabs.push(tab);
      } else {
        w.ungrouped.push(tab);
      }
    }

    windows = [...windowMap.values()].sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return b.tabCount - a.tabCount;
    });
  }

  async function updateResults() {
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
      const tabResults = indices.map((i) => allTabs[i]);

      if (query.trim().length >= 2) {
        const [bookmarkResults, historyResults] = await Promise.all([
          searchBookmarks(query, 5),
          searchHistory(query, 5),
        ]);
        results = [
          ...tabResults,
          ...(bookmarkResults.length > 0 ? [{ type: "divider" as const, id: "div-bookmarks", title: "Bookmarks", url: "" }, ...bookmarkResults] : []),
          ...(historyResults.length > 0 ? [{ type: "divider" as const, id: "div-history", title: "History", url: "" }, ...historyResults] : []),
        ];
      } else {
        results = tabResults;
      }
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
          if (ACTION_PREFIXES.has(prefix)) {
            const indices = searchQuery ? search(searchHaystack, searchQuery, searchMode) : [];
            results = indices.map((i) => allTabs[i]);
          } else {
            const indices = search(searchHaystack, `/${prefix} ${searchQuery}`, searchMode);
            results = indices.map((i) => allTabs[i]);
          }
      }
    } finally {
      loading = false;
    }
    selectedIndex = 0;
  }

  const ACTION_PREFIXES = new Set(["close", "group", "merge", "sort", "dedup", "mute", "unmute", "split", "discard", "reload"]);

  async function handleActionCommand(prefix: string, searchQuery: string) {
    if (!ACTION_PREFIXES.has(prefix)) return;

    const matchingIndices = searchQuery ? search(searchHaystack, searchQuery, searchMode) : [];
    const matchingTabs = matchingIndices.map((i) => allTabs[i]).filter((t) => t.tabId);
    const tabIds = matchingTabs.map((t) => t.tabId!);
    let acted = false;

    switch (prefix) {
      case "close":
        if (tabIds.length > 0) { await snapshotBeforeClose(tabIds); await closeTabs(tabIds); statusMessage = `Closed ${tabIds.length} tab(s)`; await loadTabs(); acted = true; }
        break;
      case "group":
        if (tabIds.length > 0) {
          await snapshotBeforeGroup();
          const gid = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(gid, { title: searchQuery || "Grouped" });
          statusMessage = `Grouped ${tabIds.length} tab(s)`; await loadTabs(); acted = true;
        }
        break;
      case "merge":
        await snapshotBeforeGroup(); await mergeAllWindows(); statusMessage = "Merged all windows"; await loadTabs(); acted = true; break;
      case "sort":
        await snapshotBeforeGroup(); await sortTabsInWindow(currentWindowId); statusMessage = "Sorted tabs by domain"; await loadTabs(); acted = true; break;
      case "dedup": {
        await snapshotBeforeGroup();
        const count = await removeDuplicates();
        statusMessage = count > 0 ? `Removed ${count} duplicate(s)` : "No duplicates found"; await loadTabs(); acted = true; break;
      }
      case "mute":
        if (tabIds.length > 0) { for (const id of tabIds) await muteTab(id, true); statusMessage = `Muted ${tabIds.length} tab(s)`; acted = true; }
        break;
      case "unmute":
        if (tabIds.length > 0) { for (const id of tabIds) await muteTab(id, false); statusMessage = `Unmuted ${tabIds.length} tab(s)`; acted = true; }
        break;
      case "split":
        if (tabIds.length > 0) { await splitTabToWindow(tabIds[0]); statusMessage = "Split tab to new window"; acted = true; }
        break;
      case "discard":
        if (tabIds.length > 0) { await discardTabs(tabIds); statusMessage = `Discarded ${tabIds.length} tab(s)`; acted = true; }
        break;
      case "reload":
        if (tabIds.length > 0) { for (const id of tabIds) chrome.tabs.reload(id); statusMessage = `Reloaded ${tabIds.length} tab(s)`; acted = true; }
        break;
    }
    if (acted) {
      query = "";
      canUndo = !!peekUndo();
      await loadTabs();
    }
  }

  async function handleSelect(item: SearchResult) {
    if (item.tabId) { await switchToTab(item.tabId); window.close(); }
    else if (item.url) { await chrome.tabs.create({ url: item.url }); window.close(); }
  }

  async function handleClose(item: SearchResult) {
    if (item.tabId) {
      await snapshotBeforeClose([item.tabId]);
      await closeTabs([item.tabId]);
      canUndo = true;
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

  function toggleSelectGroup(tabIds: number[]) {
    const allSelected = tabIds.every((id) => selectedTabs.has(id));
    const next = new Set(selectedTabs);
    if (allSelected) {
      for (const id of tabIds) next.delete(id);
    } else {
      for (const id of tabIds) next.add(id);
    }
    selectedTabs = next;
  }

  async function dashAction(fn: () => Promise<string | void>) {
    const msg = await fn();
    if (msg) statusMessage = msg;
    canUndo = !!peekUndo();
    await loadTabs();
    selectedTabs = new Set();
    setTimeout(() => { statusMessage = ""; }, 3000);
  }

  onMount(async () => {
    loadTabs();
    autoGroupEnabled = await getAutoGroup();
    useRulesEnabled = await getUseRules();
    const stored = await chrome.storage.local.get("collapsedGroups");
    if (stored.collapsedGroups) collapsedGroups = new Set(stored.collapsedGroups);
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
      onfocuschange={(f) => { inputFocused = f; }}
      onkeydown={(e) => {
        if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          cycleSearchMode();
        } else if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          const hints = matchCommands(query);
          if (query.startsWith("/") && hints.length > 0) {
            const target = paletteMode === "commands" && hints[selectedIndex] ? hints[selectedIndex] : hints[0];
            handleCommandSelect(target);
          }
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          selectedIndex = Math.min(selectedIndex + 1, (paletteMode === "commands" ? commandHints.length : results.length) - 1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          selectedIndex = Math.max(selectedIndex - 1, 0);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const { prefix, query: searchQuery } = parseCommand(query);
          if (prefix && ACTION_PREFIXES.has(prefix)) {
            handleActionCommand(prefix, searchQuery);
          } else if (paletteMode === "commands" && commandHints[selectedIndex]) {
            handleCommandSelect(commandHints[selectedIndex]);
          } else if (results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
          }
        } else if (e.key === "Delete" && e.ctrlKey && results[selectedIndex]) {
          e.preventDefault();
          handleClose(results[selectedIndex]);
        } else if (e.key === "z" && (e.ctrlKey || e.metaKey) && canUndo) {
          e.preventDefault();
          handleUndo();
        } else if (e.key === "Escape" && query) {
          e.preventDefault();
          query = "";
          onQueryChange();
        }
      }}
    />
    </div>
    <button
      class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors
        {showRules ? 'bg-primary text-white' : 'bg-surface-hover text-text-muted hover:text-text'}"
      onclick={() => { showRules = !showRules; showHelp = false; }}
      title="Group rules"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
    <button
      class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold transition-colors
        {showHelp ? 'bg-primary text-white' : 'bg-surface-hover text-text-muted hover:text-text'}"
      onclick={() => { showHelp = !showHelp; showRules = false; }}
      title="Command guide"
    >?</button>
  </div>
  {#if inputFocused}
    <div class="flex items-center gap-1 px-3 pb-1">
      {#each SEARCH_MODES as m, i}
        <button
          class="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors
            {i === searchModeIndex ? 'bg-primary text-white' : 'bg-surface-hover text-text-muted hover:text-text'}"
          onmousedown={(e) => { e.preventDefault(); searchModeIndex = i; if (query) updateResults(); }}
        >{m.label}</button>
      {/each}
      <span class="text-[10px] text-text-muted ml-auto">⇧Tab cycle</span>
    </div>
  {/if}

  {#if showRules}
    <RulesEditor onclose={() => { showRules = false; }} />
  {:else if showHelp}
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
        <ActionButton label="Sort All" icon="↕️" tooltip="Sort tabs by domain. Groups left, ungrouped right." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await sortTabsInWindow(currentWindowId); return "Sorted"; })} />
        <ActionButton label="Group+" icon="📁" tooltip="Group ungrouped tabs by domain. Keeps existing groups." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await groupTabsByDomain("additive"); return "Grouped"; })} />
        <ActionButton label="Regroup" icon="🔀" tooltip="Ungroup everything, then regroup all from scratch." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await groupTabsByDomain("rebuild"); return "Regrouped"; })} />
        <ActionButton label="Dedup" icon="🔄" tooltip="Close duplicate tabs. Keeps most recently accessed." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); const n = await removeDuplicates(); return n > 0 ? `${n} removed` : "No dupes"; })} />
        <ActionButton label="Ungroup" icon="📤" tooltip="Remove all tab groups. Tabs stay in place." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await ungroupAll(); return "Ungrouped all"; })} />
        <ActionButton label="Merge" icon="🔗" tooltip="Move all tabs from other windows here." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await mergeAllWindows(); return "Merged"; })} />
        <ActionButton label="Close Sel." icon="✕" variant="danger" disabled={selectedTabs.size === 0}
          tooltip="Close all selected tabs." onclick={() => dashAction(async () => { await snapshotBeforeClose([...selectedTabs]); await closeTabs([...selectedTabs]); return `Closed ${selectedTabs.size}`; })} />
        <ActionButton label="Discard Sel." icon="💤" disabled={selectedTabs.size === 0}
          tooltip="Suspend selected tabs to free memory." onclick={() => dashAction(async () => { await discardTabs([...selectedTabs]); return `Discarded ${selectedTabs.size}`; })} />
      </div>

      <!-- Toggles -->
      <div class="flex items-center gap-1.5 px-3 pb-2">
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-colors
            {useRulesEnabled ? 'bg-accent-green/15 text-accent-green border border-accent-green/30' : 'bg-surface-hover text-text-muted border border-border'}"
          onclick={async () => { useRulesEnabled = !useRulesEnabled; await setUseRules(useRulesEnabled); }}
          title="When ON, Group+ and Regroup use your custom rules to merge multiple domains into one group. Configure rules with the ⚙ button."
        >
          <span class="w-2 h-2 rounded-full {useRulesEnabled ? 'bg-accent-green' : 'bg-border'}"></span>
          Rules
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-colors
            {autoGroupEnabled ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-surface-hover text-text-muted border border-border'}"
          onclick={async () => { autoGroupEnabled = !autoGroupEnabled; await setAutoGroup(autoGroupEnabled); }}
          title="When ON (and Rules is ON), new tabs are automatically grouped by matching rules as they load."
        >
          <span class="w-2 h-2 rounded-full {autoGroupEnabled ? 'bg-primary' : 'bg-border'}"></span>
          Auto
        </button>
      </div>

      <!-- Selection + collapse controls -->
      <div class="flex items-center gap-3 px-3 pb-2 text-xs">
        <button onmousedown={(e) => { e.preventDefault(); selectedTabs = new Set(dashboardTabs.map((t) => t.id)); }} class="text-primary hover:text-primary-hover transition-colors">All</button>
        <button onmousedown={(e) => { e.preventDefault(); selectedTabs = new Set(); }} class="text-text-muted hover:text-text transition-colors">None</button>
        {#if selectedTabs.size > 0}
          <span class="text-text-muted">{selectedTabs.size} selected</span>
        {/if}
        <div class="flex-1"></div>
        <button
          onmousedown={(e) => { e.preventDefault(); const all = new Set<number>(); windows.forEach(w => { w.groups.forEach((_, k) => all.add(k)); all.add(-w.windowId); }); setCollapsed(all); }}
          class="text-text-muted hover:text-text transition-colors">Fold</button>
        <button
          onmousedown={(e) => { e.preventDefault(); setCollapsed(new Set()); }}
          class="text-text-muted hover:text-text transition-colors">Unfold</button>
      </div>

      {#each windows as w, wi}
        {@const winCollapseKey = -(w.windowId + 100000)}
        {@const winCollapsed = collapsedGroups.has(winCollapseKey)}
        {@const winTabs = [...[...w.groups.values()].flatMap(g => g.tabs), ...w.ungrouped]}
        {@const winAllSelected = winTabs.length > 0 && winTabs.every(t => selectedTabs.has(t.id))}
        {@const winSomeSelected = winTabs.some(t => selectedTabs.has(t.id))}
        {#if wi > 0}
          <div class="mx-3 my-2 border-t border-border"></div>
        {/if}
        <div class="px-3 pb-1 flex items-center gap-2">
          <input type="checkbox" checked={winAllSelected} indeterminate={winSomeSelected && !winAllSelected}
            onchange={() => toggleSelectGroup(winTabs.map(t => t.id))}
            class="shrink-0 w-3 h-3 rounded accent-primary" title="Select all tabs in this window" />
          <button class="flex items-center gap-2 flex-1" onclick={() => toggleGroupCollapse(winCollapseKey)}>
            <svg class="w-3 h-3 text-text-muted transition-transform shrink-0 {winCollapsed ? '' : 'rotate-90'}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            <span class="text-[10px] font-semibold uppercase tracking-wider {w.isCurrent ? 'text-primary' : 'text-text-muted'}">
              {w.isCurrent ? "Current Window" : `Window ${wi + 1}`}
            </span>
            <span class="text-[10px] text-text-muted">({w.tabCount})</span>
          </button>
          <div class="flex-1 h-px bg-border/40"></div>
        </div>

        {#if !winCollapsed}
        {#each [...w.groups.entries()] as [groupId, group]}
          {@const collapsed = collapsedGroups.has(groupId)}
          {@const allSelected = group.tabs.every((t) => selectedTabs.has(t.id))}
          {@const someSelected = group.tabs.some((t) => selectedTabs.has(t.id))}
          <div class="mx-3 mb-2 border rounded-lg overflow-hidden {groupColors[group.color] || 'border-border'} {groupBg[group.color] || 'bg-surface-hover'}">
            <div class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:brightness-110 cursor-pointer
              {collapsed ? '' : 'border-b'} {groupColors[group.color] || 'border-border'}">
              <input type="checkbox" checked={allSelected} indeterminate={someSelected && !allSelected}
                onchange={() => toggleSelectGroup(group.tabs.map(t => t.id))} onclick={(e) => e.stopPropagation()}
                class="shrink-0 w-3 h-3 rounded accent-primary" title="Select all tabs in this group" />
              <button class="flex items-center gap-2 flex-1 min-w-0" onclick={() => toggleGroupCollapse(groupId)}>
                <svg class="w-3 h-3 text-text-muted transition-transform shrink-0 {collapsed ? '' : 'rotate-90'}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                <span class="w-2 h-2 rounded-full shrink-0 {dotColors[group.color] || 'bg-border'}"></span>
                <span class="text-xs font-medium text-text truncate">{group.title}</span>
                <span class="text-[10px] text-text-muted shrink-0">({group.tabs.length})</span>
              </button>
              <span class="text-[10px] text-text-muted hover:text-text transition-colors shrink-0 cursor-pointer"
                onclick={(e) => { e.stopPropagation(); dashAction(async () => { await sortTabsInGroup(groupId); return `Sorted "${group.title}"`; }); }}
                role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}>Sort</span>
            </div>
            {#if !collapsed}
              <div class="p-1 grid gap-0.5">
                {#each group.tabs as tab}
                  <TabCard {tab} selected={selectedTabs.has(tab.id)}
                    ontoggle={() => toggleSelect(tab.id)}
                    onclose={() => dashAction(async () => { await closeTabs([tab.id]); })} />
                {/each}
              </div>
            {/if}
          </div>
        {/each}

        {#if w.ungrouped.length > 0}
          {@const ungroupedKey = -w.windowId}
          {@const ungroupedCollapsed = collapsedGroups.has(ungroupedKey)}
          {@const allUngroupedSelected = w.ungrouped.every((t) => selectedTabs.has(t.id))}
          {@const someUngroupedSelected = w.ungrouped.some((t) => selectedTabs.has(t.id))}
          <div class="mx-3 mb-2 border border-border rounded-lg overflow-hidden">
            <div class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover cursor-pointer
              {ungroupedCollapsed ? '' : 'border-b border-border'}">
              <input type="checkbox" checked={allUngroupedSelected} indeterminate={someUngroupedSelected && !allUngroupedSelected}
                onchange={() => toggleSelectGroup(w.ungrouped.map(t => t.id))} onclick={(e) => e.stopPropagation()}
                class="shrink-0 w-3 h-3 rounded accent-primary" title="Select all ungrouped tabs" />
              <button class="flex items-center gap-2 flex-1" onclick={() => toggleGroupCollapse(ungroupedKey)}>
                <svg class="w-3 h-3 text-text-muted transition-transform {ungroupedCollapsed ? '' : 'rotate-90'}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                <span class="text-xs font-medium text-text-muted">Ungrouped</span>
                <span class="text-[10px] text-text-muted">({w.ungrouped.length})</span>
              </button>
            </div>
            {#if !ungroupedCollapsed}
              <div class="p-1 grid gap-0.5">
                {#each w.ungrouped as tab}
                  <TabCard {tab} selected={selectedTabs.has(tab.id)}
                    ontoggle={() => toggleSelect(tab.id)}
                    onclose={() => dashAction(async () => { await closeTabs([tab.id]); })} />
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        {/if}
      {/each}
    </div>
  {/if}

  <div class="flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-text-muted">
    <span>{allTabs.length} tab{allTabs.length !== 1 ? "s" : ""}</span>
    {#if statusMessage}
      <span class="text-accent-green">{statusMessage}</span>
    {/if}
    {#if canUndo}
      <button
        class="px-1.5 py-0.5 rounded bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20 text-[10px] font-medium transition-colors"
        onclick={handleUndo}
        title="Undo last action (Ctrl+Z)"
      >Undo</button>
    {:else if !statusMessage}
      <span>
        <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px]">↑↓</kbd> navigate
        <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px] ml-1">↵</kbd> open
        <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px] ml-1">Ctrl+Z</kbd> undo
      </span>
    {/if}
  </div>
</div>
