<script lang="ts">
  import { onMount } from "svelte";
  import { getAllTabs, getCurrentWindowTabs, switchToTab, closeTabs, sortTabsInWindow, sortTabsInGroup, groupTabsByDomain, ungroupAll, removeDuplicates, mergeAllWindows, muteTab, setTabVolume, splitTabToWindow, extractGroupToWindow, discardTabs, closeTabsToLeft, closeTabsToRight, closeTabsSameSite, closeOldTabs, shuffleTabs, uniteDomain, isolateDomain, splitWindow, splitByDomain, stackWindows, collapseAllGroups, moveCurrentTab, moveGroup, pinCurrentTab, unpinCurrentTab, pinCurrentGroup, unpinCurrentGroup, type TabInfo } from "../../lib/tabs.ts";
  import { getPinnedTabs, getPinForTab, type PinnedTabEntry } from "../../lib/pin.ts";
  import { archiveTabs, getArchiveCount } from "../../lib/archive.ts";
  import { search, rankedSearch, tabsToSearchItems, searchBookmarks, searchHistory, parseCommand, buildSearchHaystack, buildTitleHaystack, type SearchResult } from "../../lib/search.ts";
  import { getAutoGroup, setAutoGroup, getAutoUngroup, setAutoUngroup, getUseRules, setUseRules, getAutoSort, setAutoSort, getAutoPinFollow, setAutoPinFollow, getAutoDiscard, setAutoDiscard, setSwitchToExisting } from "../../lib/rules.ts";
  import { matchCommands, ALL_COMMANDS, ACTION_COMMANDS, TRIAGE_COMMANDS, CATEGORY_STYLES, groupCommands, type CommandDefinition, type CommandCategory } from "../../lib/commands.ts";
  import { snapshotBeforeClose, snapshotBeforeGroup, executeUndo, peekUndo, loadUndoStack } from "../../lib/undo.ts";
  import { focusMode, unfocusMode, hasSavedWorkspace, exportTabsToFile, loadTabsFromText } from "../../lib/workspace.ts";
  import { addTabsToReadingList, isReadingListAvailable, getReadingList } from "../../lib/readinglist.ts";
  import { getRecentlyClosed, restoreSession } from "../../lib/sessions.ts";
  import { withBulkLock } from "../../lib/bulklock.ts";
  import { checkAIAvailability, getAIProgress, setAIProgress, defaultProgress, type AIGroupProgress } from "../../lib/ai.ts";
  import { getActionLog, ACTION_LOG_KEY, type ActionLogEntry } from "../../lib/actionLog.ts";
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

  // Same component serves two surfaces: the popup is a fixed 450x600 sheet, the side panel is
  // persistent and user-resizable. The caller says which, so the root can size accordingly.
  let { fluid = false }: { fluid?: boolean } = $props();

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let selectedIndex = $state(0);
  let commandHints = $state<CommandDefinition[]>([]);
  let statusMessage = $state("");
  let loading = $state(false);
  let paletteMode = $state<"search" | "commands">("search");

  let showHelp = $state(false);
  let activeSection = $state<SidebarSection>("dashboard");
  let showActions = $state(false);

  let autoGroupEnabled = $state(false);
  let autoUngroupEnabled = $state(false);
  let useRulesEnabled = $state(false);
  let autoSortEnabled = $state(false);
  let autoPinFollowEnabled = $state(false);
  let autoDiscardEnabled = $state(false);
  let switchToExistingEnabled = $state(false);
  let hasWorkspace = $state(false);
  let inputFocused = $state(!fluid);
  // The panel persists, so grabbing focus on open would yank it off the page the user is reading.
  let searchAutofocus = $state(!fluid);
  let canUndo = $state(false);
  let archiveCount = $state(0);
  let pinnedTabs = $state<PinnedTabEntry[]>([]);
  let fileInputEl = $state<HTMLInputElement | undefined>(undefined);
  let busy = $state(false);
  let aiProgress = $state<AIGroupProgress>(defaultProgress());
  let aiPollTimer: ReturnType<typeof setTimeout> | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingConfirm = $state<string | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let actionLog = $state<ActionLogEntry[]>([]);
  // The toggles below run background daemons that move tabs while the popup is shut. Until now
  // the only record of that was buried in Settings, so "why did my tab move" had no answer
  // anywhere near the switches that caused it.
  let anyAutomationOn = $derived(
    useRulesEnabled || autoGroupEnabled || autoUngroupEnabled || autoSortEnabled ||
    autoPinFollowEnabled || autoDiscardEnabled || switchToExistingEnabled
  );
  let lastAutomation = $derived(actionLog[0] ?? null);

  function relTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  let onboardingDismissed = $state(true);
  let helpFilter = $state("");
  let altPressed = $state(false);

  const FEEDBACK_URL = "https://github.com/samhvw8/TabOrdo/issues";

  const ICON = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const UNPIN_ICON = ICON('<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v2.34"/><path d="m2 2 20 20"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76"/>');
  const PIN_TOP_ICON = ICON('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1z"/><path d="M5 3h14"/>');

  interface DashActionDef { id: string; label: string; icon: string; tooltip: string; }

  const DASHBOARD_ACTION_POOL: DashActionDef[] = [
    { id: "sort", label: "Sort All", icon: ICON('<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>'), tooltip: "Sort tabs by domain." },
    { id: "group", label: "Group+", icon: ICON('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/>'), tooltip: "Group ungrouped tabs by domain." },
    { id: "dedup", label: "Dedup", icon: ICON('<rect width="8" height="14" x="2" y="6" rx="2"/><rect width="8" height="14" x="14" y="4" rx="2" opacity="0.5"/><path d="m15 2-3 3-3-3"/>'), tooltip: "Close duplicate tabs." },
    { id: "merge", label: "Merge", icon: ICON('<path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/>'), tooltip: "Move all tabs from other windows here." },
    { id: "pin", label: "Lock Tab", icon: ICON('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 2-2H6a2 2 0 0 0 2 2 1 1 0 0 1 1 1z"/>'), tooltip: "Hold current tab at its position in the group." },
    { id: "regroup", label: "Regroup", icon: ICON('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>'), tooltip: "Ungroup all, then regroup from scratch." },
    { id: "ungroup", label: "Ungroup", icon: ICON('<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/>'), tooltip: "Remove all tab groups." },
    { id: "shuffle", label: "Shuffle", icon: ICON('<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>'), tooltip: "Randomly reorder tabs." },
    { id: "unite", label: "Unite", icon: ICON('<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>'), tooltip: "Pull same-domain tabs here." },
    { id: "isolate", label: "Isolate", icon: ICON('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'), tooltip: "Move domain to new window." },
    { id: "splitv", label: "Split V", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>'), tooltip: "Side by side windows." },
    { id: "splith", label: "Split H", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/>'), tooltip: "Top/bottom windows." },
    { id: "splitdomain", label: "Split Dom", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'), tooltip: "One window per domain." },
    { id: "stack", label: "Stack", icon: ICON('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m2 12 8.58 3.91a2 2 0 0 0 1.66 0L21 12"/>'), tooltip: "Stack windows to left." },
    { id: "closeleft", label: "Close Left", icon: ICON('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'), tooltip: "Close tabs left of active." },
    { id: "closeright", label: "Close Right", icon: ICON('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'), tooltip: "Close tabs right of active." },
    { id: "closeold", label: "Close Old", icon: ICON('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'), tooltip: "Close tabs older than 7 days." },
    { id: "closesite", label: "Close Site", icon: ICON('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'), tooltip: "Close other tabs from this domain." },
    { id: "focus", label: "Focus", icon: ICON('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'), tooltip: "Save tabs & start fresh." },
    { id: "save", label: "Save", icon: ICON('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'), tooltip: "Export tabs as text." },
    { id: "load", label: "Load", icon: ICON('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>'), tooltip: "Import tabs from text." },
    { id: "archive", label: "Archive", icon: ICON('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'), tooltip: "Open archive." },
    { id: "aigroup", label: "AI Group", icon: ICON('<path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="12" cy="15" r="2"/><path d="M12 13v-2"/>'), tooltip: "Smart group tabs with on-device AI." },
    { id: "readlater", label: "Read Later", icon: ICON('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="m9 9.5 2 2 4-4"/>'), tooltip: "Save active tab to Reading List." },
    { id: "recent", label: "Recent", icon: ICON('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'), tooltip: "Show recently closed tabs." },
    { id: "sidepanel", label: "Side Panel", icon: ICON('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>'), tooltip: "Open TabOrdo in Side Panel." },
  ];

  const DEFAULT_DASHBOARD_IDS = ["sort", "group", "dedup", "merge", "pin"];
  const ACTION_POOL_MAP = new Map(DASHBOARD_ACTION_POOL.map(a => [a.id, a]));
  let dashboardActionIds = $state<string[]>([...DEFAULT_DASHBOARD_IDS]);
  let dashboardActions = $derived(dashboardActionIds.map(id => ACTION_POOL_MAP.get(id)).filter((a): a is DashActionDef => !!a));

  let activeTabPin = $derived.by(() => {
    const active = dashboardTabs.find(t => t.active && t.windowId === currentWindowId);
    if (!active || active.groupId === -1 || !active.groupTitle) return null;
    return getPinForTab(active.url, active.groupTitle, pinnedTabs, active.id) ?? null;
  });

  let pinDisplay = $derived.by(() => {
    if (altPressed) {
      if (activeTabPin && activeTabPin.position === 0) return { label: "Unlock", icon: UNPIN_ICON, tooltip: "Release this tab's held position." };
      return { label: "Lock Top", icon: PIN_TOP_ICON, tooltip: "Hold tab at the first position in its group." };
    }
    if (activeTabPin) return { label: "Unlock", icon: UNPIN_ICON, tooltip: "Release this tab's held position." };
    return { label: "Lock Tab", icon: ACTION_POOL_MAP.get("pin")!.icon, tooltip: "Hold current tab at its position in the group." };
  });

  // Rebuilding a carried group can fail (Chrome refuses tab edits mid-drag, for one), which
  // used to leave tabs loose or in a grey untitled group while the status bar still said
  // "Merged". Say so instead.
  function mergeStatus(r: { moved: number; groupsFailed: number }): string {
    if (r.moved === 0) return "Nothing to merge";
    if (r.groupsFailed > 0) return `Merged ${r.moved} tab(s) — ${r.groupsFailed} group(s) could not be rebuilt`;
    return `Merged ${r.moved} tab(s)`;
  }

  function smallIcon(svg: string): string {
    return svg.replace('width="16" height="16"', 'width="11" height="11"');
  }

  async function toggleDashboardAction(id: string) {
    const idx = dashboardActionIds.indexOf(id);
    if (idx >= 0) {
      dashboardActionIds = dashboardActionIds.filter(a => a !== id);
    } else {
      dashboardActionIds = [...dashboardActionIds, id];
    }
    await chrome.storage.local.set({ dashboardActionIds: [...dashboardActionIds] });
  }

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

  // Lock helper lives in lib/bulklock.ts — it releases only the lease this call took, so a
  // quick popup action can no longer unlock a long-running background AI grouping run.

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
  let searchTitleHaystack = $state<string[]>([]);
  let searchRecency = $state<number[]>([]);
  let searchPriority = $state<number[]>([]);
  let highlightQuery = $state("");

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

  // Strictly query-driven: the dashboard (and its action pad) stays put until you actually type.
  // The empty-query MRU that Enter acts on is surfaced by the jump hint under the search bar
  // instead, which doesn't cost the pad its screen.
  let showPalette = $derived(query.length > 0);

  // What Cmd+E → Enter will do right now. loadTabs sinks the active tab to the bottom of the
  // recency list, so results[0] on an empty query is the tab you were on before this one.
  let jumpTarget = $derived(!query && results.length > 0 ? results[0] : null);

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
    searchTitleHaystack = buildTitleHaystack(allTabs);
    // Active tab sinks to the bottom so empty-query MRU leads with the *previous* tab (Cmd+E → Enter = alt-tab).
    searchRecency = tabs.map((t) => (t.active && t.windowId === currentWindowId ? 0 : (t.lastAccessed ?? 0)));
    // Among equally-good search matches, favor tabs you're most likely looking for: pinned, or already in front of you.
    searchPriority = tabs.map((t) => (t.pinned || t.windowId === currentWindowId ? 1 : 0));
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
    highlightQuery = prefix ? searchQuery : query;

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
      const indices = rankedSearch(searchHaystack, query, 50, searchRecency, searchTitleHaystack, searchPriority);
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
          const freshIndices = rankedSearch(searchHaystack, capturedQuery, 50, searchRecency, searchTitleHaystack, searchPriority);
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
      // Triage views are table-driven: they only differ by which tabs they select, and the
      // eight hand-copied switch arms this replaces are what let a broken "@shared" hide.
      const view = TRIAGE_BY_PREFIX.get(prefix);
      if (view) {
        const viewTabs = await view.tabs();
        results = searchQuery
          ? rankedSearch(buildSearchHaystack(viewTabs), searchQuery).map((i) => viewTabs[i])
          : viewTabs;
        if (viewTabs.length === 0 && view.empty) statusMessage = view.empty;
        return;
      }

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
          const indices = rankedSearch(hay, searchQuery);
          results = indices.map((i) => items[i]);
          break;
        }
        case "p": {
          const pinned = allTabs.filter((t) => t.pinned);
          const hay = buildSearchHaystack(pinned);
          const indices = rankedSearch(hay, searchQuery);
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
          const indices = rankedSearch(hay, searchQuery);
          results = indices.map((i) => groupTabs[i]);
          break;
        }
        case "@": {
          const triageResults: SearchResult[] = [];
          for (const cat of TRIAGE_OVERVIEW) {
            const catTabs = await cat.overviewTabs!();
            if (catTabs.length === 0) continue;
            const matched = searchQuery
              ? rankedSearch(buildSearchHaystack(catTabs), searchQuery).map((i) => catTabs[i])
              : catTabs;
            if (matched.length === 0) continue;
            triageResults.push({ type: "divider", id: cat.id, title: `${cat.title} (${matched.length})`, url: "" });
            triageResults.push(...matched);
          }
          results = triageResults;
          if (triageResults.length === 0) {
            statusMessage = searchQuery ? "No triage matches" : "All clear — no tabs need attention";
          }
          break;
        }
        case "rl": {
          if (!isReadingListAvailable()) { results = []; statusMessage = "Reading List not available (Chrome 120+)"; break; }
          const rlItems = await getReadingList();
          const rlResults: SearchResult[] = rlItems.map((item, i) => ({
            type: "bookmark" as const, id: `rl-${i}`, title: `${item.hasBeenRead ? "✓ " : ""}${item.title}`, url: item.url,
          }));
          if (searchQuery) { const hay = buildSearchHaystack(rlResults); const indices = rankedSearch(hay, searchQuery); results = indices.map((i) => rlResults[i]); }
          else results = rlResults;
          if (rlResults.length === 0) statusMessage = "Reading List is empty";
          break;
        }
        case "rc": {
          const rcItems = await getRecentlyClosed();
          if (searchQuery) { const hay = buildSearchHaystack(rcItems); const indices = rankedSearch(hay, searchQuery); results = indices.map((i) => rcItems[i]); }
          else results = rcItems;
          if (rcItems.length === 0) statusMessage = "No recently closed tabs";
          break;
        }
        case "re": {
          const indices = search(searchHaystack, searchQuery, "regex", 50, searchRecency);
          results = indices.map((i) => allTabs[i]);
          break;
        }
        default:
          if (ACTION_PREFIXES.has(prefix)) {
            const indices = searchQuery ? rankedSearch(searchHaystack, searchQuery, 50, searchRecency, searchTitleHaystack, searchPriority) : [];
            results = indices.map((i) => allTabs[i]);
          } else {
            const indices = rankedSearch(searchHaystack, `/${prefix} ${searchQuery}`, 50, searchRecency, searchTitleHaystack, searchPriority);
            results = indices.map((i) => allTabs[i]);
          }
      }
    } finally {
      loading = false;
      selectedIndex = 0;
    }
  }

  const ACTION_PREFIXES = new Set(ACTION_COMMANDS.map((c) => c.prefix));

  interface TriageCategory {
    prefix: string;
    id: string;
    title: string;
    tabs: () => SearchResult[] | Promise<SearchResult[]>;
    /** Status line when the dedicated @-view comes back empty. */
    empty?: string;
    /** Whether the bare "@" overview lists this category, and with what (shorter) list. */
    overviewTabs?: () => SearchResult[] | Promise<SearchResult[]>;
  }

  // One definition per category, driving both the dedicated "@x" views and the bare "@"
  // overview. Overview order follows this list.
  const TRIAGE_CATEGORIES: TriageCategory[] = [
    { prefix: "@a", id: "div-triage-audio", title: "Playing Audio",
      tabs: () => allTabs.filter((t) => t.audible), overviewTabs: () => allTabs.filter((t) => t.audible) },
    { prefix: "@m", id: "div-triage-muted", title: "Muted",
      tabs: () => allTabs.filter((t) => t.muted), overviewTabs: () => allTabs.filter((t) => t.muted) },
    { prefix: "@d", id: "div-triage-dupes", title: "Duplicates",
      tabs: () => findDuplicateTabs(allTabs), overviewTabs: () => findDuplicateTabs(allTabs) },
    // The dedicated view goes deeper than the overview section, which is one of six.
    { prefix: "@r", id: "div-triage-recent", title: "Recently Active",
      tabs: () => mostRecentTabs(20), overviewTabs: () => mostRecentTabs(15) },
    // "Unloaded" is what /discard produces: dropped from memory, reloads when you return.
    // "Paused by Chrome" is Chrome's own Memory Saver freeze — TabOrdo never sets it, so this
    // view is an observation, not a result of anything the user did here.
    { prefix: "@s", id: "div-triage-suspended", title: "Unloaded",
      tabs: () => allTabs.filter((t) => t.discarded), overviewTabs: () => allTabs.filter((t) => t.discarded) },
    { prefix: "@f", id: "div-triage-frozen", title: "Paused by Chrome", empty: "Chrome hasn't paused any tabs",
      tabs: () => allTabs.filter((t) => t.frozen), overviewTabs: () => allTabs.filter((t) => t.frozen) },
    { prefix: "@u", id: "div-triage-ungrouped", title: "Ungrouped", empty: "All tabs are grouped",
      tabs: () => allTabs.filter((t) => !t.groupId || t.groupId === -1) },
    { prefix: "@shared", id: "div-triage-shared", title: "Shared Groups", empty: "No shared group tabs",
      tabs: sharedGroupTabs },
  ];

  // A Map, not an object literal: an object lookup would hit Object.prototype, so a command
  // like /constructor or /toString would resolve to a truthy non-category and throw.
  const TRIAGE_BY_PREFIX = new Map(TRIAGE_CATEGORIES.map((c) => [c.prefix, c]));
  const TRIAGE_OVERVIEW = TRIAGE_CATEGORIES.filter((c) => c.overviewTabs);

  function mostRecentTabs(limit: number): SearchResult[] {
    return [...allTabs]
      .filter((t) => t.type === "tab")
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
      .slice(0, limit);
  }

  async function sharedGroupTabs(): Promise<SearchResult[]> {
    const allGroups = await chrome.tabGroups.query({});
    const sharedIds = new Set(allGroups.filter((g) => (g as any).shared === true).map((g) => g.id));
    return allTabs.filter((t) => t.groupId && sharedIds.has(t.groupId));
  }

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

  async function startAIPoll() {
    await setAIProgress({ ...defaultProgress(), status: "checking" });
    clearInterval(aiPollTimer);
    let ticks = 0;
    aiPollTimer = setInterval(async () => {
      aiProgress = await getAIProgress();
      ticks++;
      if (aiProgress.status === "done" || aiProgress.status === "error") {
        clearInterval(aiPollTimer);
        if (aiProgress.status === "done") await loadTabs();
      } else if (aiProgress.status === "idle" && ticks > 6) {
        clearInterval(aiPollTimer);
      }
    }, 500);
  }

  let groupCount = $derived(windows.reduce((n, w) => n + w.groups.size, 0));
  let audioCount = $derived(dashboardTabs.filter((t) => t.audible && !t.mutedInfo?.muted).length);
  let dupeCount = $derived(findDuplicateTabs(allTabs).length);
  let frozenCount = $derived(dashboardTabs.filter((t) => t.frozen).length);
  let suspendedCount = $derived(dashboardTabs.filter((t) => t.discarded && !t.frozen).length);

  // A single click on a dashboard/overflow button should never close tabs outright. Typing the
  // equivalent slash command is deliberate enough to skip the second tap, and undo covers both.
  const CONFIRM_ACTIONS = new Set(["merge", "dedup", "closeleft", "closeright", "closeold", "closesite", "focus"]);

  function needsConfirm(action: string): boolean {
    // "Focus" toggles: the unfocus direction restores tabs, so only arm the closing one.
    if (action === "focus") return !hasWorkspace;
    return CONFIRM_ACTIONS.has(action);
  }

  async function handleOverflowAction(action: string) {
    if (needsConfirm(action)) {
      if (pendingConfirm === action) {
        clearTimeout(confirmTimer);
        pendingConfirm = null;
      } else {
        pendingConfirm = action;
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => { pendingConfirm = null; }, 3000);
        return;
      }
    }
    const goBack = () => { activeSection = "dashboard"; };
    switch (action) {
      case "regroup": goBack(); dashAction(async () => { await snapshotBeforeGroup(); await groupTabsByDomain("rebuild"); return "Regrouped"; }); break;
      case "ungroup": goBack(); dashAction(async () => { await snapshotBeforeGroup(); await ungroupAll(); return "Ungrouped all"; }); break;
      case "shuffle": goBack(); dashAction(async () => { await snapshotBeforeGroup(); await shuffleTabs(); return "Shuffled"; }); break;
      case "unite": goBack(); dashAction(async () => { const n = await uniteDomain(); return n > 0 ? `United ${n}` : "None to unite"; }); break;
      case "isolate": goBack(); dashAction(async () => { const n = await isolateDomain(); return n > 0 ? `Isolated ${n}` : "Not enough tabs"; }); break;
      case "splitv": goBack(); dashAction(async () => { await snapshotBeforeGroup(); await splitWindow("vertical"); return "Split V"; }); break;
      case "splith": goBack(); dashAction(async () => { await snapshotBeforeGroup(); await splitWindow("horizontal"); return "Split H"; }); break;
      case "splitdomain": goBack(); dashAction(async () => { await snapshotBeforeGroup(); const n = await splitByDomain(); return n > 0 ? `${n + 1} windows` : "One domain"; }); break;
      case "stack": goBack(); dashAction(async () => { await stackWindows(); return "Stacked"; }); break;
      case "closeleft": goBack(); dashAction(async () => { const n = await closeTabsToLeft(); return n > 0 ? `Closed ${n} left` : "None to close"; }); break;
      case "closeright": goBack(); dashAction(async () => { const n = await closeTabsToRight(); return n > 0 ? `Closed ${n} right` : "None to close"; }); break;
      case "closeold": goBack(); dashAction(async () => { const n = await closeOldTabs(); return n > 0 ? `Closed ${n} old` : "No old tabs"; }); break;
      case "closesite": goBack(); dashAction(async () => { const n = await closeTabsSameSite(); return n > 0 ? `Closed ${n} same-site` : "No other tabs"; }); break;
      case "focus":
        goBack(); dashAction(async () => {
          if (hasWorkspace) { const n = await unfocusMode(); hasWorkspace = await hasSavedWorkspace(); return n > 0 ? `Restored ${n}` : "No workspace"; }
          else { const n = await focusMode(); hasWorkspace = await hasSavedWorkspace(); return n > 0 ? `Saved ${n}, focused` : "No tabs to save"; }
        }); break;
      case "save": goBack(); exportTabsToFile(); statusMessage = "Exporting..."; setTimeout(() => { statusMessage = ""; }, 2000); break;
      case "load": fileInputEl?.click(); break;
      case "archive": chrome.tabs.create({ url: chrome.runtime.getURL("/archive.html") }); break;
      case "feedback": chrome.tabs.create({ url: FEEDBACK_URL }); break;
      case "sort": goBack(); dashAction(async () => { await snapshotBeforeGroup(); await sortTabsInWindow(currentWindowId); return "Sorted"; }); break;
      case "group": goBack(); dashAction(async () => { await snapshotBeforeGroup(); await groupTabsByDomain("additive"); return "Grouped"; }); break;
      case "dedup": goBack(); dashAction(async () => { await snapshotBeforeGroup(); const n = await removeDuplicates(); return n > 0 ? `${n} removed` : "No dupes"; }); break;
      case "merge": goBack(); dashAction(async () => { await snapshotBeforeGroup(); return mergeStatus(await mergeAllWindows()); }); break;
      case "pin": goBack(); handlePinCurrent(new MouseEvent("click", { altKey: altPressed })); break;
      case "aigroup": goBack(); await snapshotBeforeGroup(); chrome.runtime.sendMessage({ type: "aigroup-start" }); statusMessage = "AI grouping started..."; startAIPoll(); activeSection = "ai"; break;
      case "readlater": goBack(); dashAction(async () => {
        if (!isReadingListAvailable()) return "Reading List not available (Chrome 120+)";
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (active?.url && active.title) { await addTabsToReadingList([{ url: active.url, title: active.title }]); return "Added to Reading List"; }
        return "No active tab";
      }); break;
      // updateResults() can't populate this one: "recent" is an action prefix, so it would
      // fall through to an empty tab search. Run the action itself to fill the list.
      case "recent": goBack(); query = "/recent "; paletteMode = "search"; commandHints = []; await handleActionCommand("recent", ""); break;
      case "sidepanel":
        if (chrome.sidePanel) { chrome.sidePanel.open({ windowId: currentWindowId }); }
        else { statusMessage = "Side Panel not available (Chrome 114+)"; setTimeout(() => { statusMessage = ""; }, 3000); }
        break;
    }
  }

  async function handleActionCommand(prefix: string, searchQuery: string) {
    if (!ACTION_PREFIXES.has(prefix)) return;
    if (busy) return;
    busy = true;

    try {
    await withBulkLock(async () => {
    const matchingIndices = searchQuery ? rankedSearch(searchHaystack, searchQuery, 50, searchRecency, searchTitleHaystack, searchPriority) : [];
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
          const tabData = matchingTabs.map((t) => ({ url: t.url, title: t.title, groupName: t.groupTitle }));
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
        await snapshotBeforeGroup(); statusMessage = mergeStatus(await mergeAllWindows()); await loadTabs(); acted = true; break;
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
        hasWorkspace = await hasSavedWorkspace();
        statusMessage = n > 0 ? `Saved ${n} tab(s), focus mode on` : "No tabs to save"; acted = true; break;
      }
      case "unfocus": {
        const n = await unfocusMode();
        hasWorkspace = await hasSavedWorkspace();
        statusMessage = n > 0 ? `Restored ${n} tab(s)` : "No saved workspace"; acted = true; break;
      }
      case "save":
        exportTabsToFile(); statusMessage = "Exporting tabs..."; acted = true; break;
      case "load":
        fileInputEl?.click(); acted = false; break;
      case "feedback":
        await chrome.tabs.create({ url: FEEDBACK_URL }); statusMessage = "Opening feedback page"; acted = true; break;
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
            const indices = rankedSearch(searchHaystack, filter, 50, searchRecency, searchTitleHaystack, searchPriority);
            const targets = indices.map((i) => allTabs[i]).filter((t) => t.tabId);
            let ok = 0;
            for (const t of targets) if (await setTabVolume(t.tabId!, level / 100)) ok++;
            // Without host permissions only the active tab is scriptable — say so rather than
            // reporting success for tabs that were never touched.
            statusMessage = ok === targets.length
              ? `Volume ${level}% on ${ok} tab(s)`
              : `Volume ${level}% on ${ok}/${targets.length} tab(s) — the rest need page access (only the active tab is reachable)`;
          } else {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active?.id) {
              const ok = await setTabVolume(active.id, level / 100);
              statusMessage = ok ? `Volume ${level}% on active tab` : "Can't control volume on this page";
            }
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
      case "lock":
      case "pin": {
        const msg = await pinCurrentTab(searchQuery);
        statusMessage = msg;
        acted = true;
        break;
      }
      case "unlock":
      case "unpin": {
        const msg = await unpinCurrentTab();
        statusMessage = msg;
        acted = true;
        break;
      }
      case "lockgroup":
      case "pingroup": {
        const msg = await pinCurrentGroup(searchQuery);
        statusMessage = msg;
        acted = true;
        break;
      }
      case "unlockgroup":
      case "unpingroup": {
        const msg = await unpinCurrentGroup();
        statusMessage = msg;
        acted = true;
        break;
      }
      case "readlater": {
        if (!isReadingListAvailable()) { statusMessage = "Reading List not available (requires Chrome 120+)"; acted = true; break; }
        if (tabIds.length > 0) {
          const tabData = matchingTabs.map((t) => ({ url: t.url, title: t.title }));
          const added = await addTabsToReadingList(tabData);
          statusMessage = added > 0 ? `Added ${added} to Reading List` : "No valid tabs to add";
        } else if (!searchQuery) {
          const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (active?.url && active.title) {
            await addTabsToReadingList([{ url: active.url, title: active.title }]);
            statusMessage = "Added to Reading List";
          }
        }
        acted = true;
        break;
      }
      case "recent": {
        const recentClosed = await getRecentlyClosed();
        if (searchQuery) {
          const hay = buildSearchHaystack(recentClosed);
          const indices = rankedSearch(hay, searchQuery);
          results = indices.map((i) => recentClosed[i]);
        } else {
          results = recentClosed;
        }
        if (recentClosed.length === 0) statusMessage = "No recently closed tabs";
        acted = false;
        break;
      }
      case "sidepanel":
        if (chrome.sidePanel) { await chrome.sidePanel.open({ windowId: currentWindowId }); statusMessage = "Opened Side Panel"; }
        else { statusMessage = "Side Panel not available (Chrome 114+)"; }
        acted = true;
        break;
      case "restore": {
        const sessions = await chrome.sessions?.getRecentlyClosed?.({ maxResults: 1 }) ?? [];
        if (sessions.length > 0) {
          const s = sessions[0];
          const sid = s.tab?.sessionId || s.window?.sessionId;
          if (sid) { await restoreSession(sid); statusMessage = "Restored last closed"; }
          else { statusMessage = "Nothing to restore"; }
        } else { statusMessage = "No recently closed tabs"; }
        acted = true;
        break;
      }
      case "freeze":
        if (tabIds.length > 0) { await discardTabs(tabIds); statusMessage = `Unloaded ${tabIds.length} tab(s)`; acted = true; }
        else if (!searchQuery) {
          const inactiveTabs = (await chrome.tabs.query({})).filter((t) => !t.active && !t.pinned && !t.audible && !t.discarded);
          if (inactiveTabs.length > 0) { await discardTabs(inactiveTabs.map((t) => t.id!)); statusMessage = `Unloaded ${inactiveTabs.length} inactive tab(s)`; acted = true; }
          else { statusMessage = "No tabs to unload"; acted = true; }
        }
        break;
      case "aigroup": {
        await snapshotBeforeGroup();
        chrome.runtime.sendMessage({ type: "aigroup-start" });
        statusMessage = "AI grouping started in background...";
        startAIPoll();
        activeSection = "ai";
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
    searchTitleHaystack = buildTitleHaystack(allTabs);
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
    const toTop = e.altKey || e.ctrlKey;
    if (activeTabPin) {
      if (toTop && activeTabPin.position !== 0) {
        await dashAction(() => pinCurrentTab("^"));
      } else {
        await dashAction(() => unpinCurrentTab());
      }
    } else {
      await dashAction(() => pinCurrentTab(toTop ? "^" : ""));
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

  $effect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[ACTION_LOG_KEY]) {
        actionLog = Array.isArray(changes[ACTION_LOG_KEY].newValue) ? changes[ACTION_LOG_KEY].newValue : [];
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  });

  $effect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Alt") altPressed = true; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === "Alt") altPressed = false; };
    const onBlur = () => { altPressed = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  });

  onMount(async () => {
    // No lock reset here any more. It existed to clear a flag stranded by a popup that
    // closed mid-operation, but it also wiped the background's lock during an AI run —
    // and Chrome closes the popup on every focus loss. Lease expiry handles the stranded
    // case now, without one realm clobbering another's lock.
    await loadTabs();
    await loadUndoStack();
    canUndo = !!peekUndo();
    const config = await chrome.storage.local.get(["rulesConfig", "collapsedGroups", "dashboardActionIds"]);
    const rc = config.rulesConfig;
    if (rc) {
      autoGroupEnabled = rc.autoGroup ?? false;
      autoUngroupEnabled = rc.autoUngroup ?? false;
      useRulesEnabled = rc.useRules ?? false;
      autoSortEnabled = rc.autoSort ?? false;
      autoPinFollowEnabled = rc.autoPinFollow ?? false;
      autoDiscardEnabled = rc.autoDiscard ?? false;
      switchToExistingEnabled = rc.switchToExisting ?? false;
    }
    hasWorkspace = await hasSavedWorkspace();
    archiveCount = await getArchiveCount();
    actionLog = await getActionLog();
    aiProgress = await getAIProgress();
    if (aiProgress.status === "checking" || aiProgress.status === "prompting" || aiProgress.status === "grouping") {
      startAIPoll();
      activeSection = "ai";
    } else if (aiProgress.status === "done" || aiProgress.status === "error") {
      activeSection = "ai";
    }
    if (config.collapsedGroups) collapsedGroups = new Set(config.collapsedGroups);
    if (Array.isArray(config.dashboardActionIds)) dashboardActionIds = config.dashboardActionIds;
    const ob = await chrome.storage.local.get("onboardingDismissed");
    onboardingDismissed = !!ob.onboardingDismissed;
    try {
      const mode = await chrome.storage.session.get("openMode");
      if (mode.openMode === "dashboard") {
        searchAutofocus = false;
        inputFocused = false;
        await chrome.storage.session.remove("openMode");
      }
    } catch {}
    // Populate the empty-query MRU list. Without this `results` stayed empty until the first
    // keystroke, so Cmd+E → Enter (jump to the previous tab) silently did nothing.
    updateResults();
  });

  function openArchive() {
    chrome.tabs.create({ url: chrome.runtime.getURL("/archive.html") });
  }

  function onQueryChange() {
    updateResults();
  }
</script>

<div class="{fluid ? 'w-full h-screen' : 'w-[450px] h-[600px]'} flex flex-col overflow-hidden">
  <!-- Search bar — always visible -->
  <div class="flex items-center gap-1.5 px-3 pt-3 pb-2">
    <div class="flex-1 min-w-0">
    <SearchInput
      bind:value={query}
      oninput={onQueryChange}
      placeholder="Search tabs... (/ commands, @ triage)"
      autofocus={searchAutofocus}
      onfocuschange={(f) => { inputFocused = f; }}
      onkeydown={(e) => {
        if (e.key === "Tab" && !e.shiftKey) {
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
  </div>

  <div class="flex flex-1 min-h-0 overflow-hidden">
    <Sidebar
      bind:active={activeSection}
      {archiveCount}
      helpActive={showHelp}
      onarchive={openArchive}
      onhelp={() => { showHelp = !showHelp; activeSection = "dashboard"; }}
    />
  {#if activeSection === "rules"}
    <RulesEditor onclose={() => { activeSection = "dashboard"; }} />
  {:else if activeSection === "pins"}
    <PinsPanel />
  {:else if activeSection === "settings"}
    <SettingsPanel />
  {:else if activeSection === "ai"}
    <div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
      <div class="text-xs font-semibold text-text mb-2">AI Grouping</div>

      {#if aiProgress.status === "idle"}
        <div class="text-[11px] text-text-muted mb-3">Use on-device AI (Gemini Nano) to intelligently group your tabs by topic. Runs entirely on your device — no data sent externally.</div>
        <button
          class="w-full px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-hover transition-colors"
          onclick={() => { aiProgress = { ...aiProgress, status: "checking" }; snapshotBeforeGroup().catch(() => {}); chrome.runtime.sendMessage({ type: "aigroup-start" }); startAIPoll(); }}
        >Group tabs with AI</button>
      {:else if aiProgress.status === "checking"}
        <div class="flex items-center gap-2 text-[11px] text-text-muted">
          <span class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
          Checking AI availability...
        </div>
      {:else if aiProgress.status === "prompting"}
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-[11px] text-accent-cyan">
            <span class="w-3 h-3 border-2 border-accent-cyan border-t-transparent rounded-full animate-spin"></span>
            Analyzing {aiProgress.total} tabs with AI...
          </div>
          <div class="text-[10px] text-text-muted">{aiProgress.currentTab}</div>
          <div class="h-1 rounded-full bg-surface-active overflow-hidden">
            <div class="h-full bg-accent-cyan rounded-full transition-all" style="width: 50%"></div>
          </div>
        </div>
      {:else if aiProgress.status === "grouping"}
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-[11px] text-accent-green">
            <span class="w-3 h-3 border-2 border-accent-green border-t-transparent rounded-full animate-spin"></span>
            Creating groups...
          </div>
          <div class="text-[10px] text-text-muted">{aiProgress.currentTab}</div>
          <div class="h-1 rounded-full bg-surface-active overflow-hidden">
            <div class="h-full bg-accent-green rounded-full transition-all" style="width: {aiProgress.groupCount > 0 ? Math.round((aiProgress.grouped / aiProgress.total) * 100) : 75}%"></div>
          </div>
          <div class="text-[10px] text-text-muted">{aiProgress.grouped} tabs grouped into {aiProgress.groupCount} groups</div>
        </div>
      {:else if aiProgress.status === "done"}
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-[11px] text-accent-green">
            <svg class="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
            Done
          </div>
          <div class="text-[10px] text-text-muted">{aiProgress.currentTab}</div>
          {#if aiProgress.grouped > 0}
            <div class="mt-1 px-2 py-1.5 rounded-md bg-accent-green/10 border border-accent-green/20 text-[10px] text-accent-green">
              {aiProgress.grouped} tabs organized into {aiProgress.groupCount} groups
            </div>
          {:else}
            <div class="mt-1 px-2 py-1.5 rounded-md bg-surface-hover border border-border text-[10px] text-text-muted">
              No groups suggested — tabs may already be well-organized
            </div>
          {/if}
          <div class="flex gap-2 mt-2">
            <button
              class="flex-1 px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-hover transition-colors"
              onclick={() => { aiProgress = { ...defaultProgress(), status: "checking" }; snapshotBeforeGroup().catch(() => {}); chrome.runtime.sendMessage({ type: "aigroup-start" }); startAIPoll(); }}
            >Run again</button>
            <button
              class="px-3 py-2 rounded-lg bg-surface-hover text-text-muted text-xs border border-border hover:text-text transition-colors"
              onclick={async () => { aiProgress = defaultProgress(); await setAIProgress(aiProgress); activeSection = "dashboard"; }}
            >Dismiss</button>
          </div>
        </div>
      {:else if aiProgress.status === "error"}
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-[11px] text-accent-red">
            <svg class="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>
            Error
          </div>
          <div class="px-2 py-1.5 rounded-md bg-accent-red/10 border border-accent-red/20 text-[10px] text-accent-red break-words">{aiProgress.error}</div>
          <div class="flex gap-2 mt-2">
            <button
              class="flex-1 px-3 py-1.5 rounded-lg bg-surface-hover text-text text-xs hover:bg-surface-active transition-colors border border-border"
              onclick={() => { aiProgress = { ...defaultProgress(), status: "checking" }; snapshotBeforeGroup().catch(() => {}); chrome.runtime.sendMessage({ type: "aigroup-start" }); startAIPoll(); }}
            >Retry</button>
            <button
              class="px-3 py-1.5 rounded-lg bg-surface-hover text-text-muted text-xs border border-border hover:text-text transition-colors"
              onclick={async () => { aiProgress = defaultProgress(); await setAIProgress(aiProgress); activeSection = "dashboard"; }}
            >Dismiss</button>
          </div>
        </div>
      {/if}

      <div class="mt-4 pt-3 border-t border-border/50">
        <div class="text-[9px] text-text-muted/60 space-y-1">
          <div>Powered by Gemini Nano (on-device, private)</div>
          <div>Requires chrome://flags → #prompt-api-for-gemini-nano</div>
        </div>
      </div>
    </div>
  {:else if activeSection === "more"}
    <div class="flex-1 overflow-y-auto px-2 py-2 min-h-0">
      <div class="px-2 pb-1.5 text-[9px] text-text-muted/60">Click ★ to add/remove actions from dashboard</div>
      {#each [
        { title: "Organize", items: [
          { action: "sort", label: "Sort All", tip: "Sort tabs by domain" },
          { action: "group", label: "Group+", tip: "Group ungrouped tabs by domain" },
          { action: "dedup", label: "Dedup", tip: "Close duplicate tabs" },
          { action: "pin", label: "Pin Tab", tip: "Pin current tab at position" },
          { action: "regroup", label: "Regroup All", tip: "Ungroup all, then regroup from scratch" },
          { action: "ungroup", label: "Ungroup All", tip: "Remove all tab groups" },
          { action: "shuffle", label: "Shuffle", tip: "Randomly reorder tabs" },
        ]},
        { title: "Windows", items: [
          { action: "merge", label: "Merge", tip: "Move all tabs from other windows here" },
          { action: "unite", label: "Unite Domain", tip: "Pull same-domain tabs here" },
          { action: "isolate", label: "Isolate Domain", tip: "Move domain to new window" },
          { action: "splitv", label: "Split Vertical", tip: "Side by side windows" },
          { action: "splith", label: "Split Horizontal", tip: "Top/bottom windows" },
          { action: "splitdomain", label: "Split by Domain", tip: "One window per domain" },
          { action: "stack", label: "Stack", tip: "Stack windows to left" },
        ]},
        { title: "Close", items: [
          { action: "closeleft", label: "Close Left", tip: "Tabs left of active" },
          { action: "closeright", label: "Close Right", tip: "Tabs right of active" },
          { action: "closeold", label: "Close Old", tip: "Tabs older than 7 days" },
          { action: "closesite", label: "Close Same Site", tip: "Other tabs from this domain" },
        ]},
        { title: "Smart", items: [
          { action: "aigroup", label: "AI Group", tip: "Group tabs with on-device AI" },
          { action: "readlater", label: "Read Later", tip: "Save tab to Reading List" },
          { action: "recent", label: "Recently Closed", tip: "Restore closed tabs" },
          { action: "sidepanel", label: "Side Panel", tip: "Open persistent sidebar" },
        ]},
        { title: "Workspace", items: [
          { action: "focus", label: hasWorkspace ? "Unfocus" : "Focus", tip: hasWorkspace ? "Restore saved tabs" : "Save tabs & start fresh" },
          { action: "save", label: "Save to File", tip: "Export as text" },
          { action: "load", label: "Load from File", tip: "Import from text" },
          { action: "archive", label: "Open Archive", tip: `${archiveCount} saved` },
        ]},
      ] as section, si}
        {#if si > 0}
          <div class="my-1 mx-1 h-px bg-border/20"></div>
        {/if}
        <div class="px-2 pt-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted/70">{section.title}</div>
        <div class="grid gap-0.5">
          {#each section.items as item}
            {@const poolEntry = ACTION_POOL_MAP.get(item.action)}
            <div
              class="w-full text-left flex items-start gap-2.5 px-2 py-1.5 rounded-md hover:bg-surface-hover active:bg-surface-active transition-colors group cursor-pointer {pendingConfirm === item.action ? 'bg-accent-red/10 ring-1 ring-accent-red/30' : ''}"
              role="button" tabindex="0"
              onclick={() => handleOverflowAction(item.action)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOverflowAction(item.action); } }}
            >
              <span class="shrink-0 w-5 h-5 rounded bg-surface-active/60 flex items-center justify-center mt-px group-hover:bg-primary/15 group-hover:text-primary transition-colors">
                {#if poolEntry}{@html smallIcon(item.action === "pin" ? pinDisplay.icon : poolEntry.icon)}{/if}
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium {pendingConfirm === item.action ? 'text-accent-red' : 'text-text'}">{pendingConfirm === item.action ? "Click again to confirm" : item.action === "pin" ? pinDisplay.label : item.label}</div>
                <div class="text-[10px] text-text-muted/70 leading-tight">{item.action === "pin" ? pinDisplay.tooltip : item.tip}</div>
              </div>
              <button
                class="shrink-0 self-center text-sm leading-none transition-[color,opacity] hover:scale-110 {dashboardActionIds.includes(item.action) ? 'text-primary' : 'text-text-muted/30 opacity-0 group-hover:opacity-100'}"
                onclick={(e) => { e.stopPropagation(); toggleDashboardAction(item.action); }}
                title={dashboardActionIds.includes(item.action) ? "Remove from dashboard" : "Add to dashboard"}
              >{dashboardActionIds.includes(item.action) ? "★" : "☆"}</button>
            </div>
          {/each}
        </div>
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
        {@const buckets = groupCommands(catCmds)}
        {#each buckets as bucket}
          {#if bucket.group && buckets.length > 1}
            <div class="px-2 pt-1.5 pb-0.5 text-[9px] font-medium uppercase tracking-wider text-text-muted/60">{bucket.group}</div>
          {/if}
          {#each bucket.commands as cmd}
            <button
              class="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover transition-colors text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
              onclick={() => { query = cmd.prefix.startsWith("@") ? `${cmd.prefix} ` : `/${cmd.prefix} `; showHelp = false; helpFilter = ""; updateResults(); }}
            >
              <span class="font-mono text-xs font-medium w-16 shrink-0 {cmd.color}">{cmd.label}</span>
              <span class="text-xs text-text-muted">{cmd.description}</span>
            </button>
          {/each}
        {/each}
        {/if}
      {/each}
    </div>
  {:else if showPalette}
    <!-- Command palette mode -->
    {#if paletteMode === "commands"}
      <CommandHints commands={commandHints} {selectedIndex} onselect={handleCommandSelect} />
    {:else}
      <ResultList {results} {selectedIndex} {loading} {currentWindowId} windowIds={windows.map(w => w.windowId)} query={highlightQuery} onselect={handleSelect} onclose={handleClose} />
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
          <span class="inline-flex items-center gap-0.5">{audioCount} <svg class="w-3 h-3 inline" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></span>
        {/if}
        {#if dupeCount > 0}
          <span class="text-border">·</span>
          <span>{dupeCount} dupes</span>
        {/if}
        {#if frozenCount > 0}
          <span class="text-border">·</span>
          <span class="inline-flex items-center gap-0.5 text-accent-cyan" title="Paused by Chrome to save memory">{frozenCount} <svg class="w-3 h-3 inline" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m4.93 19.07 4.24-4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="M2 12h20"/></svg></span>
        {/if}
        {#if suspendedCount > 0}
          <span class="text-border">·</span>
          <span title="Unloaded from memory — reload when you return">{suspendedCount} unloaded</span>
        {/if}
      </div>

      <!-- What Enter does right now. Makes Cmd+E → Enter (jump back to the previous tab)
           visible without the palette taking the dashboard's place. -->
      {#if jumpTarget}
        <button
          class="mx-3 mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-surface-hover hover:bg-surface-active transition-colors text-left w-[calc(100%-1.5rem)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onclick={() => handleSelect(jumpTarget!)}
          title="Press Enter to jump back to this tab"
        >
          <kbd class="shrink-0 px-1 py-0.5 rounded bg-surface text-[9px] font-mono text-text-muted">↵</kbd>
          <span class="shrink-0 text-[11px] text-text-muted">Back to</span>
          <span class="truncate text-[11px] text-text">{jumpTarget.title || jumpTarget.url}</span>
        </button>
      {/if}

      <!-- Onboarding hint -->
      {#if !onboardingDismissed && allTabs.length >= 15}
        <div class="mx-3 mb-2 flex items-center gap-2 px-2.5 py-2 rounded-lg border border-primary/20 bg-primary/5 text-[11px] text-text-muted">
          <svg class="w-3.5 h-3.5 shrink-0 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
          <span>Type <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px] font-mono">/</kbd> for commands, <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px] font-mono">@</kbd> for triage. Try <span class="text-primary font-medium">/sort</span> to organize tabs.</span>
          <button class="ml-auto shrink-0 text-text-muted hover:text-text transition-colors" onclick={() => { onboardingDismissed = true; chrome.storage.local.set({ onboardingDismissed: true }); }}>✕</button>
        </div>
      {/if}

      <!-- Primary action buttons (customizable) -->
      {#if dashboardActions.length > 0}
        <div class="grid grid-cols-3 gap-1.5 px-3 pb-2 {busy ? 'opacity-50 pointer-events-none' : ''}"
          aria-busy={busy}>
          {#each dashboardActions as action}
            <ActionButton
              label={pendingConfirm === action.id ? "Confirm" : action.id === "focus" ? (hasWorkspace ? "Unfocus" : "Focus") : action.id === "pin" ? pinDisplay.label : action.label}
              icon={action.id === "pin" ? pinDisplay.icon : action.icon}
              tooltip={action.id === "pin" ? pinDisplay.tooltip : action.tooltip}
              confirming={pendingConfirm === action.id}
              onclick={(e) => {
                if (action.id === "pin") handlePinCurrent(e);
                else handleOverflowAction(action.id);
              }}
            />
          {/each}
        </div>
      {:else}
        <div class="px-3 pb-2 text-[10px] text-text-muted text-center py-2">
          No dashboard actions. Add some from <button class="text-primary hover:underline" onclick={() => { activeSection = "more"; }}>More Actions</button>.
        </div>
      {/if}

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
              const tabData = tabs.map((t) => ({ url: t.url, title: t.title, groupName: t.groupTitle }));
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
                {label: "Discard", enabled: autoDiscardEnabled, toggle: async () => { autoDiscardEnabled = !autoDiscardEnabled; await setAutoDiscard(autoDiscardEnabled); }, tip: "Auto-discard 45min+"},
                {label: "Switch", enabled: switchToExistingEnabled, toggle: async () => { switchToExistingEnabled = !switchToExistingEnabled; await setSwitchToExisting(switchToExistingEnabled); }, tip: "Jump to existing tab instead of duplicate"}] as t}
          <button
            class="px-1.5 py-0.5 rounded transition-colors border
              {t.enabled ? 'bg-primary/15 text-primary border-primary/30 font-medium' : 'bg-surface-hover text-text-muted border-transparent hover:border-border'}"
            onclick={t.toggle} title={t.tip} aria-pressed={t.enabled}
          >{t.enabled ? "✓ " : ""}{t.label}</button>
        {/each}
      </div>

      <!-- Last thing the background automation actually did, sitting right under the switches
           that caused it. Opens the full log in Settings. -->
      {#if anyAutomationOn && lastAutomation}
        <button
          class="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-md border border-border/60 bg-surface-hover/50 px-2 py-1 text-left text-[10px] transition-colors hover:bg-surface-hover"
          onclick={() => { activeSection = "settings"; }}
          title="Open the full automation log in Settings"
        >
          <span class="shrink-0 text-primary">⚡</span>
          <span class="shrink-0 font-medium text-text">{lastAutomation.action}</span>
          <span class="truncate text-text-muted">{lastAutomation.detail}</span>
          <span class="ml-auto shrink-0 text-text-muted/70">{relTime(lastAutomation.ts)}</span>
        </button>
      {/if}

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
          <svg class="w-3.5 h-3.5 shrink-0 text-accent-red" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
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
