<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "Search...",
    onkeydown,
    oninput,
  }: {
    value: string;
    placeholder?: string;
    onkeydown?: (e: KeyboardEvent) => void;
    oninput?: () => void;
  } = $props();

  let inputEl: HTMLInputElement;

  $effect(() => {
    inputEl?.focus();
  });
</script>

<div class="relative">
  <svg
    class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
  <input
    bind:this={inputEl}
    bind:value
    {placeholder}
    {onkeydown}
    oninput={() => oninput?.()}
    type="text"
    class="w-full pl-8 pr-3 py-2 bg-surface-hover border border-border rounded-lg text-text placeholder:text-text-muted text-sm outline-none focus:border-primary transition-colors"
    spellcheck="false"
    autocomplete="off"
  />
</div>
