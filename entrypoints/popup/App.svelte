<script lang="ts">
  import { getAllTabs, getCurrentWindowTabs, switchToTab, closeTabs, sortTabsInWindow, groupTabsByDomain, removeDuplicates, mergeAllWindows, muteTab, splitTabToWindow, discardTabs } from "../../lib/tabs.ts";
  import { fuzzySearch, tabsToSearchItems, searchBookmarks, searchHistory, parseCommand, type SearchResult } from "../../lib/search.ts";
  import { matchCommands, type CommandDefinition } from "../../lib/commands.ts";
  import SearchInput from "../../components/SearchInput.svelte";
  import ResultList from "../../components/ResultList.svelte";
  import CommandHints from "../../components/CommandHints.svelte";
  import StatusBar from "../../components/StatusBar.svelte";

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let selectedIndex = $state(0);
  let commandHints = $state<CommandDefinition[]>([]);
  let statusMessage = $state("");
  let loading = $state(false);
  let mode = $state<"search" | "commands">("search");

  let allTabs = $state<SearchResult[]>([]);
  let searchHaystack = $state<string[]>([]);

  async function loadTabs() {
    const tabs = await getAllTabs();
    allTabs = tabsToSearchItems(tabs);
    searchHaystack = allTabs.map((t) => `${t.title} ${t.url}`);
    updateResults();
  }

  function updateResults() {
    const { prefix, query: searchQuery } = parseCommand(query);

    if (query.startsWith("/") && !query.includes(" ")) {
      commandHints = matchCommands(query);
      if (commandHints.length > 0 && searchQuery === "") {
        mode = "commands";
        results = [];
        return;
      }
    } else {
      commandHints = [];
    }

    mode = "search";

    if (prefix) {
      handlePrefixSearch(prefix, searchQuery);
    } else {
      const indices = fuzzySearch(searchHaystack, query);
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
          const indices = fuzzySearch(hay, searchQuery);
          results = indices.map((i) => items[i]);
          break;
        }
        case "p": {
          const pinned = allTabs.filter((t) => t.pinned);
          const hay = pinned.map((t) => `${t.title} ${t.url}`);
          const indices = fuzzySearch(hay, searchQuery);
          results = indices.map((i) => pinned[i]);
          break;
        }
        case "g": {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const groupTabs = activeTab?.groupId && activeTab.groupId !== -1
            ? allTabs.filter((t) => t.groupTitle === allTabs.find((at) => at.tabId === activeTab.id)?.groupTitle)
            : allTabs.filter((t) => !t.groupTitle);
          const hay = groupTabs.map((t) => `${t.title} ${t.url}`);
          const indices = fuzzySearch(hay, searchQuery);
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
    const matchingIndices = searchQuery ? fuzzySearch(searchHaystack, searchQuery) : [];
    const matchingTabs = matchingIndices.map((i) => allTabs[i]).filter((t) => t.tabId);
    const tabIds = matchingTabs.map((t) => t.tabId!);

    switch (prefix) {
      case "close":
        if (tabIds.length > 0) {
          await closeTabs(tabIds);
          statusMessage = `Closed ${tabIds.length} tab(s)`;
          await loadTabs();
        }
        break;
      case "group":
        if (tabIds.length > 0) {
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, { title: searchQuery || "Grouped" });
          statusMessage = `Grouped ${tabIds.length} tab(s)`;
          await loadTabs();
        }
        break;
      case "merge":
        await mergeAllWindows();
        statusMessage = "Merged all windows";
        await loadTabs();
        break;
      case "sort": {
        const win = await chrome.windows.getCurrent();
        await sortTabsInWindow(win.id!);
        statusMessage = "Sorted tabs by domain";
        await loadTabs();
        break;
      }
      case "dedup": {
        const count = await removeDuplicates();
        statusMessage = count > 0 ? `Removed ${count} duplicate(s)` : "No duplicates found";
        await loadTabs();
        break;
      }
      case "mute":
        for (const id of tabIds) await muteTab(id, true);
        statusMessage = `Muted ${tabIds.length} tab(s)`;
        break;
      case "unmute":
        for (const id of tabIds) await muteTab(id, false);
        statusMessage = `Unmuted ${tabIds.length} tab(s)`;
        break;
      case "split":
        if (tabIds.length > 0) {
          await splitTabToWindow(tabIds[0]);
          statusMessage = "Split tab to new window";
        }
        break;
      case "discard":
        if (tabIds.length > 0) {
          await discardTabs(tabIds);
          statusMessage = `Discarded ${tabIds.length} tab(s)`;
        }
        break;
      case "reload":
        for (const id of tabIds) chrome.tabs.reload(id);
        statusMessage = `Reloaded ${tabIds.length} tab(s)`;
        break;
      default:
        results = allTabs;
    }

    query = "";
  }

  async function handleSelect(item: SearchResult) {
    if (item.tabId) {
      await switchToTab(item.tabId);
      window.close();
    } else if (item.url) {
      await chrome.tabs.create({ url: item.url });
      window.close();
    }
  }

  function handleClose(item: SearchResult) {
    if (item.tabId) {
      closeTabs([item.tabId]);
      results = results.filter((r) => r.id !== item.id);
      allTabs = allTabs.filter((t) => t.id !== item.id);
      searchHaystack = allTabs.map((t) => `${t.title} ${t.url}`);
    }
  }

  function handleCommandSelect(cmd: CommandDefinition) {
    query = `/${cmd.prefix} `;
    mode = "search";
    commandHints = [];
    updateResults();
  }

  function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL("/dashboard.html") });
    window.close();
  }

  $effect(() => {
    loadTabs();
  });

  $effect(() => {
    query;
    updateResults();
  });
</script>

<div class="w-[420px] flex flex-col max-h-[520px]">
  <div class="flex items-center gap-1 px-3 pt-3 pb-1">
    <div class="flex-1">
      <SearchInput
        bind:value={query}
        placeholder="Search tabs... (/ for commands)"
        onkeydown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, (mode === "commands" ? commandHints.length : results.length) - 1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (mode === "commands" && commandHints[selectedIndex]) {
              handleCommandSelect(commandHints[selectedIndex]);
            } else if (results[selectedIndex]) {
              handleSelect(results[selectedIndex]);
            }
          } else if (e.key === "Delete" && e.ctrlKey && results[selectedIndex]) {
            e.preventDefault();
            handleClose(results[selectedIndex]);
          }
        }}
      />
    </div>
    <button
      onclick={openDashboard}
      class="shrink-0 p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
      title="Open Dashboard"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    </button>
  </div>

  {#if mode === "commands"}
    <CommandHints
      commands={commandHints}
      {selectedIndex}
      onselect={handleCommandSelect}
    />
  {:else}
    <ResultList
      {results}
      {selectedIndex}
      {loading}
      onselect={handleSelect}
      onclose={handleClose}
    />
  {/if}

  <StatusBar
    tabCount={allTabs.length}
    message={statusMessage}
  />
</div>
