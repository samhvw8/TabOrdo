// Scrolling helpers shared by the popup's lists.

/** The nearest ancestor that scrolls vertically, or null for the viewport. */
export function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let p = node.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

/**
 * Svelte action: keep this row visible while `active`. It asks an IntersectionObserver rather
 * than calling scrollIntoView outright. The list re-renders on every keystroke, and calling
 * scrollIntoView on the selected row forced a full layout in the middle of each update — the
 * largest single cost of typing at 1000 tabs (353 ms of 2.76 s busy at 4x CPU throttle) —
 * for a row that was nearly always row 0, already on screen. The observer answers after the
 * browser's own layout, and the list only scrolls when the row is actually cut off.
 */
export function keepVisible(node: HTMLElement, active: boolean) {
  let observer: IntersectionObserver | null = null;
  const stop = () => {
    observer?.disconnect();
    observer = null;
  };
  const watch = (on: boolean) => {
    stop();
    if (!on) return;
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 1) node.scrollIntoView({ block: "nearest" });
        stop();
      },
      { root: scrollParent(node), threshold: 1 }
    );
    observer.observe(node);
  };
  watch(active);
  return { update: watch, destroy: stop };
}
