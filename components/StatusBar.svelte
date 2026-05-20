<script lang="ts">
  let {
    tabCount = 0,
    message = "",
  }: {
    tabCount: number;
    message?: string;
  } = $props();
</script>

<div class="flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-text-muted">
  <span>{tabCount} tab{tabCount !== 1 ? "s" : ""}</span>
  {#if message}
    <span class="text-accent-green">{message}</span>
  {:else}
    <span>
      <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px]">↑↓</kbd> navigate
      <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px] ml-1">↵</kbd> open
      <kbd class="px-1 py-0.5 rounded bg-surface-hover text-[10px] ml-1">Ctrl+Del</kbd> close
    </span>
  {/if}
</div>
