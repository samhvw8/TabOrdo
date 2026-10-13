// Where the palette's open time goes. Chrome keeps the popup hidden until the page's `load`
// event (ExtensionPopup::DocumentOnLoadCompletedInPrimaryMainFrame), so a slow open is either
// Chrome starting the page, our page reaching `load`, or our app reading the tabs after it.
// Each open is broken into those steps, logged, and shown in the popup when it was slow.

// entrypoints/popup/main.ts writes its marks by hand with this same prefix: importing this
// module there would add a file fetch before `load`, the stretch this exists to measure.
const PREFIX = "tabordo:";

/** An open slower than this to its first useful paint shows its breakdown in the popup. */
export const SLOW_OPEN_MS = 400;

/** The points main.ts and App.svelte mark, in the order an open passes them. */
export type OpenMark = "script" | "load" | "mounted" | "ready" | "painted";

export function markOpen(name: OpenMark): void {
  performance.mark(PREFIX + name);
}

export interface OpenStep {
  label: string;
  /** Milliseconds since Chrome started loading the popup page. */
  at: number;
  /** Milliseconds since the step before. */
  delta: number;
}

export interface OpenTiming {
  /** Milliseconds from page start to the first paint with the tab list, or to the last step seen. */
  totalMs: number;
  steps: OpenStep[];
  /** Every file fetched before `load`, which held the popup hidden: when it started, how long
   *  it took. Short fetches beside a long wait mean the page was waiting, not downloading. */
  beforeLoad: { name: string; start: number; ms: number }[];
  /** Chrome's major version, when known: the popup's start-up priority changed across versions. */
  chrome?: string;
}

interface NavTiming {
  responseEnd: number;
  domInteractive: number;
}

interface ResourceTiming {
  name: string;
  startTime: number;
  responseEnd: number;
}

const STEPS: [label: string, key: "responseEnd" | "domInteractive" | OpenMark][] = [
  ["page fetched", "responseEnd"],
  // A module script runs only after the HTML is parsed, so parsing comes first.
  ["HTML parsed", "domInteractive"],
  ["script started", "script"],
  ["load: popup shown", "load"],
  ["app mounted", "mounted"],
  ["tabs + settings read", "ready"],
  ["first paint with tabs", "painted"],
];

/** Pure: turn the navigation entry, our marks and the resource entries into steps. */
export function summarizeOpen(
  nav: NavTiming | undefined,
  marks: Partial<Record<OpenMark, number>>,
  resources: ResourceTiming[],
  chrome?: string
): OpenTiming {
  const steps: OpenStep[] = [];
  let prev = 0;
  for (const [label, key] of STEPS) {
    const at = key === "responseEnd" || key === "domInteractive" ? nav?.[key] : marks[key];
    // An absent mark (the open is still going, or the entry is missing) is left out rather
    // than shown as zero, which would read as "instant".
    if (at === undefined || at <= 0) continue;
    steps.push({ label, at: Math.round(at), delta: Math.round(at - prev) });
    prev = at;
  }
  const load = marks.load;
  const beforeLoad = load === undefined ? [] : resources
    .filter((r) => r.responseEnd <= load)
    .map((r) => ({ name: r.name, start: Math.round(r.startTime), ms: Math.round(r.responseEnd - r.startTime) }));
  return { totalMs: Math.round(prev), steps, beforeLoad, chrome };
}

/** Read this page's timing from the Performance API. */
export function readOpenTiming(): OpenTiming {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const marks: Partial<Record<OpenMark, number>> = {};
  for (const m of performance.getEntriesByType("mark")) {
    if (m.name.startsWith(PREFIX)) marks[m.name.slice(PREFIX.length) as OpenMark] = m.startTime;
  }
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  return summarizeOpen(nav, marks, resources, navigator.userAgent.match(/Chrome\/(\d+)/)?.[1]);
}

export function formatOpenTiming(t: OpenTiming): string {
  const lines = t.steps.map((s) => `${String(s.at).padStart(6)} ms  +${String(s.delta).padStart(5)}  ${s.label}`);
  if (t.beforeLoad.length) lines.push("fetched before load:");
  for (const r of t.beforeLoad) lines.push(`${String(r.start).padStart(6)} ms  ${String(r.ms).padStart(5)} ms  ${shortName(r.name)}`);
  if (t.chrome) lines.push(`Chrome ${t.chrome}`);
  return lines.join("\n");
}

/** The extension's own files by path; anything else by its full URL. */
function shortName(url: string): string {
  return url.startsWith("chrome-extension://") ? url.replace(/^chrome-extension:\/\/[^/]+/, "") : url;
}
