<script lang="ts">
  let {
    label,
    icon,
    onclick,
    variant = "default",
    disabled = false,
    tooltip = "",
  }: {
    label: string;
    icon: string;
    onclick: () => void;
    variant?: "default" | "danger";
    disabled?: boolean;
    tooltip?: string;
  } = $props();
</script>

<div class="relative group">
  <button
    {onclick}
    {disabled}
    aria-label={tooltip}
    class="w-full flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border transition-all text-sm
      {disabled ? 'opacity-40 cursor-not-allowed border-border bg-surface' :
       variant === 'danger'
        ? 'border-accent-red/30 bg-accent-red/5 hover:bg-accent-red/10 hover:border-accent-red/50 text-accent-red'
        : 'border-border bg-surface-hover hover:bg-surface-active hover:border-text-muted/30 text-text'
      }"
  >
    <span class="text-base">{icon}</span>
    <span class="text-xs">{label}</span>
  </button>
  {#if tooltip}
    <span
      role="tooltip"
      class="pointer-events-none absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1
        px-2 py-1 rounded-md bg-text text-surface text-[10px] leading-tight
        whitespace-normal w-max max-w-[180px] text-center shadow-lg
        opacity-0 group-hover:opacity-100 transition-opacity duration-100 delay-300"
    >{tooltip}</span>
  {/if}
</div>
