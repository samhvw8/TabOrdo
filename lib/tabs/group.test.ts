import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { ungroupAll, collapseAllGroups, pickMajorityWindow, groupTabsByDomain, planDomainGroup, domainGroupPartners } from "./group.ts";
import { getDomainMapper, getGroupNameMapper } from "../url.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.currentWindowId = 1;
  stub.windows = [{ id: 1 }];
});

const tab = (t: Partial<{ id: number; url: string; pinned: boolean; windowId: number; groupId: number; index: number; active: boolean }>) =>
  ({ id: 0, url: "https://x.com", pinned: false, windowId: 1, groupId: -1, index: 0, ...t }) as any;

describe("ungroupAll", () => {
  beforeEach(() => {
    stub.openTabs = [
      tab({ id: 1, groupId: 50, index: 0, pinned: true }),
      tab({ id: 2, groupId: 50, index: 1 }),
      tab({ id: 3, groupId: 60, index: 2 }),
      tab({ id: 4, groupId: -1, index: 3 }),
    ];
    stub.groups = [{ id: 50, title: "A", windowId: 1 }, { id: 60, title: "B", windowId: 1 }];
  });

  it("ungroups every grouped tab", async () => {
    await ungroupAll();
    expect(stub.ungroupedIds.sort()).toEqual([2, 3]);
  });

  // A pinned tab keeps its group in Chrome's UI; touching it here would move it unexpectedly.
  it("leaves pinned tabs in their group", async () => {
    await ungroupAll();
    expect(stub.ungroupedIds).not.toContain(1);
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).toBe(50);
  });

  it("does nothing when no tab is grouped", async () => {
    stub.openTabs = [tab({ id: 1, groupId: -1 })];
    await ungroupAll();
    expect(stub.ungroupedIds).toEqual([]);
  });
});

describe("collapseAllGroups", () => {
  it("collapses every group and reports how many there were", async () => {
    stub.groups = [{ id: 50, title: "A", windowId: 1 }, { id: 60, title: "B", windowId: 1 }];
    expect(await collapseAllGroups()).toBe(2);
    expect(stub.groups.every((g) => g.collapsed)).toBe(true);
  });

  it("returns 0 when there are no groups", async () => {
    expect(await collapseAllGroups()).toBe(0);
    expect(stub.groupUpdates).toEqual([]);
  });

  // An update per group that is already collapsed changes nothing and costs a round-trip each.
  it("only updates groups that are still expanded, but counts them all", async () => {
    stub.groups = [
      { id: 50, title: "A", windowId: 1, collapsed: true },
      { id: 60, title: "B", windowId: 1, collapsed: false },
    ];
    expect(await collapseAllGroups()).toBe(2);
    expect(stub.groupUpdates.map((u) => u.id)).toEqual([60]);
  });
});

describe("pickMajorityWindow", () => {
  it("picks the window holding the most of the tabs", () => {
    expect(pickMajorityWindow([tab({ windowId: 1 }), tab({ windowId: 2 }), tab({ windowId: 2 })])).toBe(2);
  });

  it("is stable for a single tab", () => {
    expect(pickMajorityWindow([tab({ windowId: 7 })])).toBe(7);
  });

  // Ties resolve to whichever window the iteration reaches first — asserted so a future change
  // to the counting loop is a visible decision rather than a silent one.
  it("resolves a tie deterministically", () => {
    const pick = pickMajorityWindow([tab({ windowId: 1 }), tab({ windowId: 2 })]);
    expect([1, 2]).toContain(pick);
    expect(pickMajorityWindow([tab({ windowId: 1 }), tab({ windowId: 2 })])).toBe(pick);
  });
});

