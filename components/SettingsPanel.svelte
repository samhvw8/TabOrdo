<script lang="ts">
  import { onMount } from "svelte";
  import { getIgnorePatterns, setIgnorePatterns, getIgnoreGroupNames, setIgnoreGroupNames, type IgnoreRule } from "../lib/rules.ts";

  let ignorePatterns = $state<IgnoreRule[]>([]);
  let ignoreGroupNames = $state<IgnoreRule[]>([]);
  let newIgnorePattern = $state("");
  let newIgnoreGroupName = $state("");

  onMount(async () => {
    ignorePatterns = await getIgnorePatterns();
    ignoreGroupNames = await getIgnoreGroupNames();
  });

  async function addIgnorePattern() {
    const v = newIgnorePattern.trim();
    if (!v || ignorePatterns.some((r) => r.pattern === v)) return;
    ignorePatterns = [...ignorePatterns, { pattern: v, enabled: true }];
    newIgnorePattern = "";
    await setIgnorePatterns(ignorePatterns);
  }

  async function removeIgnorePattern(p: string) {
    ignorePatterns = ignorePatterns.filter((r) => r.pattern !== p);
    await setIgnorePatterns(ignorePatterns);
  }

  async function toggleIgnorePattern(p: string) {
    ignorePatterns = ignorePatterns.map((r) => r.pattern === p ? { ...r, enabled: !r.enabled } : r);
    await setIgnorePatterns(ignorePatterns);
  }

  async function addIgnoreGroupName() {
    const v = newIgnoreGroupName.trim();
    if (!v || ignoreGroupNames.some((r) => r.pattern === v)) return;
    ignoreGroupNames = [...ignoreGroupNames, { pattern: v, enabled: true }];
    newIgnoreGroupName = "";
    await setIgnoreGroupNames(ignoreGroupNames);
  }

  async function removeIgnoreGroupName(p: string) {
    ignoreGroupNames = ignoreGroupNames.filter((r) => r.pattern !== p);
    await setIgnoreGroupNames(ignoreGroupNames);
  }

  async function toggleIgnoreGroupName(p: string) {
    ignoreGroupNames = ignoreGroupNames.map((r) => r.pattern === p ? { ...r, enabled: !r.enabled } : r);
    await setIgnoreGroupNames(ignoreGroupNames);
  }
</script>

<div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
  <div class="text-xs font-semibold text-text mb-2">Settings</div>

  <!-- Ignore Lists -->
  <div class="mb-3">
    <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Ignore Lists</div>

    <!-- Ignore URL patterns -->
    <div class="p-2 rounded-md bg-surface-hover border border-border mb-2">
      <div class="text-xs text-text font-medium mb-1">Ignored URL patterns</div>
      <div class="text-[10px] text-text-muted mb-1.5">
        Tabs matching these won't be auto-grouped. Wildcards supported (e.g. <code class="px-0.5 bg-surface rounded">localhost:*</code>).
      </div>
      <div class="flex gap-1 mb-1">
        <input
          type="text"
          class="flex-1 min-w-0 px-1.5 py-1 rounded border border-border bg-surface text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
          placeholder="e.g. localhost:5763"
          bind:value={newIgnorePattern}
          onkeydown={(e) => { if (e.key === "Enter") addIgnorePattern(); }}
        />
        <button
          class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-40"
          onclick={addIgnorePattern}
          disabled={!newIgnorePattern.trim()}
        >Add</button>
      </div>
      {#if ignorePatterns.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each ignorePatterns as rule}
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]
              {rule.enabled ? 'bg-surface border-border text-text' : 'bg-surface/50 border-border/50 text-text-muted line-through'}">
              <button class="w-2 h-2 rounded-full shrink-0 {rule.enabled ? 'bg-accent-green' : 'bg-border'}" onclick={() => toggleIgnorePattern(rule.pattern)} title={rule.enabled ? "Disable" : "Enable"}></button>
              {rule.pattern}
              <button class="text-text-muted hover:text-accent-red transition-colors" onclick={() => removeIgnorePattern(rule.pattern)} title="Remove">&times;</button>
            </span>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Ignore group names -->
    <div class="p-2 rounded-md bg-surface-hover border border-border">
      <div class="text-xs text-text font-medium mb-1">Ignored group names</div>
      <div class="text-[10px] text-text-muted mb-1.5">
        Groups matching these won't be auto-ungrouped. Wildcards supported (e.g. <code class="px-0.5 bg-surface rounded">*Claude*</code>).
      </div>
      <div class="flex gap-1 mb-1">
        <input
          type="text"
          class="flex-1 min-w-0 px-1.5 py-1 rounded border border-border bg-surface text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
          placeholder="e.g. *Claude* or claude"
          bind:value={newIgnoreGroupName}
          onkeydown={(e) => { if (e.key === "Enter") addIgnoreGroupName(); }}
        />
        <button
          class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-40"
          onclick={addIgnoreGroupName}
          disabled={!newIgnoreGroupName.trim()}
        >Add</button>
      </div>
      {#if ignoreGroupNames.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each ignoreGroupNames as rule}
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]
              {rule.enabled ? 'bg-surface border-border text-text' : 'bg-surface/50 border-border/50 text-text-muted line-through'}">
              <button class="w-2 h-2 rounded-full shrink-0 {rule.enabled ? 'bg-accent-green' : 'bg-border'}" onclick={() => toggleIgnoreGroupName(rule.pattern)} title={rule.enabled ? "Disable" : "Enable"}></button>
              {rule.pattern}
              <button class="text-text-muted hover:text-accent-red transition-colors" onclick={() => removeIgnoreGroupName(rule.pattern)} title="Remove">&times;</button>
            </span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
