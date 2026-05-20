<script lang="ts">
  let {
    label,
    icon,
    onclick,
    variant = "default",
    disabled = false,
  }: {
    label: string;
    icon: string;
    onclick: () => void;
    variant?: "default" | "danger";
    disabled?: boolean;
  } = $props();
</script>

<button
  {onclick}
  {disabled}
  class="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border transition-all text-sm
    {disabled ? 'opacity-40 cursor-not-allowed border-border bg-surface' :
     variant === 'danger'
      ? 'border-accent-red/30 bg-accent-red/5 hover:bg-accent-red/10 hover:border-accent-red/50 text-accent-red'
      : 'border-border bg-surface-hover hover:bg-surface-active hover:border-text-muted/30 text-text'
    }"
>
  <span class="text-base">{icon}</span>
  <span class="text-xs">{label}</span>
</button>