describe("groupTabsByDomain", () => {
  it("groups two tabs of the same domain and titles the group after it", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0 }),
      tab({ id: 2, url: "https://github.com/two", index: 1 }),
    ];
    await groupTabsByDomain();
    expect(stub.openTabs.every((t) => t.groupId !== -1)).toBe(true);
    expect(stub.groupUpdates.some((u) => u.title === "github")).toBe(true);
  });

  // One tab of a domain is not a group — it would produce a pile of single-tab groups.
  it("leaves a lone tab of a domain ungrouped", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0 }),
      tab({ id: 2, url: "https://example.com", index: 1 }),
      tab({ id: 3, url: "https://github.com/two", index: 2 }),
    ];
    await groupTabsByDomain();
    expect(stub.openTabs.find((t) => t.id === 2)!.groupId).toBe(-1);
  });

  it("never groups pinned tabs", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0, pinned: true }),
      tab({ id: 2, url: "https://github.com/two", index: 1 }),
      tab({ id: 3, url: "https://github.com/three", index: 2 }),
    ];
    await groupTabsByDomain();
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).toBe(-1);
  });

  it("treats subdomains of one site as the same domain", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://docs.github.com/a", index: 0 }),
      tab({ id: 2, url: "https://gist.github.com/b", index: 1 }),
    ];
    await groupTabsByDomain();
    expect(stub.groupUpdates.some((u) => u.title === "github")).toBe(true);
  });

  // A multi-part public suffix is dropped whole, not just its last label.
  it("names the group without the public suffix", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://www.bbc.co.uk/news", index: 0 }),
      tab({ id: 2, url: "https://bbc.co.uk/sport", index: 1 }),
    ];
    await groupTabsByDomain();
    expect(stub.groupUpdates.map((u) => u.title).filter(Boolean)).toEqual(["bbc"]);
  });

  // The name is the key, so one site's country domains share a group instead of making two
  // groups with the same title.
  it("puts one site's country domains in a single group", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://google.com/a", index: 0 }),
      tab({ id: 2, url: "https://google.de/b", index: 1 }),
    ];
    await groupTabsByDomain();
    expect(stub.groupUpdates.map((u) => u.title).filter(Boolean)).toEqual(["google"]);
    expect(new Set(stub.openTabs.map((t) => t.groupId)).size).toBe(1);
  });

  it("keeps the hostname for hosts with no registrable domain", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "http://localhost:3000/a", index: 0 }),
      tab({ id: 2, url: "http://localhost:5173/b", index: 1 }),
    ];
    await groupTabsByDomain();
    expect(stub.groupUpdates.map((u) => u.title).filter(Boolean)).toEqual(["localhost"]);
  });

  // Groups made before names were shortened are still titled with the full domain.
  it("additive mode still fills a group titled with the full domain", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0, groupId: 70 }),
      tab({ id: 2, url: "https://github.com/two", index: 1 }),
    ];
    stub.groups = [{ id: 70, title: "github.com", color: "blue", windowId: 1 }];
    await groupTabsByDomain("additive");
    expect(stub.openTabs.find((t) => t.id === 2)!.groupId).toBe(70);
    expect(stub.groups).toHaveLength(1);
  });

  // additive is the default because it must not disturb groups the user made by hand.
  it("additive mode leaves an existing hand-made group alone", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com", index: 0, groupId: 70 }),
      tab({ id: 2, url: "https://b.com", index: 1, groupId: 70 }),
    ];
    stub.groups = [{ id: 70, title: "Mine", color: "purple", windowId: 1 }];
    await groupTabsByDomain("additive");
    expect(stub.openTabs.every((t) => t.groupId === 70)).toBe(true);
  });

  it("additive mode fetches every tab once", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0 }),
      tab({ id: 2, url: "https://github.com/two", index: 1 }),
    ];
    const query = chrome.tabs.query;
    let everyTab = 0;
    chrome.tabs.query = (async (q: chrome.tabs.QueryInfo = {}) => {
      if (Object.keys(q).length === 0) everyTab++;
      return query(q);
    }) as typeof chrome.tabs.query;
    await groupTabsByDomain("additive");
    expect(everyTab).toBe(1);
  });

  // Group and Regroup finish by collapsing every group but the active one. On a strip already
  // in that state, nothing should be sent.
  it("sends no collapse update to a group already in the right state", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0, groupId: 70, active: true }),
      tab({ id: 2, url: "https://github.com/two", index: 1, groupId: 70 }),
      tab({ id: 3, url: "https://example.com/a", index: 2, groupId: 80 }),
      tab({ id: 4, url: "https://example.com/b", index: 3, groupId: 80 }),
    ];
    stub.groups = [
      { id: 70, title: "github", color: "blue", windowId: 1, collapsed: false },
      { id: 80, title: "example", color: "red", windowId: 1, collapsed: true },
    ];
    await groupTabsByDomain("additive");
    expect(stub.groupUpdates.filter((u) => u.collapsed !== undefined)).toEqual([]);
  });

  it("expands the active tab's group when it is collapsed", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://github.com/one", index: 0, groupId: 70, active: true }),
      tab({ id: 2, url: "https://github.com/two", index: 1, groupId: 70 }),
    ];
    stub.groups = [{ id: 70, title: "github", color: "blue", windowId: 1, collapsed: true }];
    await groupTabsByDomain("additive");
    expect(stub.groupUpdates.filter((u) => u.collapsed !== undefined)).toEqual([{ id: 70, collapsed: false }]);
  });

  it("rebuild mode dissolves existing groups first", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://a.com/one", index: 0, groupId: 70 }),
      tab({ id: 2, url: "https://b.com", index: 1, groupId: 70 }),
    ];
    stub.groups = [{ id: 70, title: "Mine", color: "purple", windowId: 1 }];
    await groupTabsByDomain("rebuild");
    expect(stub.ungroupedIds.sort()).toEqual([1, 2]);
  });
});

