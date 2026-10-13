import { describe, it, expect } from "vitest";
import { summarizeOpen, formatOpenTiming } from "./opentiming.ts";

describe("summarizeOpen", () => {
  const nav = { responseEnd: 12, domInteractive: 40 };

  it("orders the steps and measures each from the one before", () => {
    const t = summarizeOpen(nav, { script: 45, load: 60, mounted: 90, ready: 150, painted: 170 }, []);
    expect(t.steps.map((s) => [s.label, s.at, s.delta])).toEqual([
      ["page fetched", 12, 12],
      ["HTML parsed", 40, 28],
      ["script started", 45, 5],
      ["load: popup shown", 60, 15],
      ["app mounted", 90, 30],
      ["tabs + settings read", 150, 60],
      ["first paint with tabs", 170, 20],
    ]);
    expect(t.totalMs).toBe(170);
  });

  it("leaves out steps not reached yet instead of showing them as zero", () => {
    const t = summarizeOpen(nav, { script: 30, load: 60 }, []);
    expect(t.steps.map((s) => s.label)).toEqual(["page fetched", "HTML parsed", "script started", "load: popup shown"]);
    expect(t.totalMs).toBe(60);
  });

  it("lists the files fetched before load, not the ones after", () => {
    const t = summarizeOpen(nav, { load: 900 }, [
      { name: "chrome-extension://abc/chunks/popup.js", startTime: 15, responseEnd: 22 },
      { name: "https://a.test/favicon.ico", startTime: 50, responseEnd: 850 },
      { name: "https://late.test/favicon.ico", startTime: 950, responseEnd: 2000 },
    ], "141");
    expect(t.beforeLoad).toEqual([
      { name: "chrome-extension://abc/chunks/popup.js", start: 15, ms: 7 },
      { name: "https://a.test/favicon.ico", start: 50, ms: 800 },
    ]);
    const text = formatOpenTiming(t);
    expect(text).toContain("    15 ms      7 ms  /chunks/popup.js");
    expect(text).toContain("   800 ms  https://a.test/favicon.ico");
    expect(text).toContain("Chrome 141");
  });

  it("copes with no navigation entry", () => {
    const t = summarizeOpen(undefined, { load: 5 }, []);
    expect(t.steps).toEqual([{ label: "load: popup shown", at: 5, delta: 5 }]);
  });
});
