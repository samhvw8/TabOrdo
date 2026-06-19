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
    onclick: (e: MouseEvent) => void;
    variant?: "default" | "danger";
    disabled?: boolean;
    tooltip?: string;
  } = $props();

  let btnEl = $state<HTMLButtonElement | undefined>(undefined);
  let show = $state(false);
  let tx = $state(0);
  let ty = $state(0);
  let below = $state(true);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const MARGIN = 6;
  const HALF_WIDTH = 90; // half of max-w-[180px]

  function showTip() {
    if (!tooltip || !btnEl) return;
    timer = setTimeout(() => {
      if (!btnEl) return;
      const r = btnEl.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      tx = Math.max(MARGIN + HALF_WIDTH, Math.min(window.innerWidth - MARGIN - HALF_WIDTH, cx));
      below = window.innerHeight - r.bottom > 70;
      ty = below ? r.bottom + 4 : r.top - 4;
      show = true;
    }, 300);
  }

  function hideTip() {
    clearTimeout(timer);
    show = false;
  }
</script>

<div class="relative">
  <button
    bind:this={btnEl}
    {onclick}
    {disabled}
    aria-label={tooltip}
    onmouseenter={showTip}
    onmouseleave={hideTip}
    onfocus={showTip}
    onblur={hideTip}
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
</div>
{#if tooltip && show}
  <span
    role="tooltip"
    class="pointer-events-none fixed z-50 -translate-x-1/2 {below ? '' : '-translate-y-full'}
      px-2 py-1 rounded-md bg-text text-surface text-[10px] leading-tight
      whitespace-normal w-max max-w-[180px] text-center shadow-lg"
    style="left: {tx}px; top: {ty}px;"
  >{tooltip}</span>
{/if}
