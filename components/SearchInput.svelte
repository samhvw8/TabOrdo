<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "Search...",
    autofocus = true,
    listboxId,
    expanded = false,
    activeDescendant,
    onkeydown,
    oninput,
    onfocuschange,
  }: {
    value: string;
    placeholder?: string;
    autofocus?: boolean;
    listboxId?: string;
    expanded?: boolean;
    activeDescendant?: string;
    onkeydown?: (e: KeyboardEvent) => void;
    oninput?: () => void;
    onfocuschange?: (focused: boolean) => void;
  } = $props();

  let inputEl: HTMLInputElement;
  let overlayEl = $state<HTMLDivElement | undefined>(undefined);

  $effect(() => {
    if (autofocus) inputEl?.focus();
  });

  // The command overlay is painted on top of a transparent-text input, so it only lines up
  // while both are scrolled to the same offset. The input scrolls itself once the query
  // outruns the box; the overlay clips instead, so it has to be told.
  function syncOverlayScroll() {
    if (overlayEl && inputEl) overlayEl.scrollLeft = inputEl.scrollLeft;
  }

  $effect(() => {
    // Reading `value` is the point: typing has to re-mirror after the overlay text updates,
    // not only when the input happens to fire a scroll event. Nothing to mirror when empty.
    if (value.length > 0) syncOverlayScroll();
  });

  let cmdPart = $derived((() => {
    const m = value.match(/^(\/\w+|@\w?)(\s.*)?$/);
    return m ? { cmd: m[1], rest: m[2] || "" } : null;
  })());
</script>

<div class="relative">
  <svg
    class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted z-10"
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
    onscroll={syncOverlayScroll}
    onfocus={() => onfocuschange?.(true)}
    onblur={() => onfocuschange?.(false)}
    type="text"
    role="combobox"
    aria-expanded={expanded}
    aria-controls={listboxId}
    aria-activedescendant={activeDescendant}
    aria-autocomplete="list"
    class="w-full pl-8 pr-3 py-2 border border-border rounded-lg placeholder:text-text-muted text-sm outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgba(99,102,241,0.1)] transition-all relative
      {cmdPart ? 'text-transparent caret-text bg-surface-hover' : 'text-text bg-surface-hover'}"
    spellcheck="false"
    autocomplete="off"
  />
  {#if cmdPart}
    <div
      bind:this={overlayEl}
      class="absolute inset-0 pl-8 pr-3 py-2 text-sm pointer-events-none overflow-hidden"
      style="white-space: pre; line-height: 1.4;"
      aria-hidden="true"
    ><span class="text-primary font-medium font-[family-name:var(--font-family-mono)]">{cmdPart.cmd}</span><span class="text-text">{cmdPart.rest}</span></div>
  {/if}
</div>