// The ignore lists were enforced only on the background's auto-group path, so the very
// commands the user reaches for by hand walked straight over them.
describe("ignore lists", () => {
  const withConfig = (config: Record<string, unknown>) => {
    stub.localData["rulesConfig"] = { rules: [], ...config };
  };

  it("groupTabsByDomain skips tabs whose URL is ignored", async () => {
    withConfig({ ignorePatterns: [{ pattern: "example.com", enabled: true }] });
    stub.openTabs = [
      tab({ id: 1, url: "https://example.com/one", index: 0 }),
      tab({ id: 2, url: "https://example.com/two", index: 1 }),
      tab({ id: 3, url: "https://github.com/one", index: 2 }),
      tab({ id: 4, url: "https://github.com/two", index: 3 }),
    ];
    await groupTabsByDomain();
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).toBe(-1);
    expect(stub.openTabs.find((t) => t.id === 2)!.groupId).toBe(-1);
    expect(stub.openTabs.find((t) => t.id === 3)!.groupId).not.toBe(-1);
    expect(stub.groupUpdates.some((u) => u.title === "example.com")).toBe(false);
  });

  it("honours wildcard ignore patterns", async () => {
    withConfig({ ignorePatterns: [{ pattern: "*.example.com", enabled: true }] });
    stub.openTabs = [
      tab({ id: 1, url: "https://docs.example.com/one", index: 0 }),
      tab({ id: 2, url: "https://docs.example.com/two", index: 1 }),
    ];
    await groupTabsByDomain();
    expect(stub.openTabs.every((t) => t.groupId === -1)).toBe(true);
  });

  it("rebuild mode leaves an ignored group standing", async () => {
    withConfig({ ignoreGroupNames: [{ pattern: "Claude", enabled: true }] });
    stub.openTabs = [
      tab({ id: 1, url: "https://claude.ai/a", index: 0, groupId: 70 }),
      tab({ id: 2, url: "https://claude.ai/b", index: 1, groupId: 70 }),
      tab({ id: 3, url: "https://a.com/one", index: 2, groupId: 80 }),
    ];
    stub.groups = [
      { id: 70, title: "Claude", color: "purple", windowId: 1 },
      { id: 80, title: "Mine", color: "blue", windowId: 1 },
    ];
    await groupTabsByDomain("rebuild");
    expect(stub.ungroupedIds).not.toContain(1);
    expect(stub.ungroupedIds).not.toContain(2);
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).toBe(70);
  });

  it("ungroupAll leaves an ignored group standing", async () => {
    withConfig({ ignoreGroupNames: [{ pattern: "Claude", enabled: true }] });
    stub.openTabs = [
      tab({ id: 1, index: 0, groupId: 70 }),
      tab({ id: 2, index: 1, groupId: 80 }),
    ];
    stub.groups = [
      { id: 70, title: "Claude", color: "purple", windowId: 1 },
      { id: 80, title: "Mine", color: "blue", windowId: 1 },
    ];
    await ungroupAll();
    expect(stub.ungroupedIds).toEqual([2]);
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).toBe(70);
  });

  it("a rule does not pull a tab out of an ignored group", async () => {
    withConfig({
      useRules: true,
      rules: [{ id: "r1", name: "Claude", color: "purple", patterns: ["claude.ai"] }],
      ignoreGroupNames: [{ pattern: "Personal", enabled: true }],
    });
    stub.openTabs = [
      tab({ id: 1, url: "https://claude.ai/chat", index: 0, groupId: 70 }),
      tab({ id: 2, url: "https://claude.ai/docs", index: 1 }),
    ];
    stub.groups = [{ id: 70, title: "Personal", color: "grey", windowId: 1 }];
    await groupTabsByDomain();
    expect(stub.ungroupedIds).not.toContain(1);
    expect(stub.openTabs.find((t) => t.id === 1)!.groupId).toBe(70);
  });

  it("still ungroups everything when no group name is ignored", async () => {
    withConfig({ ignoreGroupNames: [] });
    stub.openTabs = [tab({ id: 1, index: 0, groupId: 70 })];
    stub.groups = [{ id: 70, title: "Mine", color: "blue", windowId: 1 }];
    await ungroupAll();
    expect(stub.ungroupedIds).toEqual([1]);
  });
});

