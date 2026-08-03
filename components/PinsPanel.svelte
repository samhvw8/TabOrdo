<script lang="ts">
  import { onMount } from "svelte";
  import { getPinnedTabs, getPinnedGroups, savePinnedTabs, pinTab, unpinTab, unpinGroup, reorderPins, applyPinsToGroup, stripPinBadge, type PinnedTabEntry, type PinnedGroupEntry } from "../lib/pin.ts";
  import { switchToTab, setTitleBadge, getFullHostname } from "../lib/tabs/index.ts";
  import { getSortRules, setSortRules, type SortRule } from "../lib/rules.ts";
  import { faviconCacheUrl } from "../lib/favicon.ts";

  let pinnedTabs = $state<PinnedTabEntry[]>([]);
  let pinnedGroups = $state<PinnedGroupEntry[]>([]);
  let openTabs = $state<chrome.tabs.Tab[]>([]);
  let activeTabId = $state<number | null>(null);

  let dragGroup = $state<string | null>(null);
  let dragIndex = $state<number | null>(null);
  let dropIndex = $state<number | null>(null);

  let sortRules = $state<SortRule[]>([]);
  let newSortDomain = $state("");
  /** Per-rule text of the "add pattern" box, keyed by rule id. */
  let patternDrafts = $state<Record<string, string>>({});
  let ruleDragIndex = $state<number | null>(null);
  let ruleDropIndex = $state<number | null>(null);

  // Mirrors buildSortRanker's numbering: counted over rank-first rules only, so the badges the
  // user reads here are the positions the sort will actually apply.
  let rankNumbers = $derived.by<Map<string, number>>(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const rule of sortRules) {
      if (rule.enabled && rule.domain && rule.rankFirst) map.set(rule.id, n++);
    }
    return map;
  });

  interface GroupedPins {
    groupName: string;
    tabs: PinnedTabEntry[];
  }

  let groupedPins = $derived.by<GroupedPins[]>(() => {
    const map = new Map<string, PinnedTabEntry[]>();
    for (const pin of pinnedTabs) {
      const list = map.get(pin.groupName) || [];
      list.push(pin);
      map.set(pin.groupName, list);
    }
    return [...map.entries()]
      .map(([groupName, tabs]) => ({ groupName, tabs: tabs.sort((a, b) => a.position - b.position) }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName));
  });

  let sortedGroups = $derived<PinnedGroupEntry[]>(
    [...pinnedGroups].sort((a, b) => a.position - b.position)
  );

  async function load() {
    const raw = await getPinnedTabs();
    const groups = new Map<string, PinnedTabEntry[]>();
    for (const p of raw) {
      const list = groups.get(p.groupName) || [];
      list.push(p);
      groups.set(p.groupName, list);
    }
    let needsSave = false;
    for (const tabs of groups.values()) {
      tabs.sort((a, b) => a.position - b.position);
      for (let i = 0; i < tabs.length; i++) {
        if (tabs[i].position !== i) {
          tabs[i].position = i;
          needsSave = true;
        }
      }
    }
    // Sync pins with currently open tabs: backfill tabIds, update titles/URLs
    const allTabs = await chrome.tabs.query({});
    for (const pin of raw) {
      const openTab = pin.tabId ? allTabs.find((t) => t.id === pin.tabId) : undefined;
      const matchByUrl = !openTab ? allTabs.find((t) => t.url === pin.url) : undefined;
      const match = openTab || matchByUrl;
      if (match) {
        if (match.id && pin.tabId !== match.id) {
          pin.tabId = match.id;
          needsSave = true;
          // A backfilled id means this session never badged the tab (ids reset at startup,
          // and the URL match is how the pin found it again) — put the 📌 back.
          void setTitleBadge(match.id, true);
        }
        // The badge is part of the page title while the lock is live; storing it verbatim
        // put "📌 " inside the pin's own saved title.
        const cleanTitle = stripPinBadge(match.title);
        if (cleanTitle && pin.title !== cleanTitle) { pin.title = cleanTitle; needsSave = true; }
        if (match.url && pin.url !== match.url) { pin.url = match.url; needsSave = true; }
      } else if (!pin.tabId) {
        const byUrl = allTabs.find((t) => t.url === pin.url);
        if (byUrl?.id) { pin.tabId = byUrl.id; needsSave = true; }
      }
    }

    if (needsSave) await savePinnedTabs(raw);
    pinnedTabs = raw;
    sortRules = await getSortRules();
    pinnedGroups = await getPinnedGroups();
    openTabs = allTabs;
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = active?.id ?? null;
  }

  // --- Sort priority ------------------------------------------------------
  // Ordering rules, not locks: nothing is held at an absolute index, so these only bite when a
  // sort runs. Every mutation writes straight through — there is no Save button to forget.

  async function saveSortRules() {
    await setSortRules(sortRules);
  }

  /** Accept a pasted URL as readily as a bare host — both are how people name a site. */
  function normalizeDomainInput(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (trimmed.includes("://")) return getFullHostname(trimmed) || trimmed;
    return trimmed.replace(/^www\./, "");
  }

  async function addSortRule() {
    const domain = normalizeDomainInput(newSortDomain);
    if (!domain) return;
    newSortDomain = "";
    // A duplicate entry would be dead weight: buildSortRanker takes the first match and the
    // second could never fire.
    if (sortRules.some((r) => r.domain.toLowerCase() === domain.toLowerCase())) return;
    sortRules = [...sortRules, { id: crypto.randomUUID(), domain, rankFirst: false, patterns: [], enabled: true }];
    await saveSortRules();
  }

  async function removeSortRule(id: string) {
    sortRules = sortRules.filter((r) => r.id !== id);
    delete patternDrafts[id];
    await saveSortRules();
  }

  async function toggleRankFirst(rule: SortRule) {
    rule.rankFirst = !rule.rankFirst;
    await saveSortRules();
  }

  async function toggleRuleEnabled(rule: SortRule) {
    rule.enabled = !rule.enabled;
    await saveSortRules();
  }

  async function addPattern(rule: SortRule) {
    const pattern = (patternDrafts[rule.id] || "").trim();
    if (!pattern) return;
    patternDrafts[rule.id] = "";
    if (rule.patterns.includes(pattern)) return;
    rule.patterns = [...rule.patterns, pattern];
    await saveSortRules();
  }

  async function removePattern(rule: SortRule, index: number) {
    rule.patterns = rule.patterns.filter((_, i) => i !== index);
    await saveSortRules();
  }

  // Buttons rather than drag: the pattern rows sit inside an already-draggable rule row, and
  // nesting a second drag context there makes both of them unreliable.
  async function movePattern(rule: SortRule, index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rule.patterns.length) return;
    const next = [...rule.patterns];
    [next[index], next[target]] = [next[target], next[index]];
    rule.patterns = next;
    await saveSortRules();
  }

  function onRuleDragStart(index: number, e: DragEvent) {
    ruleDragIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    }
  }

  function onRuleDragOver(index: number, e: DragEvent) {
    if (ruleDragIndex === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    ruleDropIndex = index;
  }

  async function onRuleDrop(e: DragEvent) {
    e.preventDefault();
    const from = ruleDragIndex;
    const to = ruleDropIndex;
    resetRuleDrag();
    if (from === null || to === null || from === to) return;
    const next = [...sortRules];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    sortRules = next;
    await saveSortRules();
  }

  function resetRuleDrag() {
    ruleDragIndex = null;
    ruleDropIndex = null;
  }

  /** Enter submits, except mid-IME-composition where Enter is picking a candidate. */
  function submitOnEnter(e: KeyboardEvent, run: () => void) {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    run();
  }

  function findOpenTab(url: string, tabId?: number): chrome.tabs.Tab | undefined {
    if (tabId) {
      const byId = openTabs.find((t) => t.id === tabId);
      if (byId) return byId;
    }
    return openTabs.find((t) => t.url === url);
  }

  async function handleSwitchTo(pin: PinnedTabEntry) {
    const tab = findOpenTab(pin.url, pin.tabId);
    if (tab?.id) {
      await switchToTab(tab.id);
      return;
    }
    // Closed: a plain click reopens it. This list is the only place the tab still exists, and
    // a dead row that only shift-click revived read as broken.
    const created = await chrome.tabs.create({ url: pin.url, active: true });
    if (created.id) {
      // Re-point the entry at the new tab BEFORE regrouping: while the navigation is still
      // committing, tab.url is empty, so applyPinsToGroup and the badge sync can only find
      // the tab by id.
      await pinTab(pin.url, pin.groupName, pin.position, pin.title, created.id);
      const group = (await chrome.tabGroups.query({})).find((g) => g.title === pin.groupName);
      if (group) {
        await chrome.tabs.group({ tabIds: [created.id], groupId: group.id });
        await applyPinsToGroup(group.id, pin.groupName);
        // The group may live in another window — follow the tab there.
        await switchToTab(created.id);
      }
    }
    await load();
  }

  async function handleUnpinTab(pin: PinnedTabEntry) {
    // Pass the tabId so resolution matches getPinForTab's tabId-first order (see unpinTab).
    const removed = await unpinTab(pin.url, pin.groupName, pin.tabId);
    // The /unpin palette path clears the badge; without this the panel's unpin left the 📌
    // on the page until the next navigation.
    const tab = findOpenTab(pin.url, pin.tabId);
    if (removed && tab?.id) await setTitleBadge(tab.id, false);
    await load();
  }

  async function handleUnpinGroup(groupTitle: string) {
    await unpinGroup(groupTitle);
    await load();
  }

  function onDragStart(groupName: string, index: number, e: DragEvent) {
    dragGroup = groupName;
    dragIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    }
  }

  function onDragOver(groupName: string, index: number, e: DragEvent) {
    if (dragGroup !== groupName) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dropIndex = index;
  }

  async function onDrop(groupName: string, e: DragEvent) {
    e.preventDefault();
    if (dragGroup !== groupName || dragIndex === null || dropIndex === null || dragIndex === dropIndex) {
      resetDrag();
      return;
    }
    const group = groupedPins.find((g) => g.groupName === groupName);
    if (!group) { resetDrag(); return; }
    const urls = group.tabs.map((t) => t.url);
    const [moved] = urls.splice(dragIndex, 1);
    urls.splice(dropIndex, 0, moved);
    resetDrag();
    await reorderPins(groupName, urls);
    await load();
    debouncedApplyPins(groupName);
  }

  function resetDrag() {
    dragGroup = null;
    dragIndex = null;
    dropIndex = null;
  }

  let applyTimer: ReturnType<typeof setTimeout> | undefined;
  function debouncedApplyPins(groupName: string) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(async () => {
      const allGroups = await chrome.tabGroups.query({});
      const group = allGroups.find((g) => g.title === groupName);
      if (group) await applyPinsToGroup(group.id, groupName);
    }, 500);
  }

  function isTabOpen(pin: PinnedTabEntry): boolean {
    if (pin.tabId && openTabs.some((t) => t.id === pin.tabId)) return true;
    return openTabs.some((t) => t.url === pin.url);
  }

  let closedPinCount = $derived(
    pinnedTabs.filter((p) => !isTabOpen(p)).length
  );

  async function cleanupClosedPins() {
    const kept = pinnedTabs.filter((p) => isTabOpen(p));
    await savePinnedTabs(kept);
    await load();
  }

  onMount(() => { load(); });
