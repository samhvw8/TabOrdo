<script lang="ts">
  import { onMount } from "svelte";
  import { getAllTabs, getCurrentWindowTabs, switchToTab, closeTabs, sortTabsInWindow, sortTabsInGroup, groupTabsByDomain, ungroupAll, removeDuplicates, mergeAllWindows, muteTab, setTabVolume, splitTabToWindow, extractGroupToWindow, discardTabs, closeTabsToLeft, closeTabsToRight, closeTabsSameSite, closeOldTabs, shuffleTabs, uniteDomain, isolateDomain, splitWindow, splitByDomain, stackWindows, collapseAllGroups, moveCurrentTab, moveGroup, pinCurrentTab, unpinCurrentTab, pinCurrentGroup, unpinCurrentGroup, type TabInfo } from "../../lib/tabs.ts";
  import { getPinnedTabs, getPinForTab, type PinnedTabEntry } from "../../lib/pin.ts";
  import { archiveTabs, getArchiveCount } from "../../lib/archive.ts";
  import { search, tabsToSearchItems, searchBookmarks, searchHistory, parseCommand, buildSearchHaystack, SEARCH_MODES, type SearchResult, type SearchMode } from "../../lib/search.ts";
  import { getAutoGroup, setAutoGroup, getAutoUngroup, setAutoUngroup, getUseRules, setUseRules, getAutoSort, setAutoSort, getAutoPinFollow, setAutoPinFollow, getAutoDiscard, setAutoDiscard } from "../../lib/rules.ts";
  import { matchCommands, ALL_COMMANDS, ACTION_COMMANDS, TRIAGE_COMMANDS, CATEGORY_STYLES, type CommandDefinition, type CommandCategory } from "../../lib/commands.ts";
  import { snapshotBeforeClose, snapshotBeforeGroup, executeUndo, peekUndo, loadUndoStack } from "../../lib/undo.ts";
  import { focusMode, unfocusMode, hasSavedWorkspace, exportTabsToFile, loadTabsFromText } from "../../lib/workspace.ts";
  import SearchInput from "../../components/SearchInput.svelte";
  import ResultList from "../../components/ResultList.svelte";
  import CommandHints from "../../components/CommandHints.svelte";
  import ActionButton from "../../components/ActionButton.svelte";
  import TabCard from "../../components/TabCard.svelte";
  import RulesEditor from "../../components/RulesEditor.svelte";
  import Sidebar, { type SidebarSection } from "../../components/Sidebar.svelte";
  import SettingsPanel from "../../components/SettingsPanel.svelte";
  import PinsPanel from "../../components/PinsPanel.svelte";
  import OverflowMenu from "../../components/OverflowMenu.svelte";

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
  let activeSection = $state<SidebarSection>("dashboard");
  let showActions = $state(false);

  function cycleSearchMode() {
    searchModeIndex = (searchModeIndex + 1) % SEARCH_MODES.length;
    if (query) updateResults();
  }

  let autoGroupEnabled = $state(false);
  let autoUngroupEnabled = $state(false);
  let useRulesEnabled = $state(false);
  let autoSortEnabled = $state(false);
  let autoPinFollowEnabled = $state(false);
  let autoDiscardEnabled = $state(false);
  let hasWorkspace = $state(false);
  let inputFocused = $state(true);
  let canUndo = $state(false);
  let archiveCount = $state(0);
  let pinnedTabs = $state<PinnedTabEntry[]>([]);
  let fileInputEl = $state<HTMLInputElement | undefined>(undefined);
  let busy = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingConfirm = $state<string | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let onboardingDismissed = $state(true);
  let helpFilter = $state("");

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
    if (busy) return;
    busy = true;
    try {
      const msg = await withBulkLock(() => executeUndo());
      statusMessage = msg;
      canUndo = !!peekUndo();
      await loadTabs();
      setTimeout(() => { statusMessage = ""; }, 3000);
    } finally {
      busy = false;
    }
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
    pinnedTabs = await getPinnedTabs();

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
          selectedIndex = 0;
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
            const categories: { id: string; title: string; tabs: SearchResult[] }[] = [
              { id: "div-triage-audio", title: "Playing Audio", tabs: audioTabs },
              { id: "div-triage-muted", title: "Muted", tabs: mutedTabs },
              { id: "div-triage-dupes", title: "Duplicates", tabs: dupTabs },
              { id: "div-triage-recent", title: "Recently Active", tabs: recentTabs },
              { id: "div-triage-suspended", title: "Suspended", tabs: suspendedTabs },
            ];
            for (const cat of categories) {
              if (cat.tabs.length === 0) continue;
              const hay = buildSearchHaystack(cat.tabs);
              const indices = search(hay, searchQuery, searchMode);
              const matched = indices.map((i) => cat.tabs[i]);
              if (matched.length > 0) {
                triageResults.push({ type: "divider", id: cat.id, title: `${cat.title} (${matched.length})`, url: "" });
                triageResults.push(...matched);
              }
            }
            results = triageResults;
            if (triageResults.length === 0) statusMessage = "No triage matches";
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
        case "@u": {
          const ungrouped = allTabs.filter((t) => !t.groupId || t.groupId === -1);
          if (searchQuery) { const hay = buildSearchHaystack(ungrouped); const indices = search(hay, searchQuery, searchMode); results = indices.map((i) => ungrouped[i]); }
          else results = ungrouped;
          if (ungrouped.length === 0) statusMessage = "All tabs are grouped";
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

  let groupCount = $derived(windows.reduce((n, w) => n + w.groups.size, 0));
  let audioCount = $derived(dashboardTabs.filter((t) => t.audible && !t.mutedInfo?.muted).length);
  let dupeCount = $derived(findDuplicateTabs(allTabs).length);

  async function handleOverflowAction(action: string) {
    switch (action) {
      case "regroup": confirmAction("regroup", () => dashAction(async () => { await snapshotBeforeGroup(); await groupTabsByDomain("rebuild"); return "Regrouped"; })); break;
      case "ungroup": confirmAction("ungroup", () => dashAction(async () => { await snapshotBeforeGroup(); await ungroupAll(); return "Ungrouped all"; })); break;
      case "shuffle": dashAction(async () => { await snapshotBeforeGroup(); await shuffleTabs(); return "Shuffled"; }); break;
      case "unite": dashAction(async () => { const n = await uniteDomain(); return n > 0 ? `United ${n}` : "None to unite"; }); break;
      case "isolate": dashAction(async () => { const n = await isolateDomain(); return n > 0 ? `Isolated ${n}` : "Not enough tabs"; }); break;
      case "splitv": dashAction(async () => { await snapshotBeforeGroup(); await splitWindow("vertical"); return "Split V"; }); break;
      case "splith": dashAction(async () => { await snapshotBeforeGroup(); await splitWindow("horizontal"); return "Split H"; }); break;
      case "splitdomain": dashAction(async () => { await snapshotBeforeGroup(); const n = await splitByDomain(); return n > 0 ? `${n + 1} windows` : "One domain"; }); break;
      case "stack": dashAction(async () => { await stackWindows(); return "Stacked"; }); break;
      case "closeleft": dashAction(async () => { const n = await closeTabsToLeft(); return n > 0 ? `Closed ${n} left` : "None to close"; }); break;
      case "closeright": dashAction(async () => { const n = await closeTabsToRight(); return n > 0 ? `Closed ${n} right` : "None to close"; }); break;
      case "closeold": dashAction(async () => { const n = await closeOldTabs(); return n > 0 ? `Closed ${n} old` : "No old tabs"; }); break;
      case "closesite": dashAction(async () => { const n = await closeTabsSameSite(); return n > 0 ? `Closed ${n} same-site` : "No other tabs"; }); break;
      case "focus":
        dashAction(async () => {
          if (hasWorkspace) { const n = await unfocusMode(); hasWorkspace = false; return n > 0 ? `Restored ${n}` : "No workspace"; }
          else { const n = await focusMode(); hasWorkspace = true; return `Saved ${n}, focused`; }
        }); break;
      case "save": exportTabsToFile(); statusMessage = "Exporting..."; setTimeout(() => { statusMessage = ""; }, 2000); break;
      case "load": fileInputEl?.click(); break;
      case "archive": chrome.tabs.create({ url: chrome.runtime.getURL("/archive.html") }); break;
      case "feedback": chrome.tabs.create({ url: "https://github.com/nicepkg/TabOrdo/issues" }); break;
    }
  }

  async function handleActionCommand(prefix: string, searchQuery: string) {
    if (!ACTION_PREFIXES.has(prefix)) return;
    if (busy) return;
    busy = true;

    try {
    await withBulkLock(async () => {
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
      case "ungroup":
        if (tabIds.length > 0) {
          await snapshotBeforeGroup();
          await chrome.tabs.ungroup(tabIds);
          statusMessage = `Ungrouped ${tabIds.length} tab(s)`; await loadTabs(); acted = true;
        } else if (!searchQuery) {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab?.id && activeTab.groupId !== -1) {
            await snapshotBeforeGroup(); await chrome.tabs.ungroup(activeTab.id); statusMessage = "Ungrouped current tab"; await loadTabs(); acted = true;
          }
        }
        break;
      case "merge":
        await snapshotBeforeGroup(); await mergeAllWindows(); statusMessage = "Merged all windows"; await loadTabs(); acted = true; break;
      case "sort": {
        const sortBy = (["title", "url", "domain"] as const).includes(searchQuery as any) ? searchQuery as "title" | "url" | "domain" : "domain";
        await snapshotBeforeGroup(); await sortTabsInWindow(currentWindowId, sortBy); statusMessage = `Sorted tabs by ${sortBy}`; await loadTabs(); acted = true; break;
      }
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
      case "collapse": {
        const n = await collapseAllGroups();
        statusMessage = n > 0 ? `Collapsed ${n} group(s)` : "No groups to collapse";
        acted = true;
        break;
      }
      case "move": {
        const msg = await moveCurrentTab(searchQuery);
        statusMessage = msg;
        acted = true;
        break;
      }
      case "movegroup": {
        const msg = await moveGroup(searchQuery);
        statusMessage = msg;
        acted = true;
        break;
      }
      case "pin": {
        const msg = await pinCurrentTab(searchQuery);
        statusMessage = msg;
        acted = true;
        break;
      }
      case "unpin": {
        const msg = await unpinCurrentTab();
        statusMessage = msg;
        acted = true;
        break;
      }
      case "pingroup": {
        const msg = await pinCurrentGroup(searchQuery);
        statusMessage = msg;
        acted = true;
        break;
      }
      case "unpingroup": {
        const msg = await unpinCurrentGroup();
        statusMessage = msg;
        acted = true;
        break;
      }
    }
    if (acted) {
      query = "";
      canUndo = !!peekUndo();
      await loadTabs();
      setTimeout(() => { statusMessage = ""; }, 3000);
    }
    });
    } catch (e) {
      statusMessage = `Error: ${e instanceof Error ? e.message : "Action failed"}`;
      setTimeout(() => { statusMessage = ""; }, 5000);
    } finally {
      busy = false;
    }
  }

  async function handleSelect(item: SearchResult) {
    if (item.tabId) { await switchToTab(item.tabId); window.close(); }
    else if (item.url) { await chrome.tabs.create({ url: item.url }); window.close(); }
  }

  async function handleClose(item: SearchResult) {
    if (busy || !item.tabId) return;
    await snapshotBeforeClose([item.tabId]);
    await closeTabs([item.tabId]);
    canUndo = true;
    results = results.filter((r) => r.id !== item.id);
    allTabs = allTabs.filter((t) => t.id !== item.id);
    searchHaystack = buildSearchHaystack(allTabs);
    dashboardTabs = dashboardTabs.filter((t) => t.id !== item.tabId);
    await loadTabs();
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

  async function handlePinCurrent(e: MouseEvent) {
    const toStart = e.altKey || e.ctrlKey;
    await dashAction(() => pinCurrentTab(toStart ? "^" : ""));
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
    await chrome.storage.session.set({ bulkOpInProgress: false }).catch(() => {});
    await loadTabs();
    await loadUndoStack();
    canUndo = !!peekUndo();
    const config = await chrome.storage.local.get(["rulesConfig", "collapsedGroups"]);
    const rc = config.rulesConfig;
    if (rc) {
      autoGroupEnabled = rc.autoGroup ?? false;
      autoUngroupEnabled = rc.autoUngroup ?? false;
      useRulesEnabled = rc.useRules ?? false;
      autoSortEnabled = rc.autoSort ?? false;
      autoPinFollowEnabled = rc.autoPinFollow ?? false;
      autoDiscardEnabled = rc.autoDiscard ?? false;
    }
    hasWorkspace = await hasSavedWorkspace();
    archiveCount = await getArchiveCount();
    if (config.collapsedGroups) collapsedGroups = new Set(config.collapsedGroups);
    const ob = await chrome.storage.local.get("onboardingDismissed");
    onboardingDismissed = !!ob.onboardingDismissed;
  });

  $effect(() => {
    if (activeSection === "archive") {
      chrome.tabs.create({ url: chrome.runtime.getURL("/archive.html") });
      activeSection = "dashboard";
    }
  });

  function onQueryChange() {
    updateResults();
  }