// Background auto-group's decision for a tab no rule claimed.
describe("planDomainGroup", () => {
  const plan = async (url: string, windowGroups: any[] = []) =>
    planDomainGroup(url, windowGroups, await getDomainMapper(), await getGroupNameMapper());

  it("joins a group already titled for the site", async () => {
    const p = await plan("https://github.com/x", [{ id: 7, title: "github", windowId: 1 }]);
    expect(p).toMatchObject({ title: "github", joinGroupId: 7 });
  });

  it("joins a group titled with the full domain from before names were shortened", async () => {
    const p = await plan("https://github.com/x", [{ id: 7, title: "github.com", windowId: 1 }]);
    expect(p?.joinGroupId).toBe(7);
  });

  it("never joins a shared group", async () => {
    const p = await plan("https://github.com/x", [{ id: 7, title: "github", windowId: 1, shared: true }]);
    expect(p?.joinGroupId).toBeUndefined();
  });

  it("names a new group after the site when there is none to join", async () => {
    const p = await plan("https://github.com/x", [{ id: 7, title: "Work", windowId: 1 }]);
    expect(p).toMatchObject({ title: "github" });
    expect(p?.joinGroupId).toBeUndefined();
  });
});

describe("domainGroupPartners", () => {
  const partners = async (url: string, windowTabs: any[], ignorePatterns: any[] = []) => {
    const nameOf = await getGroupNameMapper();
    return domainGroupPartners(99, nameOf(url), windowTabs, nameOf, ignorePatterns);
  };

  // No partner means no new group. The caller also relies on this when a join fails.
  it("has no partner for the only tab of a site", async () => {
    expect(await partners("https://github.com/x", [
      tab({ id: 99, url: "https://github.com/x" }),
      tab({ id: 2, url: "https://example.com" }),
    ])).toEqual([]);
  });

  it("partners with a loose tab of the same site, not a grouped one", async () => {
    expect(await partners("https://github.com/x", [
      tab({ id: 2, url: "https://docs.github.com/a" }),
      tab({ id: 3, url: "https://github.com/b", groupId: 40 }),
    ])).toEqual([2]);
  });

  it("does not count a pinned tab as a partner", async () => {
    expect(await partners("https://mail.google.com/x", [tab({ id: 2, url: "https://mail.google.com/y", pinned: true })])).toEqual([]);
  });

  it("does not count an ignored URL as a partner", async () => {
    expect(await partners(
      "https://docs.google.com/x",
      [tab({ id: 2, url: "https://mail.google.com/y" })],
      [{ pattern: "mail.google.com", enabled: true }]
    )).toEqual([]);
  });
});
