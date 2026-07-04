<script lang="ts">
  let {
    label,
    icon,
    onclick,
    variant = "default",
    disabled = false,
    tooltip = "",
    confirming = false,
  }: {
    label: string;
    icon: string;
    onclick: (e: MouseEvent) => void;
    variant?: "default" | "danger";
    disabled?: boolean;
    tooltip?: string;
    confirming?: boolean;
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
    class="relative overflow-hidden w-full flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border transition-all text-sm
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface
      {confirming ? 'ring-2 ring-accent-red/60 border-accent-red/50' : ''}
      {disabled ? 'opacity-40 cursor-not-allowed border-border bg-surface' :
       variant === 'danger'
        ? 'border-accent-red/30 bg-accent-red/5 hover:bg-accent-red/10 hover:border-accent-red/50 active:scale-[0.97] text-accent-red'
        : 'border-border bg-surface-hover hover:bg-surface-active hover:border-text-muted/30 active:scale-[0.97] text-text'
      }"
  >
    <span class="text-text-muted">{@html icon}</span>
    <span class="text-xs {confirming ? 'text-accent-red font-medium' : ''}">{label}</span>
    {#if confirming}
      <span class="confirm-countdown absolute bottom-0 left-0 h-0.5 bg-accent-red/70"></span>
    {/if}
  </button>
</div>

<style>
  .confirm-countdown {
    width: 100%;
    animation: confirm-countdown 3s linear forwards;
  }
  @keyframes confirm-countdown {
    from { width: 100%; }
    to { width: 0%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .confirm-countdown { animation: none; }
  }
</style>
{#if tooltip && show}
  <span
    role="tooltip"
    class="pointer-events-none fixed z-50 -translate-x-1/2 {below ? '' : '-translate-y-full'}
      px-2 py-1 rounded-md bg-text text-surface text-[10px] leading-tight
      whitespace-normal w-max max-w-[180px] text-center"
    style="left: {tx}px; top: {ty}px; box-shadow: 0 8px 24px rgba(30, 30, 46, 0.6), 0 2px 8px rgba(30, 30, 46, 0.4);"
  >{tooltip}</span>
{/if}