</script>

<div class="w-[450px] h-[600px] flex flex-col overflow-hidden">
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
      class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold transition-colors
        {showHelp ? 'bg-primary text-white' : 'bg-surface-hover text-text-muted hover:text-text'}"
      onclick={() => { showHelp = !showHelp; activeSection = "dashboard"; }}
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

  <div class="flex flex-1 min-h-0 overflow-hidden">
    <Sidebar bind:active={activeSection} {archiveCount} />
  {#if activeSection === "rules"}
    <RulesEditor onclose={() => { activeSection = "dashboard"; }} />
  {:else if activeSection === "pins"}
    <PinsPanel />
  {:else if activeSection === "settings"}
    <SettingsPanel />
  {:else if activeSection === "more"}
    <div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
      <div class="flex items-center gap-2 mb-2">
        <div class="text-xs font-semibold text-text">More Actions</div>
        <div class="flex-1"></div>
      </div>
      {#each [
        { title: "Organize", items: [
          { action: "regroup", label: "Regroup All", tip: "Ungroup everything, then regroup from scratch" },
          { action: "ungroup", label: "Ungroup All", tip: "Remove all tab groups" },
          { action: "shuffle", label: "Shuffle", tip: "Randomly reorder tabs" },
        ]},
        { title: "Windows", items: [
          { action: "unite", label: "Unite Domain", tip: "Bring same-domain tabs from other windows" },
          { action: "isolate", label: "Isolate Domain", tip: "Move same-domain tabs to new window" },
          { action: "splitv", label: "Split Vertical", tip: "Split window in half, side by side" },
          { action: "splith", label: "Split Horizontal", tip: "Split window top/bottom" },
          { action: "splitdomain", label: "Split by Domain", tip: "Each domain gets its own window" },
          { action: "stack", label: "Stack Windows", tip: "Stack all windows to left side" },
        ]},
        { title: "Close", items: [
          { action: "closeleft", label: "Close Left", tip: "Close tabs to the left of active tab" },
          { action: "closeright", label: "Close Right", tip: "Close tabs to the right of active tab" },
          { action: "closeold", label: "Close Old (7d)", tip: "Close tabs older than 7 days" },
          { action: "closesite", label: "Close Same Site", tip: "Close other tabs from this site" },
        ]},
        { title: "Workspace", items: [
          { action: "focus", label: hasWorkspace ? "Unfocus (Restore)" : "Focus (Save & Clear)", tip: hasWorkspace ? "Restore saved workspace" : "Save tabs & start fresh" },
          { action: "save", label: "Save to File", tip: "Export current tabs to text file" },
          { action: "load", label: "Load from File", tip: "Load tabs from text file" },
          { action: "archive", label: `Open Archive (${archiveCount})`, tip: "View archived tabs" },
        ]},
      ] as section, si}
        {#if si > 0}
          <div class="my-1.5 h-px bg-border/30"></div>
        {/if}
        <div class="text-[9px] font-semibold uppercase tracking-wider text-text-muted mb-1">{section.title}</div>
        {#each section.items as item}
          <button
            class="w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-surface-hover text-xs text-text transition-colors"
            onclick={() => { handleOverflowAction(item.action); activeSection = "dashboard"; }}
            title={item.tip}
          >
            {item.label}
            <span class="ml-auto text-[10px] text-text-muted">{item.tip}</span>
          </button>
        {/each}
      {/each}
    </div>
  {:else if showHelp}
    {@const allCmds = [...ALL_COMMANDS, ...TRIAGE_COMMANDS]}
    {@const filteredCmds = helpFilter ? allCmds.filter(c => c.prefix.includes(helpFilter.toLowerCase()) || c.description.toLowerCase().includes(helpFilter.toLowerCase())) : allCmds}
    <div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
      <div class="flex items-center gap-2 mb-2">
        <div class="text-xs font-semibold text-text">Commands</div>
        <div class="flex-1"></div>
        <input type="text" class="w-28 px-1.5 py-0.5 rounded border border-border bg-surface-hover text-[10px] text-text placeholder:text-text-muted focus:outline-none focus:border-primary" placeholder="Filter..." bind:value={helpFilter} />
      </div>
      <div class="grid grid-cols-[auto_auto_1fr] gap-x-2 gap-y-0.5 mb-2 px-1 py-1.5 rounded-md bg-surface-hover border border-border">
        <kbd class="px-1 py-0.5 rounded bg-surface text-[9px] text-center">⌘E</kbd><span class="text-[10px] text-text-muted">Open TabOrdo</span><span></span>
        <kbd class="px-1 py-0.5 rounded bg-surface text-[9px] text-center">↑↓</kbd><span class="text-[10px] text-text-muted">Navigate</span><span></span>
        <kbd class="px-1 py-0.5 rounded bg-surface text-[9px] text-center">↵</kbd><span class="text-[10px] text-text-muted">Open / run</span><span></span>
        <kbd class="px-1 py-0.5 rounded bg-surface text-[9px] text-center">⇧Tab</kbd><span class="text-[10px] text-text-muted">Search mode</span><span></span>
        <kbd class="px-1 py-0.5 rounded bg-surface text-[9px] text-center">^Del</kbd><span class="text-[10px] text-text-muted">Close tab</span><span></span>
        <kbd class="px-1 py-0.5 rounded bg-surface text-[9px] text-center">⌘Z</kbd><span class="text-[10px] text-text-muted">Undo</span><span></span>
      </div>
      {#each (["search", "action", "view"] as CommandCategory[]) as cat}
        {@const catCmds = filteredCmds.filter(c => c.category === cat)}
        {#if catCmds.length > 0}
        <div class="flex items-center gap-2 mb-1 mt-2">
          <span class="text-[10px] font-semibold uppercase tracking-wider {CATEGORY_STYLES[cat].color}">{CATEGORY_STYLES[cat].label}</span>
          <div class="flex-1 h-px bg-border/50"></div>
        </div>
        {#each catCmds as cmd}
          <button
            class="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover transition-colors text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
            onclick={() => { query = cmd.prefix.startsWith("@") ? `${cmd.prefix} ` : `/${cmd.prefix} `; showHelp = false; helpFilter = ""; updateResults(); }}
          >
            <span class="font-mono text-xs font-medium w-16 shrink-0 {cmd.color}">{cmd.label}</span>
            <span class="text-xs text-text-muted">{cmd.description}</span>
          </button>
        {/each}
        {/if}
      {/each}
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
      <!-- Stats overview -->
      <div class="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] text-text-muted">
        <span>{allTabs.length} tabs</span>
        <span class="text-border">·</span>
        <span>{groupCount} groups</span>
        {#if audioCount > 0}
          <span class="text-border">·</span>
          <span>{audioCount} 🔊</span>
        {/if}
        {#if dupeCount > 0}
          <span class="text-border">·</span>
          <span>{dupeCount} dupes</span>
        {/if}
      </div>

      <!-- Onboarding hint -->
      {#if !onboardingDismissed && allTabs.length <= 5}
        <div class="mx-3 mb-2 flex items-center gap-2 px-2.5 py-2 rounded-lg border border-primary/20 bg-primary/5 text-[11px] text-text-muted">
          <span class="text-primary">💡</span>
          <span>Type <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px] font-mono">/</kbd> for commands, <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px] font-mono">@</kbd> for triage. Try <span class="text-primary font-medium">/sort</span> to organize tabs.</span>
          <button class="ml-auto shrink-0 text-text-muted hover:text-text transition-colors" onclick={() => { onboardingDismissed = true; chrome.storage.local.set({ onboardingDismissed: true }); }}>✕</button>
        </div>
      {/if}

      <!-- Primary action buttons -->
      <div class="grid grid-cols-3 gap-1.5 px-3 pb-2 {busy ? 'opacity-50 pointer-events-none' : ''}"
        aria-busy={busy}>
        <ActionButton label="Sort All" icon="↕️" tooltip="Sort tabs by domain." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await sortTabsInWindow(currentWindowId); return "Sorted"; })} />
        <ActionButton label="Group+" icon="📁" tooltip="Group ungrouped tabs by domain." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); await groupTabsByDomain("additive"); return "Grouped"; })} />
        <ActionButton label="Dedup" icon="🔄" tooltip="Close duplicate tabs." onclick={() => dashAction(async () => { await snapshotBeforeGroup(); const n = await removeDuplicates(); return n > 0 ? `${n} removed` : "No dupes"; })} />
        <ActionButton label={pendingConfirm === "merge" ? "Confirm" : "Merge"} icon="🔗" tooltip="Move all tabs from other windows here." onclick={() => confirmAction("merge", () => dashAction(async () => { await snapshotBeforeGroup(); await mergeAllWindows(); return "Merged"; }))} />
        <ActionButton label="Pin Tab" icon="📌" tooltip="Pin current tab at position." onclick={(e: MouseEvent) => handlePinCurrent(e)} />
      </div>

      <!-- Selection actions -->
      {#if selectedTabs.size > 0}
        <div class="flex items-center gap-1.5 px-3 pb-2">
          <span class="text-[10px] text-text-muted">{selectedTabs.size} sel:</span>
          <button class="px-2 py-0.5 rounded text-[10px] font-medium bg-accent-red/10 text-accent-red border border-accent-red/20 hover:bg-accent-red/20 transition-colors"
            onclick={() => confirmAction("closeSel", () => dashAction(async () => { await snapshotBeforeClose([...selectedTabs]); await closeTabs([...selectedTabs]); return `Closed ${selectedTabs.size}`; }))}>
            {pendingConfirm === "closeSel" ? "Confirm" : "Close"}
          </button>
          <button class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-hover text-text-muted border border-border hover:text-text transition-colors"
            onclick={() => dashAction(async () => {
              const tabs = dashboardTabs.filter((t) => selectedTabs.has(t.id));
              const tabData = tabs.map((t) => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl, groupName: t.groupTitle }));
              const archived = await archiveTabs(tabData);
              await closeTabs([...selectedTabs]);
              return `Archived ${archived}`;
            })}>Archive</button>
          <button class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-hover text-text-muted border border-border hover:text-text transition-colors"
            onclick={() => dashAction(async () => { await discardTabs([...selectedTabs]); return `Discarded ${selectedTabs.size}`; })}>Discard</button>
        </div>
      {/if}

      <!-- Toggles -->
      <div class="flex items-center gap-1 px-3 pb-2 text-[10px]">
        {#each [{label: "Rules", enabled: useRulesEnabled, toggle: async () => { useRulesEnabled = !useRulesEnabled; await setUseRules(useRulesEnabled); }, tip: "Custom rules for grouping"},
                {label: "Auto", enabled: autoGroupEnabled, toggle: async () => { autoGroupEnabled = !autoGroupEnabled; await setAutoGroup(autoGroupEnabled); }, tip: "Auto-group new tabs"},
                {label: "Ungroup", enabled: autoUngroupEnabled, toggle: async () => { autoUngroupEnabled = !autoUngroupEnabled; await setAutoUngroup(autoUngroupEnabled); }, tip: "Auto-ungroup singles"}] as t}
          <button
            class="px-1.5 py-0.5 rounded transition-colors border
              {t.enabled ? 'bg-primary/15 text-primary border-primary/30 font-medium' : 'bg-surface-hover text-text-muted border-transparent hover:border-border'}"
            onclick={t.toggle} title={t.tip} aria-pressed={t.enabled}
          >{t.enabled ? "✓ " : ""}{t.label}</button>
        {/each}
        <div class="w-px h-3 bg-border/40 mx-0.5"></div>
        {#each [{label: "Sort", enabled: autoSortEnabled, toggle: async () => { autoSortEnabled = !autoSortEnabled; await setAutoSort(autoSortEnabled); }, tip: "Auto-sort on load"},
                {label: "Pin", enabled: autoPinFollowEnabled, toggle: async () => { autoPinFollowEnabled = !autoPinFollowEnabled; await setAutoPinFollow(autoPinFollowEnabled); }, tip: "Sync pins across windows"},
                {label: "Discard", enabled: autoDiscardEnabled, toggle: async () => { autoDiscardEnabled = !autoDiscardEnabled; await setAutoDiscard(autoDiscardEnabled); }, tip: "Auto-discard 45min+"}] as t}
          <button
            class="px-1.5 py-0.5 rounded transition-colors border
              {t.enabled ? 'bg-primary/15 text-primary border-primary/30 font-medium' : 'bg-surface-hover text-text-muted border-transparent hover:border-border'}"
            onclick={t.toggle} title={t.tip} aria-pressed={t.enabled}
          >{t.enabled ? "✓ " : ""}{t.label}</button>
        {/each}
      </div>

      <!-- Hidden file input for Load -->
      <input type="file" accept=".txt,.json,.csv" class="hidden" bind:this={fileInputEl} onchange={handleFileLoad} />

      <!-- Divider between controls and tab list -->
      <div class="mx-3 mb-2 border-t border-border/50"></div>

      <!-- Selection + collapse controls -->
      <div class="flex items-center gap-3 px-3 pb-1.5 text-xs">
        <button onmousedown={(e) => { e.preventDefault(); selectedTabs = new Set(dashboardTabs.map((t) => t.id)); }} class="text-primary hover:text-primary-hover transition-colors">All</button>
        <button onmousedown={(e) => { e.preventDefault(); selectedTabs = new Set(); }} class="text-text-muted hover:text-text transition-colors">None</button>
        {#if selectedTabs.size > 0}
          <span class="text-text-muted">{selectedTabs.size} selected</span>
        {/if}
        <div class="flex-1"></div>
        <button
          onmousedown={(e) => { e.preventDefault(); const all = new Set<number>(); windows.forEach(w => { w.groups.forEach((_, k) => all.add(k)); all.add(-(w.windowId + 100000)); }); setCollapsed(all); }}
          class="text-text-muted hover:text-text transition-colors">Fold</button>
        <button
          onmousedown={(e) => { e.preventDefault(); setCollapsed(new Set()); }}
          class="text-text-muted hover:text-text transition-colors">Unfold</button>
      </div>

      {#if dashboardTabs.some((t) => t.audible && !t.mutedInfo?.muted)}
        {@const audioTabs = dashboardTabs.filter((t) => t.audible && !t.mutedInfo?.muted)}
        <button
          class="mx-3 mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-accent-red/30 bg-accent-red/5 hover:bg-accent-red/10 transition-colors w-[calc(100%-1.5rem)] text-left"
          onclick={() => { query = "@a "; paletteMode = "search"; updateResults(); }}
          title="Click to view all tabs playing audio"
        >
          <span class="text-accent-red text-xs">🔊</span>
          <span class="text-xs font-medium text-accent-red">{audioTabs.length} playing audio</span>
          <span class="text-[10px] text-text-muted truncate ml-1">{audioTabs.map((t) => t.title || t.url).join(", ")}</span>
        </button>
      {/if}

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
          <button class="flex items-center gap-2 flex-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded" aria-expanded={!winCollapsed} onclick={() => toggleGroupCollapse(winCollapseKey)}>
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
              <button class="flex items-center gap-2 flex-1 min-w-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded" aria-expanded={!collapsed} onclick={() => toggleGroupCollapse(groupId)}>
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
                    positionPinned={!!getPinForTab(tab.url, group.title, pinnedTabs)}
                    ontoggle={() => toggleSelect(tab.id)}
                    onclose={() => dashAction(async () => { await snapshotBeforeClose([tab.id]); await closeTabs([tab.id]); })}
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
              <button class="flex items-center gap-2 flex-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded" aria-expanded={!ungroupedCollapsed} onclick={() => toggleGroupCollapse(ungroupedKey)}>
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
                    onclose={() => dashAction(async () => { await snapshotBeforeClose([tab.id]); await closeTabs([tab.id]); })}
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
  </div>

  <div class="shrink-0 grow-0 basis-auto flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-text-muted">
    <span>{allTabs.length} tab{allTabs.length !== 1 ? "s" : ""}</span>
    <span class="{statusMessage.startsWith('Error:') ? 'text-accent-red' : 'text-accent-green'}" aria-live="polite">{statusMessage}</span>
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
