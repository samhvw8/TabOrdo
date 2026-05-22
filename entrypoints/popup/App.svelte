<script lang="ts">
  import { onMount } from "svelte";
  import { getAllTabs, getCurrentWindowTabs, switchToTab, closeTabs, sortTabsInWindow, sortTabsInGroup, groupTabsByDomain, ungroupAll, removeDuplicates, mergeAllWindows, muteTab, setTabVolume, splitTabToWindow, extractGroupToWindow, discardTabs, closeTabsToLeft, closeTabsToRight, closeTabsSameSite, closeOldTabs, shuffleTabs, uniteDomain, isolateDomain, splitWindow, splitByDomain, stackWindows, type TabInfo } from "../../lib/tabs.ts";
  import { archiveTabs, getArchiveCount } from "../../lib/archive.ts";
  import { search, tabsToSearchItems, searchBookmarks, searchHistory, parseCommand, buildSearchHaystack, SEARCH_MODES, type SearchResult, type SearchMode } from "../../lib/search.ts";
  import { getAutoGroup, setAutoGroup, getUseRules, setUseRules, getAutoSort, setAutoSort, getAutoPinFollow, setAutoPinFollow, getAutoDiscard, setAutoDiscard } from "../../lib/rules.ts";
  import { matchCommands, ALL_COMMANDS, ACTION_COMMANDS, TRIAGE_COMMANDS, CATEGORY_STYLES, type CommandDefinition, type CommandCategory } from "../../lib/commands.ts";
  import { snapshotBeforeClose, snapshotBeforeGroup, executeUndo, peekUndo, loadUndoStack } from "../../lib/undo.ts";
  import { focusMode, unfocusMode, hasSavedWorkspace, exportTabsToFile, loadTabsFromText } from "../../lib/workspace.ts";
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
  let showActions = $state(false);

  function cycleSearchMode() {
    searchModeIndex = (searchModeIndex + 1) % SEARCH_MODES.length;
    if (query) updateResults();
  }

  let autoGroupEnabled = $state(false);
  let useRulesEnabled = $state(false);
  let autoSortEnabled = $state(false);
  let autoPinFollowEnabled = $state(false);
  let autoDiscardEnabled = $state(false);
  let hasWorkspace = $state(false);
  let inputFocused = $state(true);
  let canUndo = $state(false);
  let archiveCount = $state(0);
  let fileInputEl = $state<HTMLInputElement | undefined>(undefined);
  let busy = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingConfirm = $state<string | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  function confirmAction(id: string, action: () => void) {
    if (pendingConfirm === id) {
      clearTimeout(confirmTimer);
      pendingConfirm = null;
      action();
    } else {
      pendingConfirm = id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { pendingConfirm = null; }, 3000);
    }
  }

  async function withBulkLock<T>(fn: () => Promise<T>): Promise<T> {
    await chrome.storage.session.set({ bulkOpInProgress: true }).catch(() => {});
    try {
      return await fn();
    } finally {
      await chrome.storage.session.set({ bulkOpInProgress: false }).catch(() => {});
    }
  }

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
    searchHaystack = buildSearchHaystack(allTabs);
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

    if ((query.startsWith("/") || query.startsWith("@")) && !query.includes(" ")) {
      commandHints = matchCommands(query);
      if (commandHints.length > 0) {
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
      results = tabResults;

      clearTimeout(searchTimer);
      if (query.trim().length >= 2) {
        const capturedQuery = query;
        searchTimer = setTimeout(async () => {
          const [bookmarkResults, historyResults] = await Promise.all([
            searchBookmarks(capturedQuery, 5),
            searchHistory(capturedQuery, 5),
          ]);
          if (query !== capturedQuery) return;
          const freshIndices = search(searchHaystack, capturedQuery, searchMode);
          const freshTabResults = freshIndices.map((i) => allTabs[i]);
          results = [
            ...freshTabResults,
            ...(bookmarkResults.length > 0 ? [{ type: "divider" as const, id: "div-bookmarks", title: "Bookmarks", url: "" }, ...bookmarkResults] : []),
            ...(historyResults.length > 0 ? [{ type: "divider" as const, id: "div-history", title: "History", url: "" }, ...historyResults] : []),
          ];
        }, 200);
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
          const hay = buildSearchHaystack(items);
          const indices = search(hay, searchQuery, searchMode);
          results = indices.map((i) => items[i]);
          break;
        }
        case "p": {
          const pinned = allTabs.filter((t) => t.pinned);
          const hay = buildSearchHaystack(pinned);
          const indices = search(hay, searchQuery, searchMode);
          results = indices.map((i) => pinned[i]);
          break;
        }
        case "g": {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const activeGroupId = activeTab?.groupId ?? -1;
          const groupTabs = activeGroupId !== -1
            ? allTabs.filter((t) => t.groupId === activeGroupId)
            : allTabs.filter((t) => !t.groupId || t.groupId === -1);
          const hay = buildSearchHaystack(groupTabs);
          const indices = search(hay, searchQuery, searchMode);
          results = indices.map((i) => groupTabs[i]);
          break;
        }
        case "@": {
          const triageResults: SearchResult[] = [];
          const audioTabs = allTabs.filter((t) => t.audible);
          const mutedTabs = allTabs.filter((t) => t.muted);
          const dupTabs = findDuplicateTabs(allTabs);
          const recentTabs = [...allTabs].filter((t) => t.type === "tab").sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)).slice(0, 15);
          const suspendedTabs = allTabs.filter((t) => t.discarded);

          if (searchQuery) {
            const all = [...new Map([...audioTabs, ...mutedTabs, ...dupTabs, ...recentTabs, ...suspendedTabs].map((t) => [t.id, t])).values()];
            const hay = buildSearchHaystack(all);
            const indices = search(hay, searchQuery, searchMode);
            results = indices.map((i) => all[i]);
          } else {
            if (audioTabs.length > 0) { triageResults.push({ type: "divider", id: "div-triage-audio", title: `Playing Audio (${audioTabs.length})`, url: "" }); triageResults.push(...audioTabs); }
            if (mutedTabs.length > 0) { triageResults.push({ type: "divider", id: "div-triage-muted", title: `Muted (${mutedTabs.length})`, url: "" }); triageResults.push(...mutedTabs); }
            if (dupTabs.length > 0) { triageResults.push({ type: "divider", id: "div-triage-dupes", title: `Duplicates (${dupTabs.length})`, url: "" }); triageResults.push(...dupTabs); }
            if (recentTabs.length > 0) { triageResults.push({ type: "divider", id: "div-triage-recent", title: "Recently Active", url: "" }); triageResults.push(...recentTabs); }
            if (suspendedTabs.length > 0) { triageResults.push({ type: "divider", id: "div-triage-suspended", title: `Suspended (${suspendedTabs.length})`, url: "" }); triageResults.push(...suspendedTabs); }
            results = triageResults.length > 0 ? triageResults : [];
            if (triageResults.length === 0) statusMessage = "All clear — no tabs need attention";
          }
          break;
        }
        case "@a": {
          const audio = allTabs.filter((t) => t.audible);
          if (searchQuery) { const hay = buildSearchHaystack(audio); const indices = search(hay, searchQuery, searchMode); results = indices.map((i) => audio[i]); }
          else results = audio;
          break;
        }
        case "@m": {
          const muted = allTabs.filter((t) => t.muted);
          if (searchQuery) { const hay = buildSearchHaystack(muted); const indices = search(hay, searchQuery, searchMode); results = indices.map((i) => muted[i]); }
          else results = muted;
          break;
        }
        case "@d": {
          const dupes = findDuplicateTabs(allTabs);
          if (searchQuery) { const hay = buildSearchHaystack(dupes); const indices = search(hay, searchQuery, searchMode); results = indices.map((i) => dupes[i]); }
          else results = dupes;
          break;
        }
        case "@r": {
          const recent = [...allTabs].filter((t) => t.type === "tab").sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)).slice(0, 20);
          if (searchQuery) { const hay = buildSearchHaystack(recent); const indices = search(hay, searchQuery, searchMode); results = indices.map((i) => recent[i]); }
          else results = recent;
          break;
        }
        case "@s": {
          const suspended = allTabs.filter((t) => t.discarded);
          if (searchQuery) { const hay = buildSearchHaystack(suspended); const indices = search(hay, searchQuery, searchMode); results = indices.map((i) => suspended[i]); }
          else results = suspended;
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

  const ACTION_PREFIXES = new Set(ACTION_COMMANDS.map((c) => c.prefix));

  function findDuplicateTabs(tabs: SearchResult[]): SearchResult[] {
    const urlMap = new Map<string, SearchResult[]>();
    for (const tab of tabs) {
      if (tab.type !== "tab" || !tab.url) continue;
      const existing = urlMap.get(tab.url);
      if (existing) existing.push(tab);
      else urlMap.set(tab.url, [tab]);
    }
    const dupes: SearchResult[] = [];
    for (const group of urlMap.values()) {
      if (group.length > 1) dupes.push(...group);
    }
    return dupes;
  }

  async function handleActionCommand(prefix: string, searchQuery: string) {
    if (!ACTION_PREFIXES.has(prefix)) return;
    if (busy) return;
    busy = true;

    try {
    await chrome.storage.session.set({ bulkOpInProgress: true }).catch(() => {});
    const matchingIndices = searchQuery ? search(searchHaystack, searchQuery, searchMode) : [];
    const matchingTabs = matchingIndices.map((i) => allTabs[i]).filter((t) => t.tabId);
    const tabIds = matchingTabs.map((t) => t.tabId!);
    let acted = false;

    switch (prefix) {
      case "close":
        if (tabIds.length > 0) { await snapshotBeforeClose(tabIds); await closeTabs(tabIds); statusMessage = `Closed ${tabIds.length} tab(s)`; acted = true; }
        break;
      case "closeleft": {
        const n = await closeTabsToLeft();
        statusMessage = n > 0 ? `Closed ${n} tab(s) to left` : "None to close";
        acted = true;
        break;
      }
      case "closeright": {
        const n = await closeTabsToRight();
        statusMessage = n > 0 ? `Closed ${n} tab(s) to right` : "None to close";
        acted = true;
        break;
      }
      case "closeold": {
        const n = await closeOldTabs();
        statusMessage = n > 0 ? `Closed ${n} old tab(s)` : "No old tabs found";
        acted = true;
        break;
      }
      case "closesite": {
        const n = await closeTabsSameSite();
        statusMessage = n > 0 ? `Closed ${n} same-site tab(s)` : "No other tabs from this site";
        acted = true;
        break;
      }
      case "archive":
        if (tabIds.length > 0) {
          const tabData = matchingTabs.map((t) => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl, groupName: t.groupTitle }));
          const archived = await archiveTabs(tabData);
          await closeTabs(tabIds);
          statusMessage = `Archived ${archived} tab(s)`;
          acted = true;
        }
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
        else if (!searchQuery) { const [active] = await chrome.tabs.query({ active: true, currentWindow: true }); if (active?.id) { await muteTab(active.id, true); statusMessage = "Muted active tab"; acted = true; } }
        break;
      case "unmute":
        if (tabIds.length > 0) { for (const id of tabIds) await muteTab(id, false); statusMessage = `Unmuted ${tabIds.length} tab(s)`; acted = true; }
        else if (!searchQuery) { const [active] = await chrome.tabs.query({ active: true, currentWindow: true }); if (active?.id) { await muteTab(active.id, false); statusMessage = "Unmuted active tab"; acted = true; } }
        break;
      case "split":
        if (tabIds.length > 0) { await splitTabToWindow(tabIds[0]); statusMessage = "Split tab to new window"; acted = true; }
        break;
      case "extract": {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.groupId && activeTab.groupId !== -1) {
          await chrome.windows.create({ tabId: activeTab.id! });
          statusMessage = "Extracted tab to new window";
          acted = true;
        } else {
          statusMessage = "Active tab is not in a group";
          acted = true;
        }
        break;
      }
      case "shuffle":
        await snapshotBeforeGroup(); await shuffleTabs(); statusMessage = "Shuffled tabs"; acted = true; break;
      case "unite": {
        const n = await uniteDomain();
        statusMessage = n > 0 ? `United ${n} tab(s) from other windows` : "No matching tabs in other windows";
        acted = true; break;
      }
      case "isolate": {
        const n = await isolateDomain();
        statusMessage = n > 0 ? `Isolated ${n} tab(s) to new window` : "Not enough tabs to isolate";
        acted = true; break;
      }
      case "splitv":
        await snapshotBeforeGroup(); await splitWindow("vertical"); statusMessage = "Split vertically"; acted = true; break;
      case "splith":
        await snapshotBeforeGroup(); await splitWindow("horizontal"); statusMessage = "Split horizontally"; acted = true; break;
      case "splitdomain": {
        await snapshotBeforeGroup();
        const n = await splitByDomain();
        statusMessage = n > 0 ? `Split into ${n + 1} window(s)` : "Only one domain"; acted = true; break;
      }
      case "stack":
        await stackWindows(); statusMessage = "Stacked windows"; acted = true; break;
      case "focus": {
        const n = await focusMode();
        hasWorkspace = true;
        statusMessage = `Saved ${n} tab(s), focus mode on`; acted = true; break;
      }
      case "unfocus": {
        const n = await unfocusMode();
        hasWorkspace = false;
        statusMessage = n > 0 ? `Restored ${n} tab(s)` : "No saved workspace"; acted = true; break;
      }
      case "save":
        exportTabsToFile(); statusMessage = "Exporting tabs..."; acted = true; break;
      case "load":
        fileInputEl?.click(); acted = false; break;
      case "feedback":
        await chrome.tabs.create({ url: "https://github.com/nicepkg/TabOrdo/issues" }); statusMessage = "Opening feedback page"; acted = true; break;
      case "discard":
        if (tabIds.length > 0) { await discardTabs(tabIds); statusMessage = `Discarded ${tabIds.length} tab(s)`; acted = true; }
        break;
      case "reload":
        if (tabIds.length > 0) { await Promise.allSettled(tabIds.map((id) => chrome.tabs.reload(id))); statusMessage = `Reloaded ${tabIds.length} tab(s)`; acted = true; }
        break;
      case "vol": {
        const volMatch = searchQuery.match(/^(\d+)\s*(.*)/);
        if (volMatch) {
          const level = Math.max(0, Math.min(100, parseInt(volMatch[1])));
          const filter = volMatch[2].trim();
          if (filter) {
            const indices = search(searchHaystack, filter, searchMode);
            const targets = indices.map((i) => allTabs[i]).filter((t) => t.tabId);
            for (const t of targets) await setTabVolume(t.tabId!, level / 100);
            statusMessage = `Volume ${level}% on ${targets.length} tab(s)`;
          } else {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active?.id) { await setTabVolume(active.id, level / 100); statusMessage = `Volume ${level}% on active tab`; }
          }
          acted = true;
        } else {
          statusMessage = "Usage: /vol 50 [search]";
          acted = true;
        }
        break;
      }
    }
    if (acted) {
      query = "";
      canUndo = !!peekUndo();
      await loadTabs();
      setTimeout(() => { statusMessage = ""; }, 3000);
    }
    } catch (e) {
      statusMessage = `Error: ${e instanceof Error ? e.message : "Action failed"}`;
      setTimeout(() => { statusMessage = ""; }, 5000);
    } finally {
      await chrome.storage.session.set({ bulkOpInProgress: false }).catch(() => {});
      busy = false;
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
      searchHaystack = buildSearchHaystack(allTabs);
      dashboardTabs = dashboardTabs.filter((t) => t.id !== item.tabId);
      await loadTabs();
    }
  }

  function handleCommandSelect(cmd: CommandDefinition) {
    query = cmd.prefix.startsWith("@") ? `${cmd.prefix} ` : `/${cmd.prefix} `;
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
    if (busy) return;
    busy = true;
    try {
      const msg = await withBulkLock(fn);
      if (msg) statusMessage = msg;
      canUndo = !!peekUndo();
      await loadTabs();
      selectedTabs = new Set();
      setTimeout(() => { statusMessage = ""; }, 3000);
    } catch (e) {
      statusMessage = `Error: ${e instanceof Error ? e.message : "Action failed"}`;
      setTimeout(() => { statusMessage = ""; }, 5000);
    } finally {
      busy = false;
    }
  }

  async function handleFileLoad(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const n = await loadTabsFromText(text);
    statusMessage = n > 0 ? `Loaded ${n} tab(s) into new window` : "No valid URLs found";
    setTimeout(() => { statusMessage = ""; }, 3000);
    (e.target as HTMLInputElement).value = "";
  }

  onMount(async () => {
    await loadTabs();
    await loadUndoStack();
    canUndo = !!peekUndo();
    const config = await chrome.storage.local.get(["rulesConfig", "collapsedGroups"]);
    const rc = config.rulesConfig;
    if (rc) {
      autoGroupEnabled = rc.autoGroup ?? false;
      useRulesEnabled = rc.useRules ?? false;
      autoSortEnabled = rc.autoSort ?? false;
      autoPinFollowEnabled = rc.autoPinFollow ?? false;
      autoDiscardEnabled = rc.autoDiscard ?? false;
    }
    hasWorkspace = await hasSavedWorkspace();
    archiveCount = await getArchiveCount();
    if (config.collapsedGroups) collapsedGroups = new Set(config.collapsedGroups);
  });

  function onQueryChange() {
    updateResults();
  }
