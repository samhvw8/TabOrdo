<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Renders its rows only while they are near the viewport; off-screen it stands in as an
   * empty box of the same height, so scrolling and the scrollbar behave as if everything
   * were there.
   *
   * The dashboard mounted a TabCard for every tab in every window on each popup open —
   * 11,700 DOM nodes and ~190 ms at 1000 tabs, for a 600 px sheet that shows twelve rows.
   * Chunks of rows wrapped in this component bring that down to the rows around the
   * viewport, and the IntersectionObserver swaps chunks in and out as the user scrolls.
   *
   * No spacer arithmetic: the browser lays out real content while a chunk is shown, and the
   * height it had is remembered for the placeholder when it scrolls away, so the estimate is
   * only ever used for a chunk that has never been on screen. The estimate is re-armed when
   * `rows` changes, as the remembered height then belongs to a different list.
   *
   * First paint must not flash empty boxes. IntersectionObserver delivers its first result
   * only after the frame is painted, so on mount the chunk checks its own position
   * synchronously instead — Svelte runs this effect before the browser paints — and shows
   * itself at once if it is within reach. One layout read per chunk, all against the same
   * layout since no DOM is written in between.
   *
   * The observer's root is the nearest scrolling ancestor, found once on mount, not the
   * viewport. rootMargin only widens the root's own rectangle; a target clipped by a scroll
   * container in between still counts as not intersecting, so with the viewport as root
   * every chunk scrolled out of the list was torn down the moment it left the visible strip,
   * margin or no margin.
   */
  let {
    rows,
    rowPx = 42,
    children,
  }: {
    /** How many rows the children render — sizes the placeholder before a first showing. */
    rows: number;
    /** Estimated height of one row including its gap, in CSS px. */
    rowPx?: number;
    children: Snippet;
  } = $props();

  /** How far beyond the viewport a chunk counts as "near", both for mount and for scrolling. */
  const REACH_PX = 600;

  let el = $state<HTMLDivElement>();
  let shown = $state(false);
  // The height this chunk had when it last scrolled away, and the `rows` it had then.
  let remembered = $state<{ height: number; rows: number } | null>(null);

  let placeholderPx = $derived(
    remembered && remembered.rows === rows ? remembered.height : Math.max(1, rows * rowPx)
  );

  function scrollParent(node: HTMLElement): HTMLElement | null {
    for (let p = node.parentElement; p; p = p.parentElement) {
      const overflowY = getComputedStyle(p).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return p;
    }
    return null;
  }

  $effect(() => {
    if (!el) return;
    const root = scrollParent(el);
    const rect = el.getBoundingClientRect();
    const view = root ? root.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    if (rect.bottom >= view.top - REACH_PX && rect.top <= view.bottom + REACH_PX) shown = true;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          shown = true;
        } else if (shown) {
          remembered = { height: entry.boundingClientRect.height, rows };
          shown = false;
        }
      },
      { root, rootMargin: `${REACH_PX}px 0px` }
    );
    observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<div bind:this={el} class="grid gap-0.5" style={shown ? undefined : `height:${placeholderPx}px`}>
  {#if shown}
    {@render children()}
  {/if}
</div>
