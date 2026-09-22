// Display helpers shared by the popup's panels.

/**
 * Classes for a Chrome tab-group colour: its dot, and the dashboard block's border and tint.
 * Every class is spelled out in full because Tailwind only generates classes it finds written
 * in the source; one built from the colour name would never reach the CSS.
 */
export const groupDotClass: Record<string, string> = {
  blue: "bg-accent-blue", cyan: "bg-accent-cyan", green: "bg-accent-green",
  yellow: "bg-accent-yellow", orange: "bg-accent-orange", pink: "bg-accent-pink",
  purple: "bg-accent-purple", red: "bg-accent-red", grey: "bg-border",
};

export const groupBorderClass: Record<string, string> = {
  blue: "border-accent-blue/40", cyan: "border-accent-cyan/40", green: "border-accent-green/40",
  yellow: "border-accent-yellow/40", orange: "border-accent-orange/40", pink: "border-accent-pink/40",
  purple: "border-accent-purple/40", red: "border-accent-red/40", grey: "border-border",
};

export const groupBgClass: Record<string, string> = {
  blue: "bg-accent-blue/5", cyan: "bg-accent-cyan/5", green: "bg-accent-green/5",
  yellow: "bg-accent-yellow/5", orange: "bg-accent-orange/5", pink: "bg-accent-pink/5",
  purple: "bg-accent-purple/5", red: "bg-accent-red/5", grey: "bg-surface-hover",
};

/** "just now", "5m ago", then the clock time once it is an hour or more old. */
export function relTime(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
