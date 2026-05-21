<script lang="ts">
  import { onMount } from "svelte";
  import { getArchive, restoreFromArchive, deleteFromArchive, clearArchive, type ArchivedTab } from "../../lib/archive.ts";

  let archive = $state<ArchivedTab[]>([]);
  let searchQuery = $state("");
  let selectedIds = $state<Set<string>>(new Set());
  let statusMessage = $state("");

  let filtered = $derived.by(() => {
    if (!searchQuery.trim()) return archive;
    const q = searchQuery.toLowerCase();
    return archive.filter((a) => a.title.toLowerCase().includes(q) || a.url.toLowerCase().includes(q));
  });

  interface DateGroup {
    label: string;
    items: ArchivedTab[];
  }

  let grouped = $derived.by<DateGroup[]>(() => {
    const items = filtered;
    const map = new Map<string, ArchivedTab[]>();
    for (const item of items) {
      const d = new Date(item.archivedAt);
      const label = d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(item);
    }
    return [...map.entries()]
      .sort((a, b) => b[1][0].archivedAt - a[1][0].archivedAt)
      .map(([label, items]) => ({ label, items: items.sort((a, b) => b.archivedAt - a.archivedAt) }));
  });

  async function reload() {
    archive = await getArchive();
    selectedIds = new Set();
  }

  async function handleRestore(ids: string[]) {
    const count = await restoreFromArchive(ids);
    statusMessage = `Restored ${count} tab(s)`;
    await reload();
    setTimeout(() => { statusMessage = ""; }, 3000);
  }

  async function handleDelete(ids: string[]) {
    await deleteFromArchive(ids);
    statusMessage = `Deleted ${ids.length} item(s)`;
    await reload();
    setTimeout(() => { statusMessage = ""; }, 3000);
  }

  async function handleClear() {
    if (!confirm("Clear entire archive? This cannot be undone.")) return;
    await clearArchive();
    statusMessage = "Archive cleared";
    await reload();
    setTimeout(() => { statusMessage = ""; }, 3000);
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  function selectAll() {
    selectedIds = new Set(filtered.map((a) => a.id));
  }

  function selectNone() {
    selectedIds = new Set();
  }

  function faviconUrl(item: ArchivedTab): string {
    if (item.favIconUrl && !item.favIconUrl.startsWith("chrome://")) return item.favIconUrl;
    try {
      const u = new URL(item.url);
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=16`;
    } catch {
      return "";
    }
  }

  onMount(() => { reload(); });
</script>

<div class="min-h-screen bg-surface text-text">
  <div class="max-w-3xl mx-auto px-6 py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-text flex items-center gap-2">
          <span>📦</span> TabOrdo Archive
        </h1>
        <p class="text-sm text-text-muted mt-1">{archive.length} saved tab{archive.length !== 1 ? "s" : ""}</p>
      </div>
      <div class="flex items-center gap-2">
        {#if selectedIds.size > 0}
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-green/10 text-accent-green border border-accent-green/30 hover:bg-accent-green/20 transition-colors"
            onclick={() => handleRestore([...selectedIds])}
          >Restore {selectedIds.size}</button>
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-red/10 text-accent-red border border-accent-red/30 hover:bg-accent-red/20 transition-colors"
            onclick={() => handleDelete([...selectedIds])}
          >Delete {selectedIds.size}</button>
        {/if}
        {#if archive.length > 0}
          <button
            class="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-hover text-text-muted border border-border hover:bg-surface-active transition-colors"
            onclick={handleClear}
          >Clear All</button>
        {/if}
      </div>
    </div>

    <div class="mb-4 flex items-center gap-3">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search archive..."
        class="flex-1 px-3 py-2 rounded-lg bg-surface-hover border border-border text-sm text-text placeholder-text-muted focus:outline-none focus:border-primary"
      />
      <button onclick={selectAll} class="text-xs text-primary hover:text-primary-hover transition-colors">All</button>
      <button onclick={selectNone} class="text-xs text-text-muted hover:text-text transition-colors">None</button>
    </div>

    {#if statusMessage}
      <div class="mb-4 px-3 py-2 rounded-lg bg-accent-green/10 text-accent-green text-sm">{statusMessage}</div>
    {/if}

    {#if archive.length === 0}
      <div class="text-center py-16 text-text-muted">
        <div class="text-4xl mb-3">📦</div>
        <p class="text-sm">Archive is empty</p>
        <p class="text-xs mt-1">Use /archive or the Archive button in the popup to save tabs here</p>
      </div>
    {:else if filtered.length === 0}
      <div class="text-center py-8 text-text-muted text-sm">No results for "{searchQuery}"</div>
    {:else}
      {#each grouped as group}
        <div class="mb-6">
          <div class="flex items-center gap-3 mb-2">
            <span class="text-xs font-semibold text-text-muted uppercase tracking-wider">{group.label}</span>
            <div class="flex-1 h-px bg-border/50"></div>
            <span class="text-xs text-text-muted">{group.items.length}</span>
          </div>
          <div class="grid gap-1">
            {#each group.items as item}
              {@const isSelected = selectedIds.has(item.id)}
              <div
                class="flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors cursor-pointer
                  {isSelected ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-surface-hover'}"
                role="button" tabindex="0"
                onclick={() => toggleSelect(item.id)}
                onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSelect(item.id); } }}
              >
                <input type="checkbox" checked={isSelected}
                  class="shrink-0 w-3.5 h-3.5 rounded accent-primary" />
                <img src={faviconUrl(item)} alt="" class="w-4 h-4 shrink-0" onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <div class="flex-1 min-w-0">
                  <div class="text-sm text-text truncate">{item.title}</div>
                  <div class="text-xs text-text-muted truncate">{item.url}</div>
                </div>
                {#if item.groupName}
                  <span class="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-accent-purple/10 text-accent-purple">{item.groupName}</span>
                {/if}
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    class="px-2 py-1 rounded text-xs text-accent-green hover:bg-accent-green/10 transition-colors"
                    onclick={(e) => { e.stopPropagation(); handleRestore([item.id]); }}
                  >Restore</button>
                  <button
                    class="px-2 py-1 rounded text-xs text-accent-red hover:bg-accent-red/10 transition-colors"
                    onclick={(e) => { e.stopPropagation(); handleDelete([item.id]); }}
                  >Delete</button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
