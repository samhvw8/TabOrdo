<script lang="ts">
  import { onMount } from "svelte";
  import { getArchive, restoreFromArchive, deleteFromArchive, clearArchive, type ArchivedTab } from "../../lib/archive.ts";
  import { faviconCacheUrl } from "../../lib/favicon.ts";

  let archive = $state<ArchivedTab[]>([]);
  let searchQuery = $state("");
  let selectedIds = $state<Set<string>>(new Set());
  let statusMessage = $state("");
  // Tracks what is closed, not what is open. The other way round needed an empty set to mean
  // "everything is expanded", so collapsing the last open group emptied the set and sprang
  // them all back open.
  let collapsedGroups = $state<Set<string>>(new Set());

  let filtered = $derived.by(() => {
    if (!searchQuery.trim()) return archive;
    const q = searchQuery.toLowerCase();
    return archive.filter((a) => a.title.toLowerCase().includes(q) || a.url.toLowerCase().includes(q) || (a.groupName && a.groupName.toLowerCase().includes(q)));
  });

  interface DateGroup {
    label: string;
    dateKey: string;
    items: ArchivedTab[];
  }

  let grouped = $derived.by<DateGroup[]>(() => {
    const map = new Map<string, ArchivedTab[]>();
    for (const item of filtered) {
      const d = new Date(item.archivedAt);
      const dateKey = d.toISOString().slice(0, 10);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      let label: string;
      if (dateKey === today.toISOString().slice(0, 10)) label = "Today";
      else if (dateKey === yesterday.toISOString().slice(0, 10)) label = "Yesterday";
      else label = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(item);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, items]) => {
        const d = new Date(items[0].archivedAt);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        let label: string;
        if (dateKey === today.toISOString().slice(0, 10)) label = "Today";
        else if (dateKey === yesterday.toISOString().slice(0, 10)) label = "Yesterday";
        else label = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
        return { label, dateKey, items: items.sort((a, b) => b.archivedAt - a.archivedAt) };
      });
  });

  let uniqueDomains = $derived(new Set(archive.map((a) => { try { return new URL(a.url).hostname; } catch { return ""; } }).filter(Boolean)).size);
  let uniqueGroups = $derived(new Set(archive.filter((a) => a.groupName).map((a) => a.groupName!)).size);

  function isGroupExpanded(dateKey: string): boolean {
    return !collapsedGroups.has(dateKey);
  }

  function toggleGroup(dateKey: string) {
    const next = new Set(collapsedGroups);
    if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
    collapsedGroups = next;
  }

  async function reload() {
    archive = await getArchive();
    selectedIds = new Set();
  }

  async function handleRestore(ids: string[]) {
    const count = await restoreFromArchive(ids);
    showStatus(`Restored ${count} tab${count !== 1 ? "s" : ""}`);
    await reload();
  }

  async function handleDelete(ids: string[]) {
    await deleteFromArchive(ids);
    showStatus(`Deleted ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
    await reload();
  }

  async function handleClear() {
    if (!confirm("Clear entire archive? This cannot be undone.")) return;
    await clearArchive();
    showStatus("Archive cleared");
    await reload();
  }

  function showStatus(msg: string) {
    statusMessage = msg;
    setTimeout(() => { statusMessage = ""; }, 3000);
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  function selectAll() { selectedIds = new Set(filtered.map((a) => a.id)); }
  function selectNone() { selectedIds = new Set(); }

  function selectGroup(items: ArchivedTab[]) {
    const next = new Set(selectedIds);
    const allSelected = items.every((i) => next.has(i.id));
    for (const item of items) {
      if (allSelected) next.delete(item.id); else next.add(item.id);
    }
    selectedIds = next;
  }

  function faviconUrl(item: ArchivedTab): string {
    // Always Chrome's local cache, never the stored favIconUrl. These tabs were closed days
    // or weeks ago, so preferring the stored URL meant simply opening the archive fired a
    // request to every archived site's own server.
    return item.url ? faviconCacheUrl(item.url, 32) : "";
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function getDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  }

  onMount(() => { reload(); });
</script>

<div class="archive-root">
  <!-- Header -->
  <header class="header">
    <div class="header-inner">
      <div class="header-left">
        <div class="logo">
          <span class="logo-icon">📦</span>
          <span class="logo-text">TabOrdo Archive</span>
        </div>
        <div class="stats-row">
          <span class="stat">{archive.length} tab{archive.length !== 1 ? "s" : ""}</span>
          <span class="stat-sep">·</span>
          <span class="stat">{uniqueDomains} site{uniqueDomains !== 1 ? "s" : ""}</span>
          {#if uniqueGroups > 0}
            <span class="stat-sep">·</span>
            <span class="stat">{uniqueGroups} group{uniqueGroups !== 1 ? "s" : ""}</span>
          {/if}
        </div>
      </div>
      <div class="header-actions">
        {#if selectedIds.size > 0}
          <button class="btn btn-restore" onclick={() => handleRestore([...selectedIds])}>
            <span>↗</span> Restore {selectedIds.size}
          </button>
          <button class="btn btn-delete" onclick={() => handleDelete([...selectedIds])}>
            <span>✕</span> Delete {selectedIds.size}
          </button>
        {/if}
        {#if archive.length > 0}
          <button class="btn btn-ghost" onclick={handleClear}>Clear All</button>
        {/if}
      </div>
    </div>
  </header>

  <!-- Search bar -->
  <div class="search-bar">
    <div class="search-inner">
      <div class="search-input-wrap">
        <svg class="search-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l4.26 4.26a.75.75 0 11-1.06 1.06l-4.26-4.26A7 7 0 012 9z" clip-rule="evenodd"/></svg>
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search tabs, URLs, or group names..."
          class="search-input"
        />
        {#if searchQuery}
          <button class="search-clear" onclick={() => { searchQuery = ""; }}>✕</button>
        {/if}
      </div>
      <div class="search-actions">
        <button class="link-btn" onclick={selectAll}>Select all</button>
        <span class="stat-sep">·</span>
        <button class="link-btn" onclick={selectNone}>Deselect</button>
        {#if searchQuery}
          <span class="search-count">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Status toast -->
  {#if statusMessage}
    <div class="toast">{statusMessage}</div>
  {/if}

  <!-- Content -->
  <main class="content">
    {#if archive.length === 0}
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 80 80" fill="none" class="empty-svg">
            <rect x="10" y="24" width="60" height="44" rx="6" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
            <path d="M10 36h60" stroke="currentColor" stroke-width="2" opacity="0.2"/>
            <rect x="20" y="12" width="40" height="16" rx="4" stroke="currentColor" stroke-width="2" fill="none" opacity="0.5"/>
            <path d="M32 44h16M36 52h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.2"/>
          </svg>
        </div>
        <h2 class="empty-title">No archived tabs yet</h2>
        <p class="empty-desc">Save tabs to access them later without keeping them open.</p>
        <div class="empty-hints">
          <div class="hint">
            <span class="hint-key">/archive</span>
            <span class="hint-desc">Archive matching tabs via command palette</span>
          </div>
          <div class="hint">
            <span class="hint-key">Archive Sel.</span>
            <span class="hint-desc">Archive selected tabs from the dashboard</span>
          </div>
        </div>
      </div>
    {:else if filtered.length === 0}
      <div class="empty-state">
        <div class="empty-icon-sm">🔍</div>
        <p class="empty-title-sm">No results for "{searchQuery}"</p>
        <p class="empty-desc">Try a different search term</p>
      </div>
    {:else}
      <div class="groups">
        {#each grouped as group}
          <div class="date-group">
            <div class="date-header" role="button" tabindex="0"
              onclick={() => toggleGroup(group.dateKey)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(group.dateKey); } }}>
              <span class="date-chevron" class:collapsed={!isGroupExpanded(group.dateKey)}>▾</span>
              <span class="date-label">{group.label}</span>
              <span class="date-count">{group.items.length} tab{group.items.length !== 1 ? "s" : ""}</span>
              <div class="date-line"></div>
              <button
                class="date-select-btn"
                onclick={(e) => { e.stopPropagation(); selectGroup(group.items); }}
                title="Select/deselect group"
              >{group.items.every((i) => selectedIds.has(i.id)) ? "Deselect" : "Select"}</button>
            </div>
            {#if isGroupExpanded(group.dateKey)}
              <div class="tab-list">
                {#each group.items as item}
                  {@const isSelected = selectedIds.has(item.id)}
                  <div
                    class="tab-item"
                    class:selected={isSelected}
                    role="button" tabindex="0"
                    onclick={() => toggleSelect(item.id)}
                    onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSelect(item.id); } }}
                  >
                    <div class="tab-checkbox">
                      <input type="checkbox" checked={isSelected} tabindex={-1} />
                    </div>
                    <div class="tab-favicon">
                      <img src={faviconUrl(item)} alt=""
                        onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        onload={(e) => { (e.target as HTMLImageElement).style.display = ''; }} />
                    </div>
                    <div class="tab-info">
                      <div class="tab-title">{item.title}</div>
                      <div class="tab-meta">
                        <span class="tab-domain">{getDomain(item.url)}</span>
                        <span class="tab-time">{formatTime(item.archivedAt)}</span>
                      </div>
                    </div>
                    {#if item.groupName}
                      <span class="tab-group-badge">{item.groupName}</span>
                    {/if}
                    <div class="tab-actions">
                      <button
                        class="action-btn restore"
                        title="Restore tab"
                        onclick={(e) => { e.stopPropagation(); handleRestore([item.id]); }}
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 8a6 6 0 1110.89-3.477l.707-.707A7 7 0 101.05 8.57l.005-.07H2z"/><path d="M4.854 7.146a.5.5 0 00-.708 0l-2 2a.5.5 0 000 .708l2 2a.5.5 0 10.708-.708L3.707 10H7.5a.5.5 0 000-1H3.707l1.147-1.146a.5.5 0 000-.708z"/></svg>
                      </button>
                      <button
                        class="action-btn delete"
                        title="Delete"
                        onclick={(e) => { e.stopPropagation(); handleDelete([item.id]); }}
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 010-2h3a1 1 0 011-1h3a1 1 0 011 1h3a1 1 0 011 1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118z"/></svg>
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  .archive-root {
    min-height: 100vh;
    background: #0f0f1a;
    color: #e4e4ef;
    font-family: "Inter", system-ui, -apple-system, sans-serif;
  }

  /* Header */
  .header {
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(15, 15, 26, 0.85);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid rgba(99, 102, 241, 0.1);
  }
  .header-inner {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px 32px 16px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-icon { font-size: 22px; }
  .logo-text {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #e4e4ef, #a78bfa);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .stats-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    padding-left: 32px;
  }
  .stat { font-size: 12px; color: #9999b0; }
  .stat-sep { font-size: 10px; color: #3b3b52; }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-restore {
    background: rgba(74, 222, 128, 0.1);
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.2);
  }
  .btn-restore:hover { background: rgba(74, 222, 128, 0.2); }
  .btn-delete {
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.2);
  }
  .btn-delete:hover { background: rgba(248, 113, 113, 0.2); }
  .btn-ghost {
    background: transparent;
    color: #9999b0;
    border-color: #3b3b52;
  }
  .btn-ghost:hover { background: rgba(255,255,255,0.04); color: #e4e4ef; }

  /* Search */
  .search-bar {
    position: sticky;
    top: 72px;
    z-index: 15;
    background: rgba(15, 15, 26, 0.9);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(59, 59, 82, 0.3);
  }
  .search-inner {
    max-width: 800px;
    margin: 0 auto;
    padding: 12px 32px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .search-input-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-icon {
    position: absolute;
    left: 12px;
    width: 16px;
    height: 16px;
    color: #9999b0;
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    padding: 10px 36px 10px 38px;
    border-radius: 10px;
    border: 1px solid #3b3b52;
    background: #1e1e2e;
    color: #e4e4ef;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .search-input::placeholder { color: #66668a; }
  .search-input:focus { border-color: #6366f1; }
  .search-clear {
    position: absolute;
    right: 10px;
    background: none;
    border: none;
    color: #9999b0;
    cursor: pointer;
    font-size: 12px;
    padding: 4px;
  }
  .search-clear:hover { color: #e4e4ef; }
  .search-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .link-btn {
    background: none;
    border: none;
    color: #6366f1;
    cursor: pointer;
    font-size: 12px;
    padding: 2px;
    transition: color 0.15s;
  }
  .link-btn:hover { color: #818cf8; }
  .search-count {
    font-size: 11px;
    color: #9999b0;
    padding-left: 4px;
  }

  /* Toast */
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    padding: 10px 20px;
    border-radius: 10px;
    background: rgba(74, 222, 128, 0.15);
    border: 1px solid rgba(74, 222, 128, 0.3);
    color: #4ade80;
    font-size: 13px;
    font-weight: 500;
    backdrop-filter: blur(8px);
    animation: fadeIn 0.2s ease-out;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(8px); } }

  /* Content */
  .content {
    max-width: 800px;
    margin: 0 auto;
    padding: 8px 32px 48px;
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 24px;
    text-align: center;
  }
  .empty-icon { margin-bottom: 24px; }
  .empty-svg { width: 80px; height: 80px; color: #6366f1; }
  .empty-title {
    font-size: 18px;
    font-weight: 600;
    color: #e4e4ef;
    margin: 0 0 8px;
  }
  .empty-desc {
    font-size: 13px;
    color: #9999b0;
    margin: 0 0 32px;
  }
  .empty-hints {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-radius: 10px;
    background: #1e1e2e;
    border: 1px solid #3b3b52;
  }
  .hint-key {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 12px;
    font-weight: 600;
    color: #a78bfa;
    padding: 2px 8px;
    border-radius: 5px;
    background: rgba(167, 139, 250, 0.1);
    white-space: nowrap;
  }
  .hint-desc { font-size: 12px; color: #9999b0; }
  .empty-icon-sm { font-size: 40px; margin-bottom: 12px; }
  .empty-title-sm { font-size: 15px; font-weight: 600; color: #e4e4ef; margin: 0 0 4px; }

  /* Date groups */
  .groups { display: flex; flex-direction: column; gap: 4px; }
  .date-group { margin-top: 8px; }
  .date-header {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    text-align: left;
  }
  .date-chevron {
    font-size: 12px;
    color: #9999b0;
    transition: transform 0.15s;
    width: 14px;
    text-align: center;
  }
  .date-chevron.collapsed { transform: rotate(-90deg); }
  .date-label {
    font-size: 12px;
    font-weight: 600;
    color: #e4e4ef;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .date-count {
    font-size: 11px;
    color: #66668a;
    font-weight: 400;
  }
  .date-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, #3b3b52, transparent);
  }
  .date-select-btn {
    background: none;
    border: none;
    color: #6366f1;
    font-size: 11px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: all 0.15s;
  }
  .date-select-btn:hover { background: rgba(99, 102, 241, 0.1); }

  /* Tab items */
  .tab-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: 4px;
  }
  .tab-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.12s;
  }
  .tab-item:hover {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(59, 59, 82, 0.5);
  }
  .tab-item.selected {
    background: rgba(99, 102, 241, 0.06);
    border-color: rgba(99, 102, 241, 0.25);
  }
  .tab-checkbox {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }
  .tab-checkbox input[type="checkbox"] {
    width: 15px;
    height: 15px;
    border-radius: 4px;
    accent-color: #6366f1;
    cursor: pointer;
  }
  .tab-favicon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tab-favicon img {
    width: 16px;
    height: 16px;
    border-radius: 3px;
  }
  .tab-info {
    flex: 1;
    min-width: 0;
  }
  .tab-title {
    font-size: 13px;
    color: #e4e4ef;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  .tab-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }
  .tab-domain {
    font-size: 11px;
    color: #66668a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab-time {
    font-size: 11px;
    color: #4a4a6a;
    flex-shrink: 0;
  }
  .tab-group-badge {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
    background: rgba(167, 139, 250, 0.1);
    color: #a78bfa;
    border: 1px solid rgba(167, 139, 250, 0.15);
    letter-spacing: 0.02em;
  }

  /* Action buttons */
  .tab-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .tab-item:hover .tab-actions { opacity: 1; }
  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    background: transparent;
    transition: all 0.12s;
  }
  .action-btn svg { width: 14px; height: 14px; }
  .action-btn.restore { color: #4ade80; }
  .action-btn.restore:hover { background: rgba(74, 222, 128, 0.1); }
  .action-btn.delete { color: #f87171; }
  .action-btn.delete:hover { background: rgba(248, 113, 113, 0.1); }

  @media (max-width: 640px) {
    .header-inner, .search-inner, .content { padding-left: 16px; padding-right: 16px; }
    .header-actions { flex-wrap: wrap; }
  }
</style>
