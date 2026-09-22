<script lang="ts">
  import { onMount } from "svelte";
  import { getAllTabs, switchToTab, closeTabs, pinCurrentTab, unpinCurrentTab, outlineBranch, type TabInfo } from "../../lib/tabs/index.ts";
  import { getPinnedTabs, getPinForTab, type PinnedTabEntry } from "../../lib/pin.ts";
  import { getArchiveCount } from "../../lib/archive.ts";
  import { tabsToSearchItems, searchBookmarks, searchHistory, parseCommand, type SearchResult } from "../../lib/search.ts";
  import { createTabSearch, type TabSearch } from "../../lib/tabsearch.ts";
  import { resolveView, readingListRows, duplicateTabs, firstSelectable, nextSelectable, ACTION_PREFIXES, type ViewContext } from "../../lib/views.ts";
  import { createDebouncer } from "../../lib/debounce.ts";
  import { updateConfig } from "../../lib/rules.ts";
  import { matchCommands, ALL_COMMANDS, TRIAGE_COMMANDS, CATEGORY_STYLES, groupCommands, type CommandDefinition, type CommandCategory } from "../../lib/commands.ts";
  import { snapshotBeforeGroup, executeUndo, hasUndo, touchesUndoStack } from "../../lib/undo.ts";
  import { hasSavedWorkspace, loadTabsFromText } from "../../lib/workspace.ts";
  import { getReadingList } from "../../lib/readinglist.ts";
  import { getRecentlyClosed } from "../../lib/sessions.ts";
  import { withBulkLock } from "../../lib/bulklock.ts";
  import { checkAIAvailability, getAIProgress, defaultProgress, AI_PROGRESS_KEY, type AIGroupProgress } from "../../lib/ai.ts";
  import { getActionLog, ACTION_LOG_KEY, type ActionLogEntry } from "../../lib/actionLog.ts";
  import { groupDotClass, relTime } from "../../lib/format.ts";
  import { runAction, runTile, sortGroup, extractGroup, type ActionContext, type ActionResult } from "../../lib/actions.ts";
  import { TILE_BY_ID, DEFAULT_DASHBOARD_IDS, MORE_SECTIONS, UNLOCK_FACE, type Tile, type TileFace } from "../../lib/dashboard.ts";
  import SearchInput from "../../components/SearchInput.svelte";
  import ResultList from "../../components/ResultList.svelte";
  import CommandHints from "../../components/CommandHints.svelte";
  import ActionButton from "../../components/ActionButton.svelte";
  import TabCard from "../../components/TabCard.svelte";
  import Sidebar, { type SidebarSection } from "../../components/Sidebar.svelte";
  import OverflowMenu from "../../components/OverflowMenu.svelte";
  import LazyRows from "../../components/LazyRows.svelte";

  // Same component serves two surfaces: the popup is a fixed 450x600 sheet, the side panel is
  // persistent and user-resizable. The caller says which, so the root can size accordingly.
  let { fluid = false }: { fluid?: boolean } = $props();

  // Rules, pins and settings are panels nobody sees on open, yet their code was in the App
  // chunk, parsed before every first paint. They load on their own now, started at idle rather
  // than on click: {#await} renders a promise that has already settled in the same frame, so a
  // panel opens without a blank flash.
  let rulesEditor: Promise<typeof import("../../components/RulesEditor.svelte")> | undefined;
  let pinsPanel: Promise<typeof import("../../components/PinsPanel.svelte")> | undefined;
  let settingsPanel: Promise<typeof import("../../components/SettingsPanel.svelte")> | undefined;
  const loadRulesEditor = () => (rulesEditor ??= import("../../components/RulesEditor.svelte"));
  const loadPinsPanel = () => (pinsPanel ??= import("../../components/PinsPanel.svelte"));
  const loadSettingsPanel = () => (settingsPanel ??= import("../../components/SettingsPanel.svelte"));

  let query = $state("");
  let results = $state.raw<SearchResult[]>([]);
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
  // `fluid` is fixed per mount — the popup and side-panel entrypoints each pass a literal — so
  // seeding from it once is the intent, not a missed derived. Silenced rather than left to sit,
  // because two standing warnings train you to skim past the next real one.
  // svelte-ignore state_referenced_locally
  let inputFocused = $state(!fluid);
  // The panel persists, so grabbing focus on open would yank it off the page the user is reading.
  // svelte-ignore state_referenced_locally
  let searchAutofocus = $state(!fluid);
  let canUndo = $state(false);
  let archiveCount = $state(0);
  let pinnedTabs = $state.raw<PinnedTabEntry[]>([]);
  let fileInputEl = $state<HTMLInputElement | undefined>(undefined);
  let busy = $state(false);
  let aiProgress = $state<AIGroupProgress>(defaultProgress());
  // Bookmark and history lookups: the rows under a plain query, and the /b and /h lists.
  const lookup = createDebouncer(200);
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

  let onboardingDismissed = $state(true);
  let helpFilter = $state("");
  let altPressed = $state(false);


  let dashboardActionIds = $state<string[]>([...DEFAULT_DASHBOARD_IDS]);
  let dashboardActions = $derived(dashboardActionIds.map(id => TILE_BY_ID.get(id)).filter((t): t is Tile => !!t));

  let activeTabPin = $derived.by(() => {
    const active = dashboardTabs.find(t => t.active && t.windowId === currentWindowId);
    if (!active || active.groupId === -1 || !active.groupTitle) return null;
    return getPinForTab(active.url, active.groupTitle, pinnedTabs, active.id) ?? null;
  });

  // Mirrors handlePinCurrent: a held tab releases, unless Alt can still move it to the top.
  let pinDisplay = $derived.by((): TileFace => {
    const lock = TILE_BY_ID.get("pin")!;
    if (activeTabPin && !(altPressed && activeTabPin.position !== 0)) return UNLOCK_FACE;
    return altPressed ? lock.alt! : lock;
  });

  /**
   * What a tile shows right now, on the grid and in the More panel alike. The table holds each
   * tile's resting face; Lock Tab and Focus also read state it can't know (is the tab held, is
   * a workspace saved), and Alt swaps in the alt-click's face.
   */
  function tileFace(tile: Tile, withAlt: boolean): TileFace {
    if (tile.id === "pin") return pinDisplay;
    if (withAlt && tile.alt) return tile.alt;
    if (tile.id === "focus" && hasWorkspace) return { ...tile, label: "Unfocus", tooltip: "Restore saved tabs." };
    return tile;
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

  // Every status message goes through here so none can strand on screen. The triage views
  // used to set statusMessage with no timer of their own, leaving "Reading List is empty"
  // pinned under the search bar until an unrelated action happened to overwrite it.
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  function flashStatus(msg: string, ms = 3000) {
    statusMessage = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusMessage = ""; }, ms);
  }

  // hasUndo lists key names only, so it is cheap to ask after every action and storage change.
  // Only the newest answer lands: an older one resolving late would light or dim the button for
  // a stack that has changed since.
  let undoCheck = 0;
  function refreshCanUndo(): void {
    const seq = ++undoCheck;
    void hasUndo().then((v) => { if (seq === undoCheck) canUndo = v; }, () => {});
  }

  async function handleUndo() {
    if (busy) return;
    busy = true;
    try {
      const msg = await withBulkLock(() => executeUndo());
      flashStatus(msg);
      await loadTabs();
    } catch (e) {
      // The entry is already popped by this point, so swallowing this left the user with no
      // message, no undo, and an unhandled rejection in the console.
      flashStatus(`Undo failed: ${e instanceof Error ? e.message : "unknown error"}`, 5000);
    } finally {
      refreshCanUndo();
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

  // $state.raw, and a plain let for the search, deliberately. A deep $state proxy puts a trap
  // on every element read, and rankedSearch reads the haystack, recency and priority arrays
  // thousands of times per keystroke — in loops and inside sort comparators. Measured at 2.4x
  // the whole search cost (8.5 ms vs 3.3 ms per keystroke at 1000 tabs). Nothing mutates any
  // of these in place; they are only ever replaced wholesale, which is exactly the case .raw
  // exists for. The template never reads tabSearch at all, so it needs no rune.
  let allTabs = $state.raw<SearchResult[]>([]);
  let tabSearch: TabSearch = createTabSearch([], [], []);
  let highlightQuery = $state("");

  interface WindowData {
    windowId: number;
    isCurrent: boolean;
    groups: Map<number, { title: string; color: string; tabs: TabInfo[] }>;
    ungrouped: TabInfo[];
    tabCount: number;
  }

  let windows = $state.raw<WindowData[]>([]);
  let dashboardTabs = $state.raw<TabInfo[]>([]);
  let selectedTabs = $state<Set<number>>(new Set());
  let currentWindowId = $state(0);

  // Strictly query-driven: the dashboard (and its action pad) stays put until you actually type.
  // The empty-query MRU that Enter acts on is surfaced by the jump hint under the search bar
  // instead, which doesn't cost the pad its screen.
  let showPalette = $derived(query.length > 0);

  // What Cmd+E → Enter will do right now. loadTabs sinks the active tab to the bottom of the
  // recency list, so results[0] on an empty query is the tab you were on before this one.
  let jumpTarget = $derived(!query && results.length > 0 ? results[0] : null);

  // The search box and the result list are siblings, so the combobox pairing is by id:
  // aria-activedescendant has to name the row the highlight is on. ResultList builds its row
  // ids from the same base, so the two stay in step.
  const RESULTS_LISTBOX_ID = "palette-results";
  let paletteVisible = $derived(showPalette && !showHelp && activeSection === "dashboard");
  let activeOptionId = $derived(
    paletteVisible && paletteMode === "search" && results[selectedIndex] && results[selectedIndex].type !== "divider"
      ? `${RESULTS_LISTBOX_ID}-option-${selectedIndex}`
      : undefined
  );

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

  async function loadTabs() {
    // Three independent reads; serialising them cost three round-trips for no ordering reason.
    const [tabs, win, pins] = await Promise.all([
      getAllTabs(),
      chrome.windows.getCurrent(),
      getPinnedTabs(),
    ]);
    currentWindowId = win.id!;
    pinnedTabs = pins;

    allTabs = tabsToSearchItems(tabs);
    tabSearch = createTabSearch(
      allTabs,
      // Active tab sinks to the bottom so empty-query MRU leads with the *previous* tab (Cmd+E → Enter = alt-tab).
      tabs.map((t) => (t.active && t.windowId === currentWindowId ? 0 : (t.lastAccessed ?? 0))),
      // Among equally-good search matches, favor tabs you're most likely looking for: pinned, or already in front of you.
      tabs.map((t) => (t.pinned || t.windowId === currentWindowId ? 1 : 0)),
    );
    warmWhenIdle(tabSearch);
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

    // The empty-query list is what the "Back to" hint shows and Enter opens, so it must not
    // keep a tab an action just closed. A typed query keeps its list: handleClose trims that
    // one itself and keeps the selection where Ctrl+Delete left it.
    if (!query) updateResults();
  }

  /**
   * Build the haystacks once the dashboard has painted, so the first keystroke finds them
   * ready. Building them in loadTabs held the first paint back by 2 ms at 1000 tabs for a
   * search the dashboard may never run; a key that beats this callback builds them itself.
   */
  function warmWhenIdle(search: TabSearch) {
    requestIdleCallback(() => { if (tabSearch === search) search.warm(); }, { timeout: 1000 });
  }

  /** Change the query from code. Setting `query` alone leaves the list ranked for the old one. */
  function setQuery(q: string) {
    query = q;
    updateResults();
  }

  async function updateResults() {
    const { prefix, query: searchQuery } = parseCommand(query);
    highlightQuery = prefix ? searchQuery : query;
    // A lookup for the previous query can only be stale now; the paths below schedule their own.
    // Its "Searching..." goes with it, or a plain query typed over "/b foo" would keep it.
    lookup.cancel();
    loading = false;
    if (prefixSource && prefixSource.prefix !== prefix) prefixSource = null;

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

    if (prefix === "b" || prefix === "h") {
      lookUpSource(prefix, searchQuery);
    } else if (prefix) {
      handlePrefixSearch(prefix, searchQuery);
    } else {
      results = tabSearch.rank(query);

      if (query.trim().length >= 2) {
        const capturedQuery = query;
        lookup.schedule(async () => {
          const [bookmarkResults, historyResults] = await Promise.all([
            searchBookmarks(capturedQuery, 5),
            searchHistory(capturedQuery, 5),
          ]);
          if (query !== capturedQuery) return;
          // The keystroke's own ranking, remembered — unless the tabs reloaded meanwhile, in
          // which case tabSearch is new and this ranks them afresh.
          const freshTabResults = tabSearch.rank(capturedQuery);
          results = [
            ...freshTabResults,
            ...(bookmarkResults.length > 0 ? [{ type: "divider" as const, id: "div-bookmarks", title: "Bookmarks", url: "" }, ...bookmarkResults] : []),
            ...(historyResults.length > 0 ? [{ type: "divider" as const, id: "div-history", title: "History", url: "" }, ...historyResults] : []),
          ];
          selectedIndex = firstSelectable(results);
        });
      }
    }
    selectedIndex = firstSelectable(results);
  }

  /**
   * /b and /h ask the browser process to search every bookmark or the whole history, and did
   * so for each character typed. They wait for typing to settle now, on the same 200 ms
   * debounce as the rows under a plain query, showing "Searching..." rather than the previous
   * query's list meanwhile. Enter flushes the wait (see onkeydown), so "/b react" typed fast
   * and entered still opens a match.
   */
  function lookUpSource(prefix: "b" | "h", searchQuery: string) {
    if (!searchQuery.trim()) {
      results = [];
      return;
    }
    const capturedQuery = query;
    loading = true;
    lookup.schedule(async () => {
      try {
        const found = await (prefix === "b" ? searchBookmarks(searchQuery) : searchHistory(searchQuery));
        if (query !== capturedQuery) return;
        results = found;
        selectedIndex = firstSelectable(results);
      } finally {
        if (query === capturedQuery) loading = false;
      }
    });
  }

  /**
   * Reading List and recently closed hand back their whole (short) list on every call, so a
   * keystroke only needs to re-rank what the view opened with. Fetched once per visit to the
   * prefix, and dropped by updateResults when the query leaves it, so coming back re-reads.
   */
  let prefixSource: { prefix: string; rows: Promise<SearchResult[]> } | null = null;

  function sourceOnce(prefix: string, load: () => Promise<SearchResult[]>): Promise<SearchResult[]> {
    if (prefixSource?.prefix !== prefix) {
      const rows = load();
      prefixSource = { prefix, rows };
      // A failed read must not stick for the rest of the visit.
      rows.catch(() => { if (prefixSource?.rows === rows) prefixSource = null; });
    }
    return prefixSource!.rows;
  }

  /**
   * The Chrome reads a view needs beyond the loaded tabs, made for that view alone. Reading
   * List rows are mapped inside the read, so every keystroke ranks the same row objects and
   * rankView keeps their haystack.
   */
  const VIEW_READS = new Map<string, () => Promise<Partial<ViewContext>>>([
    ["rl", async () => ({ source: await sourceOnce("rl", async () => readingListRows(await getReadingList())) })],
    ["rc", async () => ({ source: await sourceOnce("rc", () => getRecentlyClosed()) })],
    ["@b", async () => ({ branch: await activeBranch() })],
    ["@shared", async () => ({ groups: await chrome.tabGroups.query({}) })],
  ]);

  async function activeBranch(): Promise<{ id: number; depth: number }[]> {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    return active?.id ? outlineBranch(active.id) : [];
  }

  async function handlePrefixSearch(prefix: string, searchQuery: string) {
    loading = true;
    try {
      const read = VIEW_READS.get(prefix);
      const extra = read ? await read() : undefined;
      // Assembled after the read, so the view resolves against the latest tab load.
      const view = resolveView(prefix, searchQuery, {
        search: tabSearch,
        currentWindowId,
        activeGroupId: dashboardTabs.find((t) => t.active && t.windowId === currentWindowId)?.groupId ?? -1,
        ...extra,
      });
      results = view.rows;
      if (view.empty) flashStatus(view.empty);
    } finally {
      loading = false;
      selectedIndex = firstSelectable(results);
    }
  }

  /**
   * Dashboard tab lists render in chunks of this many rows, each a LazyRows that mounts only
   * near the viewport. Small enough that a chunk is cheap; large enough that a fast scroll
   * does not churn through dozens of observers.
   */
  const ROWS_PER_CHUNK = 20;

  function chunkRows<T>(items: T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += ROWS_PER_CHUNK) out.push(items.slice(i, i + ROWS_PER_CHUNK));
    return out;
  }

  // Read-only. The background owns the AI progress state machine end to end: runAIGroup's
  // first act is to read the status and refuse to start when one looks in flight, so a poller
  // that stamped "checking" could reject the very run it was opened to watch — and reopening
  // the popup mid-run reset a live "prompting" back to "checking", where it stuck for the
  // whole model call because suggestGroups writes no intermediate progress.
  const AI_IN_FLIGHT = new Set(["checking", "prompting", "grouping"]);

  /**
   * Single entry point for kicking off a run — takes the undo snapshot too, so a start that
   * gets refused doesn't leave a junk entry on the stack.
   *
   * Called outside withBulkLock. That used to be load-bearing — a UI lease still held at
   * hand-off made the background's acquire fail, and our release then cleared the lock
   * outright — but bulklock now grants concurrent leases and releases only its own, so this
   * is merely tidier than nesting. Writes nothing to the AI progress key; the background
   * owns it, because that key also gates runAIGroup's in-flight guard.
   */
  async function startAIGroup() {
    // Courtesy check — runAIGroup's own guard stays the authority. Without it a second
    // /aigroup during a live run would snapshot, spin, and then be refused anyway.
    const current = await getAIProgress();
    if (AI_IN_FLIGHT.has(current.status)) {
      aiProgress = current;
      activeSection = "ai";
      flashStatus("AI grouping already in progress");
      return;
    }

    // No undo point, no destructive regroup.
    try {
      await snapshotBeforeGroup();
    } catch {
      flashStatus("Could not save an undo point — AI grouping cancelled", 5000);
      return;
    }
    refreshCanUndo();

    activeSection = "ai";
    aiProgress = { ...defaultProgress(), status: "checking" };
    try {
      const res = await chrome.runtime.sendMessage({ type: "aigroup-start" });
      if (res && res.ok === false) {
        // Refused because another run raced past the check above — leave that run's progress
        // on screen rather than replacing it with an error about our own start.
        if (AI_IN_FLIGHT.has((await getAIProgress()).status)) {
          flashStatus(res.message, 5000);
          return;
        }
        aiProgress = { ...defaultProgress(), status: "error", error: res.message };
        flashStatus(res.message, 5000);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "AI grouping failed to start";
      aiProgress = { ...defaultProgress(), status: "error", error: message };
      flashStatus(message, 5000);
    }
  }

  let groupCount = $derived(windows.reduce((n, w) => n + w.groups.size, 0));
  let audioCount = $derived(dashboardTabs.filter((t) => t.audible && !t.mutedInfo?.muted).length);
  let dupeCount = $derived(duplicateTabs(allTabs).length);
  let frozenCount = $derived(dashboardTabs.filter((t) => t.frozen).length);
  let suspendedCount = $derived(dashboardTabs.filter((t) => t.discarded && !t.frozen).length);

  // Which tiles confirm is the table's call (TileDef.confirm in lib/commands.ts).
  function needsConfirm(action: string): boolean {
    // "Focus" toggles: the unfocus direction restores tabs, so only arm the closing one.
    if (action === "focus") return !hasWorkspace;
    return TILE_BY_ID.get(action)?.confirm ?? false;
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
    // Every tile runs its handler from the action table unless it needs something only the
    // component has: workspace or lock state, the palette, or the AI hand-off before the lock.
    switch (action) {
      case "focus": goBack(); dashCommand(hasWorkspace ? "unfocus" : "focus"); break;
      case "pin": goBack(); handlePinCurrent(new MouseEvent("click", { altKey: altPressed })); break;
      case "aigroup": goBack(); await startAIGroup(); break;
      case "archive": openArchive(); break;
      // updateResults() can't populate this one: "recent" is an action prefix, so it would
      // fall through to an empty tab search. Run the action itself to fill the list.
      case "recent": goBack(); query = "/recent "; paletteMode = "search"; commandHints = []; await handleActionCommand("recent", ""); break;
      default: goBack(); dashTile(action);
    }
  }

  /** Rank the live tab set against a query, keeping only rows backed by a real tab. */
  function rankTabs(q: string): SearchResult[] {
    if (!q) return [];
    return tabSearch.rank(q).filter((t) => t.tabId);
  }

  async function handleActionCommand(prefix: string, searchQuery: string) {
    if (!ACTION_PREFIXES.has(prefix)) return;
    if (busy) return;

    // Handled before the lock, deliberately. Inside withBulkLock the background's own
    // acquire lost to the UI lease we were still holding, and our release then cleared the
    // lock outright — leaving the entire AI run with no suppression at all.
    if (prefix === "aigroup") {
      query = "";
      await startAIGroup();
      return;
    }

    busy = true;

    try {
      await withBulkLock(async () => {
        const outcome = await runAction(prefix, actionContext(searchQuery, rankTabs(searchQuery)));
        if (!outcome) return;

        // The handler switched tabs (/parent): leave the way picking a result does.
        if (outcome.closePopup) { window.close(); return; }

        // Undefined message means "leave whatever is on screen" — a handler that matched
        // nothing shouldn't blank out the last thing the user was told.
        if (outcome.message !== undefined) flashStatus(outcome.message);
        if (outcome.results) results = outcome.results;
        if (outcome.workspaceChanged) hasWorkspace = await hasSavedWorkspace();

        if (outcome.acted) {
          query = "";
          refreshCanUndo();
          await loadTabs();
        }
      });
    } catch (e) {
      flashStatus(`Error: ${e instanceof Error ? e.message : "Action failed"}`, 5000);
    } finally {
      busy = false;
    }
  }

  async function handleSelect(item: SearchResult) {
    try {
      if (item.tabId) { await switchToTab(item.tabId); window.close(); }
      else if (item.url) { await chrome.tabs.create({ url: item.url }); window.close(); }
    } catch (e) {
      // A row can outlive its tab (the side panel stays open while tabs close elsewhere).
      // Unhandled, Enter looked like it did nothing at all.
      flashStatus(`Error: ${e instanceof Error ? e.message : "Could not open"}`, 5000);
    }
  }

  async function handleClose(item: SearchResult) {
    // It checked `busy` but never set it, so held Ctrl+Delete could interleave two
    // snapshot/close pairs against the same list.
    if (busy || !item.tabId) return;
    busy = true;
    try {
      await closeTabs([item.tabId]);
      canUndo = true;
      results = results.filter((r) => r.id !== item.id);
      // Closing the last row used to leave the selection past the end of the list, so the
      // palette stopped responding to Enter until the query changed.
      selectedIndex = Math.max(0, Math.min(selectedIndex, results.length - 1));
      tabSearch = tabSearch.without(item.id);
      allTabs = tabSearch.items;
      dashboardTabs = dashboardTabs.filter((t) => t.id !== item.tabId);
      await loadTabs();
    } catch (e) {
      flashStatus(`Error: ${e instanceof Error ? e.message : "Could not close tab"}`, 5000);
    } finally {
      busy = false;
    }
  }

  function handleCommandSelect(cmd: CommandDefinition) {
    setQuery(cmd.prefix.startsWith("@") ? `${cmd.prefix} ` : `/${cmd.prefix} `);
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
      // flashStatus, not a bare setTimeout: the loose timers this used to arm kept running
      // after the next action replaced the message, so a dash action followed by an undo
      // blanked the undo's confirmation early. flashStatus owns the single timer.
      if (msg) flashStatus(msg);
      selectedTabs = new Set();
    } catch (e) {
      flashStatus(`Error: ${e instanceof Error ? e.message : "Action failed"}`, 5000);
    } finally {
      // Refresh on failure too: a bulk close that Chrome refused one tab of has still closed
      // the others and pushed an undo entry, and the strip on screen has to say so.
      refreshCanUndo();
      await loadTabs().catch(() => {});
      busy = false;
    }
  }

  /** What a handler runs against. `matchingTabs` is what the query, or a selection, resolved to. */
  function actionContext(query: string, matchingTabs: SearchResult[]): ActionContext {
    return { query, matchingTabs, tabIds: matchingTabs.map((t) => t.tabId!), currentWindowId, rankTabs, requestFilePicker };
  }

  /**
   * Run a slash command's handler from a button, so a button and its command can't drift into
   * reporting different things for the same work. `tabs` stands in for the palette's matched
   * list, for the selection buttons.
   */
  function dashCommand(prefix: string, commandQuery = "", tabs: TabInfo[] = []) {
    return dashAction(() => settle(runAction(prefix, actionContext(commandQuery, tabsToSearchItems(tabs)))));
  }

  /** Run a tile. Not dashCommand: Group+ is tile id "group", and /group does something else. */
  function dashTile(id: string) {
    return dashAction(() => settle(runTile(id, actionContext("", []))));
  }

  /** A handler's outcome as dashAction wants it: the status line, workspace state re-read. */
  async function settle(pending: Promise<ActionResult | null>): Promise<string | undefined> {
    const outcome = await pending;
    if (outcome?.workspaceChanged) hasWorkspace = await hasSavedWorkspace();
    return outcome?.message;
  }

  /** Dashboard tile click: Lock Tab keeps its bespoke state toggle, everything else may have an alt mode. */
  function dashButtonClick(id: string, e: MouseEvent) {
    if (id === "pin") { handlePinCurrent(e); return; }
    const alt = (e.altKey || e.ctrlKey) ? TILE_BY_ID.get(id)?.alt : undefined;
    if (alt?.query !== undefined) { dashCommand(alt.action, alt.query); return; }
    handleOverflowAction(alt?.action ?? id);
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

  /**
   * Open the file picker — but only where it can actually finish. The OS picker takes focus,
   * and Chrome tears the action popup down the moment it loses focus (same reason the mount
   * comment below batches its reads), so `onchange` never fires and the load dies silently.
   * The side panel persists, so there it works.
   */
  function requestFilePicker() {
    if (!fluid) {
      flashStatus("Load from File needs the side panel — the popup closes when the file picker opens.", 5000);
      return;
    }
    fileInputEl?.click();
  }

  async function handleFileLoad(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const n = await loadTabsFromText(text);
    flashStatus(n > 0 ? `Loaded ${n} tab(s) into new window` : "No valid URLs found");
    (e.target as HTMLInputElement).value = "";
  }

  function applyConfig(rc: Record<string, unknown> | undefined) {
    if (!rc) return;
    autoGroupEnabled = rc.autoGroup === true;
    autoUngroupEnabled = rc.autoUngroup === true;
    useRulesEnabled = rc.useRules === true;
    autoSortEnabled = rc.autoSort === true;
    autoPinFollowEnabled = rc.autoPinFollow === true;
    autoDiscardEnabled = rc.autoDiscard === true;
    switchToExistingEnabled = rc.switchToExisting === true;
  }

  // Every cross-realm value used to be read once at mount and never again, which is what let
  // a side panel opened before an AI run keep offering to start one. Subscribing is also what
  // retires the old progress poller: an event only fires on a real change, so there is no
  // stale terminal state to read and no "has the background written yet?" heuristic to time
  // out. The popup writes none of these keys — it only listens.
  $effect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local") {
        if (changes[ACTION_LOG_KEY]) {
          actionLog = Array.isArray(changes[ACTION_LOG_KEY].newValue) ? changes[ACTION_LOG_KEY].newValue : [];
        }
        if (changes.rulesConfig) applyConfig(changes.rulesConfig.newValue);
        return;
      }
      if (area !== "session") return;
      if (changes[AI_PROGRESS_KEY]) {
        const p = changes[AI_PROGRESS_KEY].newValue as AIGroupProgress | undefined;
        if (p) {
          // Progress only — deliberately does not steer activeSection. The paths that start a
          // run switch to the panel themselves; doing it here would yank a user who had
          // navigated away back on every tick of a background run.
          aiProgress = p;
          if (p.status === "done") loadTabs();
        }
      }
      // Another surface pushed or popped.
      if (touchesUndoStack(changes)) refreshCanUndo();
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
    // These used to await one after another — a dozen IPC round-trips before the popup was
    // populated, each waiting on a result the next one did not need. Chrome tears the popup
    // down on every focus loss, so that cost is paid on every single open. Nothing here
    // depends on anything else here, so it all goes out at once, and the two storage reads
    // are batched into one call per area instead of four.
    // Two tiers, deliberately. Everything used to await in series — a dozen IPC round-trips
    // before anything appeared — and then briefly all in one Promise.all, which is concurrent
    // but still ONE barrier: the tab list waited on the archive count. Chrome tears the popup
    // down on every focus loss, so this is paid on every open.
    //
    // Tier 1 is what the first useful frame needs. Tier 2 feeds badges and panels that are
    // off-screen or secondary; each lands on its own and re-renders the one thing it owns.
    const critical = Promise.all([
      loadTabs(),
      chrome.storage.local.get(["rulesConfig", "collapsedGroups", "dashboardActionIds", "onboardingDismissed"]),
      chrome.storage.session.get("openMode").catch(() => ({}) as Record<string, unknown>),
    ]);

    refreshCanUndo();
    void hasSavedWorkspace().then((v) => { hasWorkspace = v; });
    void getArchiveCount().then((v) => { archiveCount = v; });
    void getActionLog().then((v) => { actionLog = v; });
    void getAIProgress().then((v) => {
      aiProgress = v;
      if (v.status !== "idle") activeSection = "ai";
    });

    const [, config, session] = await critical;
    applyConfig(config.rulesConfig);
    if (config.collapsedGroups) collapsedGroups = new Set(config.collapsedGroups);
    if (Array.isArray(config.dashboardActionIds)) dashboardActionIds = config.dashboardActionIds;
    onboardingDismissed = !!config.onboardingDismissed;
    if (session.openMode === "dashboard") {
      searchAutofocus = false;
      inputFocused = false;
      chrome.storage.session.remove("openMode").catch(() => {});
    }
    // loadTabs ranks an empty query itself. A query typed before the tabs arrived was ranked
    // against none, and would show nothing until the next keystroke.
    updateResults();
    // After the first paint, so the panels' code stays off the path to it (see loadRulesEditor).
    requestIdleCallback(() => { void loadRulesEditor(); void loadPinsPanel(); void loadSettingsPanel(); }, { timeout: 2000 });
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
      listboxId={RESULTS_LISTBOX_ID}
      expanded={paletteVisible && paletteMode === "search" && results.length > 0}
      activeDescendant={activeOptionId}
      onfocuschange={(f) => { inputFocused = f; }}
      onkeydown={(e) => {
        // Mid-composition the IME owns these keys: arrows walk the pinyin candidate list and
        // Enter commits the word. Acting on them here moved the result selection and switched
        // tabs out from under someone half way through typing a query.
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          const hints = matchCommands(query);
          if ((query.startsWith("/") || query.startsWith("@")) && hints.length > 0) {
            const target = paletteMode === "commands" && hints[selectedIndex] ? hints[selectedIndex] : hints[0];
            handleCommandSelect(target);
          }
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          selectedIndex = paletteMode === "commands"
            ? Math.min(selectedIndex + 1, commandHints.length - 1)
            : nextSelectable(results, selectedIndex, 1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          selectedIndex = paletteMode === "commands"
            ? Math.max(selectedIndex - 1, 0)
            : nextSelectable(results, selectedIndex, -1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const { prefix, query: searchQuery } = parseCommand(query);
          if (prefix && ACTION_PREFIXES.has(prefix)) {
            handleActionCommand(prefix, searchQuery);
          } else if (paletteMode === "commands" && commandHints[selectedIndex]) {
            handleCommandSelect(commandHints[selectedIndex]);
          } else if (prefix === "b" || prefix === "h") {
            // The list only exists once the debounced lookup has run: without the flush, Enter
            // inside the 200 ms after typing opened nothing, or the previous query's row.
            void lookup.flush().then(() => { if (results[selectedIndex]) handleSelect(results[selectedIndex]); });
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
          setQuery("");
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
    {#await loadRulesEditor() then { default: RulesEditor }}
      <RulesEditor onclose={() => { activeSection = "dashboard"; }} />
    {/await}
  {:else if activeSection === "pins"}
    {#await loadPinsPanel() then { default: PinsPanel }}
      <PinsPanel />
    {/await}
  {:else if activeSection === "settings"}
    {#await loadSettingsPanel() then { default: SettingsPanel }}
      <SettingsPanel {actionLog} />
    {/await}
  {:else if activeSection === "ai"}
    <div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
      <div class="text-xs font-semibold text-text mb-2">AI Grouping</div>

      {#if aiProgress.status === "idle"}
        <div class="text-[11px] text-text-muted mb-3">Use on-device AI (Gemini Nano) to intelligently group your tabs by topic. Runs entirely on your device — no data sent externally.</div>
        <button
          class="w-full px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-hover transition-colors"
          onclick={() => startAIGroup()}
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
              onclick={() => startAIGroup()}
            >Run again</button>
            <button
              class="px-3 py-2 rounded-lg bg-surface-hover text-text-muted text-xs border border-border hover:text-text transition-colors"
              onclick={() => { aiProgress = defaultProgress(); activeSection = "dashboard"; }}
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
              onclick={() => startAIGroup()}
            >Retry</button>
            <button
              class="px-3 py-1.5 rounded-lg bg-surface-hover text-text-muted text-xs border border-border hover:text-text transition-colors"
              onclick={() => { aiProgress = defaultProgress(); activeSection = "dashboard"; }}
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
      {#each MORE_SECTIONS as section, si}
        {#if si > 0}
          <div class="my-1 mx-1 h-px bg-border/20"></div>
        {/if}
        <div class="px-2 pt-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted/70">{section.title}</div>
        <div class="grid gap-0.5">
          {#each section.tiles as tile}
            {@const face = tileFace(tile, false)}
            <div
              class="w-full text-left flex items-start gap-2.5 px-2 py-1.5 rounded-md hover:bg-surface-hover active:bg-surface-active transition-colors group cursor-pointer {pendingConfirm === tile.id ? 'bg-accent-red/10 ring-1 ring-accent-red/30' : ''}"
              role="button" tabindex="0"
              onclick={() => handleOverflowAction(tile.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOverflowAction(tile.id); } }}
            >
              <span class="shrink-0 w-5 h-5 rounded bg-surface-active/60 flex items-center justify-center mt-px group-hover:bg-primary/15 group-hover:text-primary transition-colors">
                {@html smallIcon(face.icon)}
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium {pendingConfirm === tile.id ? 'text-accent-red' : 'text-text'}">{pendingConfirm === tile.id ? "Click again to confirm" : face.label}</div>
                <!-- The archive's size is worth a row's subtitle; on the grid the tooltip says what the tile does. -->
                <div class="text-[10px] text-text-muted/70 leading-tight">{tile.id === "archive" ? `${archiveCount} saved` : face.tooltip}</div>
              </div>
              <button
                class="shrink-0 self-center text-sm leading-none transition-[color,opacity] hover:scale-110 {dashboardActionIds.includes(tile.id) ? 'text-primary' : 'text-text-muted/30 opacity-0 group-hover:opacity-100'}"
                onclick={(e) => { e.stopPropagation(); toggleDashboardAction(tile.id); }}
                title={dashboardActionIds.includes(tile.id) ? "Remove from dashboard" : "Add to dashboard"}
              >{dashboardActionIds.includes(tile.id) ? "★" : "☆"}</button>
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
              onclick={() => { showHelp = false; helpFilter = ""; setQuery(cmd.prefix.startsWith("@") ? `${cmd.prefix} ` : `/${cmd.prefix} `); }}
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
      <ResultList {results} {selectedIndex} {loading} {currentWindowId} windowIds={windows.map(w => w.windowId)} query={highlightQuery} listboxId={RESULTS_LISTBOX_ID} onselect={handleSelect} onclose={handleClose} />
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
          {#each dashboardActions as tile}
            {@const face = tileFace(tile, altPressed)}
            <ActionButton
              label={pendingConfirm === tile.id ? "Confirm" : face.label}
              icon={face.icon}
              tooltip={face.tooltip}
              confirming={pendingConfirm === tile.id}
              onclick={(e) => dashButtonClick(tile.id, e)}
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
            onclick={() => confirmAction("closeSel", () => dashCommand("close", "", dashboardTabs.filter((t) => selectedTabs.has(t.id))))}>
            {pendingConfirm === "closeSel" ? "Confirm" : "Close"}
          </button>
          <!-- Through the /archive handler, not a copy of it: this copy closed every selected
               tab with no undo snapshot, so Ctrl+Z restored whatever unrelated entry was on top. -->
          <button class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-hover text-text-muted border border-border hover:text-text transition-colors"
            onclick={() => dashCommand("archive", "", dashboardTabs.filter((t) => selectedTabs.has(t.id)))}>Archive</button>
          <button class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-hover text-text-muted border border-border hover:text-text transition-colors"
            onclick={() => dashCommand("discard", "", dashboardTabs.filter((t) => selectedTabs.has(t.id)))}>Discard</button>
        </div>
      {/if}

      <!-- Toggles -->
      <div class="flex items-center gap-1 px-3 pb-2 text-[10px]">
        {#each [{label: "Rules", enabled: useRulesEnabled, toggle: async () => { useRulesEnabled = !useRulesEnabled; await updateConfig({ useRules: useRulesEnabled }); }, tip: "Custom rules for grouping"},
                {label: "Auto", enabled: autoGroupEnabled, toggle: async () => { autoGroupEnabled = !autoGroupEnabled; await updateConfig({ autoGroup: autoGroupEnabled }); }, tip: "Auto-group new tabs"},
                {label: "Ungroup", enabled: autoUngroupEnabled, toggle: async () => { autoUngroupEnabled = !autoUngroupEnabled; await updateConfig({ autoUngroup: autoUngroupEnabled }); }, tip: "Dissolve a group when only one tab is left. Named groups only — untitled ones are left alone, since another extension may still be filling them."}] as t}
          <button
            class="px-1.5 py-0.5 rounded transition-colors border
              {t.enabled ? 'bg-primary/15 text-primary border-primary/30 font-medium' : 'bg-surface-hover text-text-muted border-transparent hover:border-border'}"
            onclick={t.toggle} title={t.tip} aria-pressed={t.enabled}
          >{t.enabled ? "✓ " : ""}{t.label}</button>
        {/each}
        <div class="w-px h-3 bg-border/40 mx-0.5"></div>
        {#each [{label: "Sort", enabled: autoSortEnabled, toggle: async () => { autoSortEnabled = !autoSortEnabled; await updateConfig({ autoSort: autoSortEnabled }); }, tip: "Auto-sort on load"},
                {label: "Pin", enabled: autoPinFollowEnabled, toggle: async () => { autoPinFollowEnabled = !autoPinFollowEnabled; await updateConfig({ autoPinFollow: autoPinFollowEnabled }); }, tip: "Sync pins across windows"},
                {label: "Discard", enabled: autoDiscardEnabled, toggle: async () => { autoDiscardEnabled = !autoDiscardEnabled; await updateConfig({ autoDiscard: autoDiscardEnabled }); }, tip: "Auto-discard 45min+"},
                {label: "Switch", enabled: switchToExistingEnabled, toggle: async () => { switchToExistingEnabled = !switchToExistingEnabled; await updateConfig({ switchToExisting: switchToExistingEnabled }); }, tip: "Jump to existing tab instead of duplicate"}] as t}
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
          onclick={() => setQuery("@a ")}
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
                <span class="w-2 h-2 rounded-full shrink-0 {groupDotClass[group.color] || 'bg-border'}"></span>
                <span class="text-xs font-medium text-text truncate">{group.title}</span>
                <span class="text-[10px] text-text-muted shrink-0">({group.tabs.length})</span>
              </button>
              <button class="text-[10px] text-text-muted hover:text-text transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded"
                onclick={() => dashAction(() => extractGroup(groupId))}>Extract</button>
              <button class="text-[10px] text-text-muted hover:text-text transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded"
                onclick={() => dashAction(() => sortGroup(groupId, group.title))}>Sort</button>
            </div>
            {#if !collapsed}
              <div class="p-1 grid gap-0.5">
                {#each chunkRows(group.tabs) as rows}
                  <LazyRows rows={rows.length}>
                    {#each rows as tab (tab.id)}
                      <TabCard {tab} selected={selectedTabs.has(tab.id)}
                        positionPinned={!!getPinForTab(tab.url, group.title, pinnedTabs)}
                        ontoggle={() => toggleSelect(tab.id)}
                        onclose={() => dashAction(async () => { await closeTabs([tab.id]); })}
                        onmute={() => loadTabs()} />
                    {/each}
                  </LazyRows>
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
                {#each chunkRows(w.ungrouped) as rows}
                  <LazyRows rows={rows.length}>
                    {#each rows as tab (tab.id)}
                      <TabCard {tab} selected={selectedTabs.has(tab.id)}
                        ontoggle={() => toggleSelect(tab.id)}
                        onclose={() => dashAction(async () => { await closeTabs([tab.id]); })}
                        onmute={() => loadTabs()} />
                    {/each}
                  </LazyRows>
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
