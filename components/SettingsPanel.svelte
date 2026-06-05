<script lang="ts">
  import { onMount } from "svelte";
  import { getUseAI, setUseAI, getIgnorePatterns, setIgnorePatterns, getIgnoreGroupNames, setIgnoreGroupNames, type IgnoreRule } from "../lib/rules.ts";
  import { getAIStatus, getChromeVersion, MIN_CHROME_VERSION, type AIStatus } from "../lib/ai.ts";

  let useAI = $state(false);
  let aiStatus = $state<AIStatus>("unsupported");
  let aiStatusReason = $state<string | undefined>(undefined);
  let busy = $state(false);

  let ignorePatterns = $state<IgnoreRule[]>([]);
  let ignoreGroupNames = $state<IgnoreRule[]>([]);
  let newIgnorePattern = $state("");
  let newIgnoreGroupName = $state("");

  const statusDot: Record<AIStatus, string> = {
    available: "bg-accent-green",
    downloadable: "bg-accent-yellow",
    downloading: "bg-accent-yellow animate-pulse",
    unavailable: "bg-accent-red",
    unsupported: "bg-accent-red",
  };
  const statusLabel: Record<AIStatus, string> = {
    available: "Gemini Nano ready",
    downloadable: "Model not downloaded yet",
    downloading: "Downloading model…",
    unavailable: "Unavailable on this device",
    unsupported: "Not supported in this browser",
  };

  const canEnable = $derived(aiStatus !== "unsupported");

  async function refreshStatus() {
    const r = await getAIStatus();
    aiStatus = r.status;
    aiStatusReason = r.reason;
  }

  onMount(async () => {
    useAI = await getUseAI();
    await refreshStatus();
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

  async function toggleAI() {
    if (!canEnable && !useAI) return;
    busy = true;
    try {
      useAI = !useAI;
      await setUseAI(useAI);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
  <div class="text-xs font-semibold text-text mb-2">Settings</div>

  <!-- AI section -->
  <div class="mb-3">
    <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">AI</div>

    <div class="p-2 rounded-md bg-surface-hover border border-border">
      <div class="flex items-center justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="text-xs text-text font-medium">On-device AI suggestions</div>
          <div class="text-[10px] text-text-muted mt-0.5">
            Use Chrome's built-in Gemini Nano to suggest group rules from your open tabs.
          </div>
        </div>
        <button
          class="shrink-0 w-9 h-5 rounded-full transition-colors relative
            {useAI ? 'bg-primary' : 'bg-border'}
            {!canEnable && !useAI ? 'opacity-40 cursor-not-allowed' : ''}"
          onclick={toggleAI}
          disabled={busy || (!canEnable && !useAI)}
          title={useAI ? "Disable AI" : (canEnable ? "Enable AI" : "AI not supported on this device")}
          aria-label="Toggle AI suggestions"
          aria-pressed={useAI}
        >
          <span class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform {useAI ? 'left-[18px]' : 'left-0.5'}"></span>
        </button>
      </div>

      <div class="flex items-center gap-2 mt-2 pt-2 border-t border-border/60">
        <span class="w-2 h-2 rounded-full {statusDot[aiStatus]}"></span>
        <span class="text-[10px] text-text-muted flex-1 truncate">{statusLabel[aiStatus]}</span>
        <button
          class="text-[10px] text-text-muted hover:text-text transition-colors"
          onclick={refreshStatus}
        >Re-check</button>
      </div>
      {#if aiStatusReason}
        <div class="text-[10px] text-text-muted mt-1">{aiStatusReason}</div>
      {/if}
      {#if aiStatus === "unsupported"}
        <div class="text-[10px] text-text-muted mt-1">
          Needs Chrome {MIN_CHROME_VERSION}+ (you have {getChromeVersion() || "unknown"}),
          on macOS 13+/Win 10+/Linux, ≥22 GB free disk, and 4 GB+ VRAM or 16 GB RAM.
        </div>
      {:else if aiStatus === "downloadable"}
        <div class="text-[10px] text-text-muted mt-1">
          First "Suggest" click downloads Gemini Nano (~2 GB) in the background.
        </div>
      {/if}
    </div>

    {#if useAI}
      <div class="text-[10px] text-text-muted mt-1.5 px-1">
        Open the <span class="text-text">Group Rules</span> tab to generate suggestions.
      </div>
    {/if}
  </div>

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
