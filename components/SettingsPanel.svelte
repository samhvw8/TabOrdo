<script lang="ts">
  import { onMount } from "svelte";
  import { getUseAI, setUseAI } from "../lib/rules.ts";
  import { getAIStatus, getChromeVersion, MIN_CHROME_VERSION, type AIStatus } from "../lib/ai.ts";

  let useAI = $state(false);
  let aiStatus = $state<AIStatus>("unsupported");
  let aiStatusReason = $state<string | undefined>(undefined);
  let busy = $state(false);

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
  });

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

  <!-- Placeholder for future settings -->
  <div class="text-[10px] text-text-muted text-center py-3 border-t border-border">
    More settings coming here.
  </div>
</div>
