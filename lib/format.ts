// Display helpers shared by the popup's panels.

/**
 * The dot for a Chrome tab-group colour. Every class is spelled out in full because Tailwind
 * only generates classes it finds written in the source; one built from the colour name
 * would never reach the CSS.
 */
export const groupDotClass: Record<string, string> = {
  blue: "bg-accent-blue", cyan: "bg-accent-cyan", green: "bg-accent-green",
  yellow: "bg-accent-yellow", orange: "bg-accent-orange", pink: "bg-accent-pink",
  purple: "bg-accent-purple", red: "bg-accent-red", grey: "bg-border",
};

/** "just now", "5m ago", then the clock time once it is an hour or more old. */
export function relTime(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