</script>

<div class="w-full h-full flex flex-col overflow-hidden">
  <!-- Search bar — always visible -->
  <div class="flex items-center gap-1.5 px-3 pt-3 pb-2">
    <div class="flex-1 min-w-0">
    <SearchInput
      bind:value={query}
      oninput={onQueryChange}
      placeholder="Search tabs... (/ commands, @ triage)"
      onfocuschange={(f) => { inputFocused = f; }}
      onkeydown={(e) => {
        if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          cycleSearchMode();
        } else if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          const hints = matchCommands(query);
          if ((query.startsWith("/") || query.startsWith("@")) && hints.length > 0) {
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
      {#each (["search", "action", "view"] as CommandCategory[]) as cat}
        <div class="flex items-center gap-2 mb-1 mt-2">
          <span class="text-[10px] font-semibold uppercase tracking-wider {CATEGORY_STYLES[cat].color}">{CATEGORY_STYLES[cat].label}</span>
          <div class="flex-1 h-px bg-border/50"></div>
        </div>
        {#each [...ALL_COMMANDS, ...TRIAGE_COMMANDS].filter(c => c.category === cat) as cmd}
          <button
            class="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover transition-colors text-left"
            onclick={() => { query = cmd.prefix.startsWith("@") ? `${cmd.prefix} ` : `/${cmd.prefix} `; showHelp = false; updateResults(); }}
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
      <ResultList {results} {selectedIndex} {loading} {currentWindowId} windowIds={windows.map(w => w.windowId)} onselect={handleSelect} onclose={handleClose} />
    {/if}
  {:else}
    <!-- Dashboard mode -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <!-- Action buttons -->
      <div class="grid grid-cols-4 gap-1.5 px-3 pb-2 {busy ? 'opacity-50 pointer-events-none' : ''}"
        aria-busy={busy}>
        <ActionButton label="Sort All" icon="↕️" tooltip="Sort tabs by domain. Groups left, ungrouped right." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await sortTabsInWindow(currentWindowId); return "Sorted"; })} />
        <ActionButton label="Group+" icon="📁" tooltip="Group ungrouped tabs by domain. Keeps existing groups." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await groupTabsByDomain("additive"); return "Grouped"; })} />
        <ActionButton label={pendingConfirm === "regroup" ? "Sure?" : "Regroup"} icon="🔀" tooltip="Ungroup everything, then regroup all from scratch." onclick={() => confirmAction("regroup", () => dashAction(async () => { await snapshotBeforeGroup(); await groupTabsByDomain("rebuild"); return "Regrouped"; }))} />
        <ActionButton label="Dedup" icon="🔄" tooltip="Close duplicate tabs. Keeps most recently accessed." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); const n = await removeDuplicates(); return n > 0 ? `${n} removed` : "No dupes"; })} />
        <ActionButton label={pendingConfirm === "ungroup" ? "Sure?" : "Ungroup"} icon="📤" tooltip="Remove all tab groups. Tabs stay in place." onclick={() => confirmAction("ungroup", () => dashAction(async () => { await snapshotBeforeGroup(); await ungroupAll(); return "Ungrouped all"; }))} />
        <ActionButton label={pendingConfirm === "merge" ? "Sure?" : "Merge"} icon="🔗" tooltip="Move all tabs from other windows here." onclick={() => confirmAction("merge", () => dashAction(async () => { await snapshotBeforeGroup(); await mergeAllWindows(); return "Merged"; }))} />
        <ActionButton label={pendingConfirm === "closeSel" ? "Sure?" : "Close Sel."} icon="✕" variant="danger" disabled={selectedTabs.size === 0}
          tooltip="Close all selected tabs." onclick={() => confirmAction("closeSel", () => dashAction(async () => { await snapshotBeforeClose([...selectedTabs]); await closeTabs([...selectedTabs]); return `Closed ${selectedTabs.size}`; }))} />
        <ActionButton label="Archive Sel." icon="📦" disabled={selectedTabs.size === 0}
          tooltip="Archive selected tabs (save & close). View in Archive page." onclick={() => dashAction(async () => {
            const tabs = dashboardTabs.filter((t) => selectedTabs.has(t.id));
            const tabData = tabs.map((t) => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl, groupName: t.groupTitle }));
            const archived = await archiveTabs(tabData);
            await closeTabs([...selectedTabs]);
            return `Archived ${archived}`;
          })} />
        <ActionButton label="Close Left" icon="⬅️"
          tooltip="Close all tabs to the left of active tab in current window." onclick={() => dashAction(async () => { const n = await closeTabsToLeft(); return n > 0 ? `Closed ${n} left` : "None to close"; })} />
        <ActionButton label="Close Right" icon="➡️"
          tooltip="Close all tabs to the right of active tab in current window." onclick={() => dashAction(async () => { const n = await closeTabsToRight(); return n > 0 ? `Closed ${n} right` : "None to close"; })} />
        <ActionButton label="Discard Sel." icon="💤" disabled={selectedTabs.size === 0}
          tooltip="Suspend selected tabs to free memory." onclick={() => dashAction(async () => { await discardTabs([...selectedTabs]); return `Discarded ${selectedTabs.size}`; })} />
        <ActionButton label="Shuffle" icon="🎲"
          tooltip="Randomly reorder tabs in current window." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await shuffleTabs(); return "Shuffled"; })} />
        <ActionButton label="Unite" icon="🧲"
          tooltip="Bring same-domain tabs from other windows here." onclick={() => dashAction(async () => { const n = await uniteDomain(); return n > 0 ? `United ${n}` : "None to unite"; })} />
        <ActionButton label="Isolate" icon="🔬"
          tooltip="Move same-domain tabs to new window." onclick={() => dashAction(async () => { const n = await isolateDomain(); return n > 0 ? `Isolated ${n}` : "Not enough tabs"; })} />
        <ActionButton label="Split V" icon="⬜"
          tooltip="Split window in half vertically, side by side." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await splitWindow("vertical"); return "Split V"; })} />
        <ActionButton label="Split Dom." icon="🌐"
          tooltip="Each domain gets its own window." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); const n = await splitByDomain(); return n > 0 ? `${n + 1} windows` : "One domain"; })} />
        <ActionButton label="Stack" icon="📚"
          tooltip="Stack all windows to left side of screen." onclick={() => dashAction(async () => { await stackWindows(); return "Stacked"; })} />
        <ActionButton label={hasWorkspace ? "Unfocus" : "Focus"} icon={hasWorkspace ? "🔓" : "🎯"}
          tooltip={hasWorkspace ? "Restore saved workspace." : "Save tabs & start fresh."}
          onclick={() => dashAction(async () => {
            if (hasWorkspace) { const n = await unfocusMode(); hasWorkspace = false; return n > 0 ? `Restored ${n}` : "No workspace"; }
            else { const n = await focusMode(); hasWorkspace = true; return `Saved ${n}, focused`; }
          })} />
        <ActionButton label="Save" icon="💾"
          tooltip="Export current tabs to text file." onclick={() => { exportTabsToFile(); statusMessage = "Exporting..."; setTimeout(() => { statusMessage = ""; }, 2000); }} />
        <ActionButton label="Load" icon="📂"
          tooltip="Load tabs from text file into new window." onclick={() => fileInputEl?.click()} />
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
          title="When ON, new tabs are automatically grouped by domain as they load. Rules take priority if also enabled."
        >
          <span class="w-2 h-2 rounded-full {autoGroupEnabled ? 'bg-primary' : 'bg-border'}"></span>
          Auto
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-colors
            {autoSortEnabled ? 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30' : 'bg-surface-hover text-text-muted border border-border'}"
          onclick={async () => { autoSortEnabled = !autoSortEnabled; await setAutoSort(autoSortEnabled); }}
          title="Auto-sort tabs by domain when a tab finishes loading."
        >
          <span class="w-2 h-2 rounded-full {autoSortEnabled ? 'bg-accent-orange' : 'bg-border'}"></span>
          Sort
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-colors
            {autoPinFollowEnabled ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30' : 'bg-surface-hover text-text-muted border border-border'}"
          onclick={async () => { autoPinFollowEnabled = !autoPinFollowEnabled; await setAutoPinFollow(autoPinFollowEnabled); }}
          title="Sync pinned tabs across all windows."
        >
          <span class="w-2 h-2 rounded-full {autoPinFollowEnabled ? 'bg-accent-cyan' : 'bg-border'}"></span>
          Pin
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-colors
            {autoDiscardEnabled ? 'bg-accent-pink/15 text-accent-pink border border-accent-pink/30' : 'bg-surface-hover text-text-muted border border-border'}"
          onclick={async () => { autoDiscardEnabled = !autoDiscardEnabled; await setAutoDiscard(autoDiscardEnabled); }}
          title="Auto-discard tabs inactive for 45+ minutes."
        >
          <span class="w-2 h-2 rounded-full {autoDiscardEnabled ? 'bg-accent-pink' : 'bg-border'}"></span>
          Discard
        </button>
      </div>

      <!-- Hidden file input for Load -->
      <input type="file" accept=".txt,.json,.csv" class="hidden" bind:this={fileInputEl} onchange={handleFileLoad} />

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
                onclick={(e) => { e.stopPropagation(); dashAction(async () => { const n = await extractGroupToWindow(groupId); return `Extracted ${n} tab(s)`; }); }}
                role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); dashAction(async () => { const n = await extractGroupToWindow(groupId); return `Extracted ${n} tab(s)`; }); } }}>Extract</span>
              <span class="text-[10px] text-text-muted hover:text-text transition-colors shrink-0 cursor-pointer"
                onclick={(e) => { e.stopPropagation(); dashAction(async () => { await sortTabsInGroup(groupId); return `Sorted "${group.title}"`; }); }}
                role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); dashAction(async () => { await sortTabsInGroup(groupId); return `Sorted "${group.title}"`; }); } }}>Sort</span>
            </div>
            {#if !collapsed}
              <div class="p-1 grid gap-0.5">
                {#each group.tabs as tab}
                  <TabCard {tab} selected={selectedTabs.has(tab.id)}
                    ontoggle={() => toggleSelect(tab.id)}
                    onclose={() => dashAction(async () => { await closeTabs([tab.id]); })}
                    onmute={() => loadTabs()} />
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
                    onclose={() => dashAction(async () => { await closeTabs([tab.id]); })}
                    onmute={() => loadTabs()} />
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        {/if}
      {/each}
    </div>
  {/if}

  <div class="shrink-0 flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-text-muted">
    <span class="flex items-center gap-2">
      {allTabs.length} tab{allTabs.length !== 1 ? "s" : ""}
      {#if archiveCount > 0}
        <button
          class="text-accent-yellow hover:text-accent-yellow/80 transition-colors"
          onclick={() => { chrome.tabs.create({ url: chrome.runtime.getURL("/archive.html") }); }}
          title="Open archive ({archiveCount} saved)"
        >📦 {archiveCount}</button>
      {/if}
    </span>
    <span class="text-accent-green" aria-live="polite">{statusMessage}</span>
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
