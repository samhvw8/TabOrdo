<script lang="ts">
  import { onMount } from "svelte";
  import { getPinnedTabs, getPinnedGroups, savePinnedTabs, unpinTab, unpinGroup, reorderPins, applyPinsToGroup, type PinnedTabEntry, type PinnedGroupEntry } from "../lib/pin.ts";
  import { switchToTab } from "../lib/tabs.ts";

  let pinnedTabs = $state<PinnedTabEntry[]>([]);
  let pinnedGroups = $state<PinnedGroupEntry[]>([]);
  let openTabs = $state<chrome.tabs.Tab[]>([]);
  let activeTabId = $state<number | null>(null);

  let dragGroup = $state<string | null>(null);
  let dragIndex = $state<number | null>(null);
  let dropIndex = $state<number | null>(null);

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
        if (match.id && pin.tabId !== match.id) { pin.tabId = match.id; needsSave = true; }
        if (match.title && pin.title !== match.title) { pin.title = match.title; needsSave = true; }
        if (match.url && pin.url !== match.url) { pin.url = match.url; needsSave = true; }
      } else if (!pin.tabId) {
        const byUrl = allTabs.find((t) => t.url === pin.url);
        if (byUrl?.id) { pin.tabId = byUrl.id; needsSave = true; }
      }
    }

    if (needsSave) await savePinnedTabs(raw);
    pinnedTabs = raw;
    pinnedGroups = await getPinnedGroups();
    openTabs = allTabs;
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = active?.id ?? null;
  }

  function findOpenTab(url: string, tabId?: number): chrome.tabs.Tab | undefined {
    if (tabId) {
      const byId = openTabs.find((t) => t.id === tabId);
      if (byId) return byId;
    }
    return openTabs.find((t) => t.url === url);
  }

  async function handleSwitchTo(url: string, tabId: number | undefined, shiftKey: boolean) {
    const tab = findOpenTab(url, tabId);
    if (tab?.id) {
      await switchToTab(tab.id);
    } else if (shiftKey) {
      // Reopen a closed pinned tab at its URL
      await chrome.tabs.create({ url, active: true });
      await load();
    }
  }

  async function handleUnpinTab(url: string, groupName: string) {
    await unpinTab(url, groupName);
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
    <span class="text-xs font-semibold text-text">Pinned Tabs & Groups</span>
    <div class="flex items-center gap-2">
      {#if closedPinCount > 0}
        <button
          class="text-[10px] text-accent-red hover:text-accent-red/80 transition-colors"
          onclick={cleanupClosedPins}
          title="Remove {closedPinCount} pin(s) for tabs that are no longer open"
        >Clean {closedPinCount} closed</button>
      {/if}
      <button
        class="text-[10px] text-primary hover:text-primary-hover transition-colors"
        onclick={load}
      >Refresh</button>
    </div>
  </div>

  <!-- Pinned Groups (window-level) -->
  <div class="mb-3">
    <div class="flex items-center gap-2 mb-1.5">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-accent-yellow">Pinned Groups</span>
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

  <!-- Pinned Tabs (by group) -->
  <div>
    <div class="flex items-center gap-2 mb-1.5">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-accent-cyan">Pinned Tabs</span>
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
                  src="chrome-extension://{chrome.runtime.id}/_favicon/?pageUrl={encodeURIComponent(pin.url)}&size=16"
                  alt=""
                  class="w-3.5 h-3.5 shrink-0 rounded-sm mx-1"
                  onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />

                <!-- Clickable area → switch to tab (shift-click reopens if closed) -->
                <button
                  class="flex-1 min-w-0 text-left py-1.5 pr-1 cursor-pointer hover:bg-surface-hover {openTab ? '' : 'opacity-60'}"
                  onclick={(e) => handleSwitchTo(pin.url, pin.tabId, e.shiftKey)}
                  title={openTab ? `Switch to: ${displayTitle}` : `Closed — shift-click to reopen: ${pin.url}`}
                >
                  <div class="text-[10px] text-text truncate">{displayTitle}</div>
                  <div class="text-[9px] text-text-muted truncate">{pin.url}</div>
                </button>

                <!-- Unpin -->
                <button
                  class="shrink-0 px-2 self-stretch text-[10px] text-accent-red hover:text-accent-red/80 hover:bg-accent-red/5 transition-colors"
                  onclick={() => handleUnpinTab(pin.url, pin.groupName)}
                  title="Unpin this tab"
                >unpin</button>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Raw storage data for debugging -->
  <div class="mt-4 pt-3 border-t border-border">
    <div class="flex items-center gap-2 mb-1.5">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Raw Storage</span>
      <div class="flex-1 h-px bg-border/50"></div>
    </div>
    <pre class="text-[9px] text-text-muted bg-surface-hover rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{JSON.stringify({ pinnedTabs, pinnedGroups }, null, 2)}</pre>
  </div>
</div>
