import { describe, it, expect } from "vitest";
import { findBounceTarget, isBounceEligibleUrl } from "./bounce.ts";

const tabs = [
  { id: 1, url: "https://a.com/doc", windowId: 10, lastAccessed: 100 },
  { id: 2, url: "https://b.com", windowId: 10, lastAccessed: 200 },
  { id: 3, url: "https://a.com/doc", windowId: 20, lastAccessed: 300 },
  { id: 99, url: "https://a.com/doc", windowId: 10, lastAccessed: 999 }, // the new duplicate itself
];

describe("isBounceEligibleUrl", () => {
  it("accepts http(s) only", () => {
    expect(isBounceEligibleUrl("https://a.com")).toBe(true);
    expect(isBounceEligibleUrl("http://a.com")).toBe(true);
    expect(isBounceEligibleUrl("chrome://newtab/")).toBe(false);
    expect(isBounceEligibleUrl("about:blank")).toBe(false);
    expect(isBounceEligibleUrl("file:///tmp/x.html")).toBe(false);
  });
});

describe("findBounceTarget", () => {
  it("finds the existing tab with the same URL, excluding the new tab itself", () => {
    const target = findBounceTarget(tabs, 99, "https://a.com/doc");
    expect(target).toEqual({ id: 3, windowId: 20 });
  });

  it("prefers the most recently accessed match", () => {
    const target = findBounceTarget(tabs, 99, "https://a.com/doc");
    expect(target?.id).toBe(3); // lastAccessed 300 beats 100
  });

  it("returns null when no other tab has the URL", () => {
    expect(findBounceTarget(tabs, 99, "https://c.com")).toBeNull();
  });

  it("returns null for non-http URLs", () => {
    expect(findBounceTarget(tabs, 99, "chrome://settings")).toBeNull();
  });

  it("skips intentional duplicates of the opener tab", () => {
    // Chrome's "Duplicate Tab": new tab's URL equals its opener's URL
    expect(findBounceTarget(tabs, 99, "https://a.com/doc", 1)).toBeNull();
  });

  it("still bounces when the opener has a different URL (link click)", () => {
    const target = findBounceTarget(tabs, 99, "https://a.com/doc", 2);
    expect(target).toEqual({ id: 3, windowId: 20 });
  });
});