</script>

<div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
  <div class="flex items-center justify-between mb-3">
    <span class="text-xs font-semibold text-text">Locked Tabs & Groups</span>
    <div class="flex items-center gap-2">
      {#if closedPinCount > 0}
        <button
          class="text-[10px] text-accent-red hover:text-accent-red/80 transition-colors"
          onclick={cleanupClosedPins}
          title="Remove {closedPinCount} lock(s) for tabs that are no longer open"
        >Clean {closedPinCount} closed</button>
      {/if}
      <button
        class="text-[10px] text-primary hover:text-primary-hover transition-colors"
        onclick={load}
      >Refresh</button>
    </div>
  </div>

  <!-- Sort Priority (ordering rules, not locks) -->
  <div class="mb-3">
    <div class="flex items-center gap-2 mb-1.5">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-accent-green">Sort Priority</span>
      <div class="flex-1 h-px bg-border/50"></div>
      <span class="text-[10px] text-text-muted">{sortRules.length}</span>
    </div>
    <div class="text-[9px] text-text-muted px-2 pb-1.5 leading-relaxed">
      Applies when sorting by domain. Drag to reorder — “first” domains lead the strip in this
      order, and each domain’s patterns order its own tabs.
    </div>

    {#if sortRules.length > 0}
      <div
        class="grid gap-1 mb-1.5"
        ondrop={onRuleDrop}
        ondragover={(e) => e.preventDefault()}
        role="list"
      >
        {#each sortRules as rule, i (rule.id)}
          {@const rank = rankNumbers.get(rule.id)}
          <div
            class="rounded-md border border-border bg-surface-hover transition-colors
              {ruleDragIndex === i ? 'opacity-40' : ''}
              {ruleDragIndex !== null && ruleDropIndex === i && ruleDragIndex !== i ? 'border-t-2 border-t-primary' : ''}
              {rule.enabled ? '' : 'opacity-50'}"
            role="listitem"
          >
            <div class="flex items-center gap-1.5 px-1.5 py-1">
              <div
                class="shrink-0 w-4 flex items-center justify-center cursor-grab active:cursor-grabbing text-text-muted hover:text-text select-none"
                draggable="true"
                ondragstart={(e) => onRuleDragStart(i, e)}
                ondragover={(e) => onRuleDragOver(i, e)}
                ondragend={resetRuleDrag}
                title="Drag to reorder"
                role="button"
                tabindex="0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/>
                  <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
                  <circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/>
                </svg>
              </div>

              <span class="text-[10px] font-mono w-6 text-center shrink-0 {rank === undefined ? 'text-text-muted' : 'text-accent-yellow'}">
                {rank === undefined ? "–" : `#${rank + 1}`}
              </span>

              <span class="text-xs text-text truncate flex-1" title={rule.domain}>{rule.domain}</span>

              <button
                class="shrink-0 text-[9px] px-1.5 py-0.5 rounded border transition-colors
                  {rule.rankFirst
                    ? 'border-accent-yellow text-accent-yellow bg-accent-yellow/10'
                    : 'border-border text-text-muted hover:text-text'}"
                onclick={() => toggleRankFirst(rule)}
                aria-pressed={rule.rankFirst}
                title={rule.rankFirst
                  ? "This domain leads the strip. Click to leave it in alphabetical order."
                  : "Alphabetical. Click to move this domain ahead of unlisted ones."}
              >first</button>

              <button
                class="shrink-0 text-[9px] px-1.5 py-0.5 rounded border transition-colors
                  {rule.enabled
                    ? 'border-accent-green text-accent-green bg-accent-green/10'
                    : 'border-border text-text-muted hover:text-text'}"
                onclick={() => toggleRuleEnabled(rule)}
                aria-pressed={rule.enabled}
                title={rule.enabled ? "Active — click to disable without deleting" : "Disabled — click to re-enable"}
              >{rule.enabled ? "on" : "off"}</button>

              <button
                class="shrink-0 px-1 text-[10px] text-accent-red hover:text-accent-red/80 transition-colors"
                onclick={() => removeSortRule(rule.id)}
                title="Delete this rule"
                aria-label="Delete rule for {rule.domain}"
              >×</button>
            </div>

            <div class="pl-7 pr-1.5 pb-1.5">
              {#each rule.patterns as pattern, pi (pattern)}
                <div class="flex items-center gap-1 py-0.5">
                  <span class="text-[9px] font-mono text-accent-cyan w-5 text-center shrink-0">#{pi + 1}</span>
                  <span class="text-[10px] font-mono text-text truncate flex-1" title={pattern}>{pattern}</span>
                  <button
                    class="shrink-0 px-1 text-[9px] text-text-muted hover:text-text disabled:opacity-30 disabled:hover:text-text-muted"
                    onclick={() => movePattern(rule, pi, -1)}
                    disabled={pi === 0}
                    title="Move up"
                    aria-label="Move {pattern} up"
                  >↑</button>
                  <button
                    class="shrink-0 px-1 text-[9px] text-text-muted hover:text-text disabled:opacity-30 disabled:hover:text-text-muted"
                    onclick={() => movePattern(rule, pi, 1)}
                    disabled={pi === rule.patterns.length - 1}
                    title="Move down"
                    aria-label="Move {pattern} down"
                  >↓</button>
                  <button
                    class="shrink-0 px-1 text-[9px] text-accent-red hover:text-accent-red/80"
                    onclick={() => removePattern(rule, pi)}
                    title="Remove this pattern"
                    aria-label="Remove pattern {pattern}"
                  >×</button>
                </div>
              {/each}
              <div class="flex items-center gap-1 mt-0.5">
                <input
                  class="flex-1 min-w-0 px-1.5 py-0.5 text-[10px] font-mono rounded bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
                  placeholder="path pattern, e.g. /truyen/* or */pulls*"
                  bind:value={patternDrafts[rule.id]}
                  onkeydown={(e) => submitOnEnter(e, () => addPattern(rule))}
                />
                <button
                  class="shrink-0 px-1.5 py-0.5 text-[10px] rounded border border-border text-primary hover:text-primary-hover hover:border-primary transition-colors"
                  onclick={() => addPattern(rule)}
                  aria-label="Add path pattern for {rule.domain}"
                >+</button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex items-center gap-1 px-0.5">
      <input
        class="flex-1 min-w-0 px-1.5 py-1 text-[10px] rounded bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
        placeholder="domain, e.g. github.com"
        bind:value={newSortDomain}
        onkeydown={(e) => submitOnEnter(e, addSortRule)}
      />
      <button
        class="shrink-0 text-[10px] px-2 py-1 rounded border border-border text-primary hover:text-primary-hover hover:border-primary transition-colors"
        onclick={addSortRule}
      >Add</button>
    </div>
  </div>

  <!-- Locked Groups (window-level) -->
  <div class="mb-3">
    <div class="flex items-center gap-2 mb-1.5">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-accent-yellow">Locked Groups</span>
      <div class="flex-1 h-px bg-border/50"></div>
      <span class="text-[10px] text-text-muted">{pinnedGroups.length}</span>
    </div>
    {#if pinnedGroups.length === 0}
      <div class="text-[10px] text-text-muted px-2 py-1.5">No pinned groups. Use /pingroup to pin a group position.</div>
    {:else}
      <div class="grid gap-1">
        {#each sortedGroups as pg}
          <div class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-hover border border-border">
            <span class="text-[10px] font-mono text-accent-yellow w-5 text-center shrink-0">#{pg.position + 1}</span>
            <span class="text-xs text-text truncate flex-1" title={pg.groupTitle}>{pg.groupTitle}</span>
            <button
              class="text-[10px] text-accent-red hover:text-accent-red/80 transition-colors shrink-0"
              onclick={() => handleUnpinGroup(pg.groupTitle)}
              title="Unpin this group"
            >unpin</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Locked Tabs (by group) -->
  <div>
    <div class="flex items-center gap-2 mb-1.5">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-accent-cyan">Locked Tabs</span>
      <div class="flex-1 h-px bg-border/50"></div>
      <span class="text-[10px] text-text-muted">{pinnedTabs.length}</span>
    </div>
    {#if pinnedTabs.length === 0}
      <div class="text-[10px] text-text-muted px-2 py-1.5">No pinned tabs. Use /pin to pin a tab position within a group.</div>
    {:else}
      {#each groupedPins as group}
        <div class="mb-2">
          <div class="flex items-center gap-2 px-2 py-1 rounded-t-md bg-surface-hover border border-b-0 border-border">
            <span class="w-2 h-2 rounded-full bg-accent-cyan shrink-0"></span>
            <span class="text-[10px] font-semibold text-text">{group.groupName}</span>
            <span class="text-[10px] text-text-muted">({group.tabs.length})</span>
          </div>
          <div
            class="border border-border rounded-b-md overflow-hidden"
            ondrop={(e) => onDrop(group.groupName, e)}
            ondragover={(e) => e.preventDefault()}
            role="list"
          >
            {#each group.tabs as pin, i}
              {@const openTab = findOpenTab(pin.url, pin.tabId)}
              {@const hostname = (() => { try { return new URL(pin.url).hostname; } catch { return pin.url; } })()}
              {@const displayTitle = pin.title || openTab?.title || hostname}
              {@const isDragOver = dragGroup === group.groupName && dropIndex === i && dragIndex !== i}
              {@const isActive = !!(openTab && openTab.id === activeTabId)}
              <div
                class="flex items-center border-b border-border last:border-b-0 transition-colors
                  {dragGroup === group.groupName && dragIndex === i ? 'opacity-40' : ''}
                  {isDragOver ? 'border-t-2 border-t-primary' : ''}
                  {isActive ? 'bg-primary/10 border-l-2 border-l-primary' : ''}"
                role="listitem"
              >
                <!-- Drag handle -->
                <div
                  class="shrink-0 w-7 flex items-center justify-center self-stretch cursor-grab active:cursor-grabbing text-text-muted hover:text-text hover:bg-surface-active transition-colors select-none"
                  draggable="true"
                  ondragstart={(e) => onDragStart(group.groupName, i, e)}
                  ondragover={(e) => onDragOver(group.groupName, i, e)}
                  ondragend={resetDrag}
                  title="Drag to reorder"
                  role="button"
                  tabindex="0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/>
                    <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
                    <circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/>
                  </svg>
                </div>

                <!-- Position badge -->
                <span class="text-[10px] font-mono text-accent-yellow w-6 text-center shrink-0 mr-1">#{pin.position + 1}</span>

                <!-- Favicon -->
                <img
                  src={faviconCacheUrl(pin.url)}
                  alt=""
                  class="w-3.5 h-3.5 shrink-0 rounded-sm mx-1"
                  onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />

                <!-- Clickable area → switch to tab (shift-click reopens if closed) -->
                <button
                  class="flex-1 min-w-0 text-left py-1.5 pr-1 cursor-pointer hover:bg-surface-hover {openTab ? '' : 'opacity-60'}"
                  onclick={() => handleSwitchTo(pin)}
                  title={openTab ? `Switch to: ${displayTitle}` : `Closed — click to reopen: ${pin.url}`}
                >
                  <div class="text-[10px] text-text truncate">{displayTitle}</div>
                  <div class="text-[9px] text-text-muted truncate">{pin.url}</div>
                </button>

                <!-- Unpin -->
                <button
                  class="shrink-0 px-2 self-stretch text-[10px] text-accent-red hover:text-accent-red/80 hover:bg-accent-red/5 transition-colors"
                  onclick={() => handleUnpinTab(pin)}
                  title="Unpin this tab"
                >unpin</button>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
