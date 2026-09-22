import { describe, it, expect } from "vitest";
import { createTabSearch } from "./tabsearch.ts";
import { parseCommand, type SearchResult } from "./search.ts";
import { resolveView, readingListRows, duplicateTabs, firstSelectable, nextSelectable, type ViewContext } from "./views.ts";

function tab(id: number, fields: Partial<SearchResult> = {}): SearchResult {
  return {
    type: "tab", id: `tab-${id}`, tabId: id, title: `Tab ${id}`, url: `https://site${id}.com/`,
    windowId: 1, groupId: -1, lastAccessed: id, ...fields,
  };
}

function ctx(tabs: SearchResult[], extra: Partial<ViewContext> = {}): ViewContext {
  return {
    search: createTabSearch(tabs, tabs.map((t) => t.lastAccessed ?? 0), tabs.map(() => 0)),
    currentWindowId: 1,
    activeGroupId: -1,
    ...extra,
  };
}

/** Resolve typed input the way the palette does: parse the prefix, then resolve the view. */
function view(input: string, c: ViewContext) {
  const { prefix, query } = parseCommand(input);
  return resolveView(prefix!, query, c);
}

const ids = (rows: SearchResult[]) => rows.map((r) => r.tabId);
const titles = (rows: SearchResult[]) => rows.map((r) => r.title);
const dividers = (rows: SearchResult[]) => rows.filter((r) => r.type === "divider").map((r) => r.title);

describe("triage views", () => {
  it("@a lists audible tabs and @m muted ones", () => {
    const c = ctx([tab(1, { audible: true }), tab(2, { muted: true }), tab(3)]);
    expect(ids(view("@a", c).rows)).toEqual([1]);
    expect(ids(view("@m", c).rows)).toEqual([2]);
  });

  it("@d lists every copy of a page /dedup would close, by its URL rule", () => {
    const c = ctx([
      tab(1, { url: "https://a.com/?utm_source=x" }),
      tab(2, { url: "https://a.com/" }),
      tab(3, { url: "chrome://newtab/" }),
      tab(4, { url: "chrome://newtab/" }),
      tab(5, { url: "https://a.com/#top" }),
    ]);
    expect(ids(view("@d", c).rows)).toEqual([1, 2]);
    expect(duplicateTabs(c.search.items)).toHaveLength(2);
  });

  it("@r lists the 20 most recently used tabs, most recent first", () => {
    const c = ctx(Array.from({ length: 25 }, (_, i) => tab(i + 1)));
    expect(ids(view("@r", c).rows)).toEqual(Array.from({ length: 20 }, (_, i) => 25 - i));
  });

  it("@s lists unloaded tabs and @f paused ones, saying when Chrome paused none", () => {
    const c = ctx([tab(1, { discarded: true }), tab(2)]);
    expect(ids(view("@s", c).rows)).toEqual([1]);
    expect(view("@f", c)).toEqual({ rows: [], empty: "Chrome hasn't paused any tabs" });
    expect(ids(view("@f", ctx([tab(1, { frozen: true })])).rows)).toEqual([1]);
  });

  it("@u lists tabs outside any group, whether Chrome says -1 or nothing", () => {
    const c = ctx([tab(1), tab(2, { groupId: undefined }), tab(3, { groupId: 5 })]);
    expect(ids(view("@u", c).rows)).toEqual([1, 2]);
    expect(view("@u", ctx([tab(1, { groupId: 5 })])).empty).toBe("All tabs are grouped");
  });

  it("@b outlines the active tab's branch, indenting each level", () => {
    const c = ctx([tab(1, { title: "Root" }), tab(2, { title: "Child" }), tab(3, { title: "" })], {
      branch: [{ id: 1, depth: 0 }, { id: 2, depth: 1 }, { id: 3, depth: 2 }, { id: 99, depth: 1 }],
    });
    expect(titles(view("@b", c).rows)).toEqual(["Root", "↳ Child", "  ↳ Untitled"]);
    // Retitled copies: the loaded rows themselves are untouched.
    expect(c.search.items[1].title).toBe("Child");
  });

  it("@b says so when the active tab opened nothing", () => {
    const lone = ctx([tab(1)], { branch: [{ id: 1, depth: 0 }] });
    expect(view("@b", lone)).toEqual({ rows: [], empty: "No tabs were opened from this one" });
    expect(view("@b", ctx([tab(1)])).rows).toEqual([]);
  });

  it("@shared lists tabs in groups Chrome marks shared", () => {
    const tabs = [tab(1, { groupId: 5 }), tab(2, { groupId: 6 }), tab(3)];
    const c = ctx(tabs, { groups: [{ id: 5, shared: true }, { id: 6 }] });
    expect(ids(view("@shared", c).rows)).toEqual([1]);
    expect(view("@shared", ctx(tabs, { groups: [{ id: 5 }] })).empty).toBe("No shared group tabs");
  });

  // "@shared" once parsed as "@s" + "hared", so its view was unreachable.
  it("@shared is its own view, not @s followed by 'hared'", () => {
    const c = ctx([tab(1, { groupId: 5 }), tab(2, { discarded: true })], { groups: [{ id: 5, shared: true }] });
    expect(ids(view("@shared", c).rows)).toEqual([1]);
    expect(ids(view("@s", c).rows)).toEqual([2]);
  });

  // A greedy prefix match turned "@afoo" into the unknown view "@afoo".
  it("@afoo is @a searched for foo", () => {
    const c = ctx([tab(1, { title: "foo page", audible: true }), tab(2, { title: "bar page", audible: true }), tab(3, { title: "foo other" })]);
    expect(ids(view("@afoo", c).rows)).toEqual([1]);
  });

  it("ranks text after a view within that view only", () => {
    const c = ctx([
      tab(1, { title: "YouTube music", audible: true }),
      tab(2, { title: "Spotify", audible: true }),
      tab(3, { title: "YouTube lecture" }),
    ]);
    expect(ids(view("@a youtube", c).rows)).toEqual([1]);
  });

  it("speaks up only when the view is empty, not when the text matches nothing in it", () => {
    const c = ctx([tab(1, { title: "GitHub" })]);
    expect(view("@u zzzz", c)).toEqual({ rows: [], empty: undefined });
    expect(view("@f github", c).empty).toBe("Chrome hasn't paused any tabs");
  });

  it("lists every row with no text, where /w stops at 50", () => {
    const c = ctx(Array.from({ length: 60 }, (_, i) => tab(i + 1)));
    expect(view("@u", c).rows).toHaveLength(60);
    expect(view("/w", c).rows).toHaveLength(50);
  });
});

describe("the bare @ overview", () => {
  it("lists each category that has tabs, in order, and leaves out @u, @b and @shared", () => {
    const c = ctx([
      tab(1, { audible: true }), tab(2, { muted: true }), tab(3, { discarded: true }), tab(4, { frozen: true }),
      tab(5, { groupId: 7 }),
    ], { groups: [{ id: 7, shared: true }], branch: [{ id: 1, depth: 0 }, { id: 2, depth: 1 }] });
    const { rows, empty } = view("@", c);

    expect(dividers(rows)).toEqual([
      "Playing Audio (1)", "Muted (1)", "Recently Active (5)", "Unloaded (1)", "Paused by Chrome (1)",
    ]);
    expect(rows[0]).toMatchObject({ type: "divider", id: "div-triage-audio" });
    expect(ids(rows.slice(1, 2))).toEqual([1]);
    expect(empty).toBeUndefined();
  });

  it("shows 15 recently active tabs where @r shows 20", () => {
    const c = ctx(Array.from({ length: 25 }, (_, i) => tab(i + 1)));
    expect(dividers(view("@", c).rows)).toEqual(["Recently Active (15)"]);
  });

  // Searching the overview once dropped the section labels, leaving an unlabelled list.
  it("keeps each section's label when searching, counting only its matches", () => {
    const c = ctx([tab(1, { title: "YouTube", audible: true }), tab(2, { title: "Spotify", audible: true })]);
    const { rows } = view("@ youtube", c);
    expect(dividers(rows)).toEqual(["Playing Audio (1)", "Recently Active (1)"]);
    expect(rows.map((r) => r.type === "divider" ? "-" : r.tabId)).toEqual(["-", 1, "-", 1]);
  });

  it("is all clear with nothing to triage, and says when a search matches nothing", () => {
    expect(view("@", ctx([]))).toEqual({ rows: [], empty: "All clear — no tabs need attention" });
    expect(view("@ zzzz", ctx([tab(1, { title: "GitHub" })]))).toEqual({ rows: [], empty: "No triage matches" });
  });
});

describe("tab views", () => {
  it("/w lists the current window's tabs", () => {
    const c = ctx([tab(1, { windowId: 1 }), tab(2, { windowId: 2 })], { currentWindowId: 2 });
    expect(ids(view("/w", c).rows)).toEqual([2]);
  });

  it("/p lists Chrome-pinned tabs", () => {
    expect(ids(view("/p", ctx([tab(1), tab(2, { pinned: true })])).rows)).toEqual([2]);
  });

  it("/g lists the active tab's group, or the ungrouped tabs when it has none", () => {
    const tabs = [tab(1, { groupId: 5 }), tab(2, { groupId: 6 }), tab(3), tab(4, { groupId: undefined })];
    expect(ids(view("/g", ctx(tabs, { activeGroupId: 5 })).rows)).toEqual([1]);
    expect(ids(view("/g", ctx(tabs)).rows)).toEqual([3, 4]);
  });

  it("ranks the text after the prefix within the view", () => {
    const c = ctx([tab(1, { title: "GitHub", windowId: 1 }), tab(2, { title: "GitHub", windowId: 2 }), tab(3, { title: "Docs" })]);
    expect(ids(view("/w github", c).rows)).toEqual([1]);
  });
});

describe("Reading List and recently closed", () => {
  const rows = readingListRows([
    { url: "https://a.com/", title: "Unread one", hasBeenRead: false, creationTime: 0, lastUpdateTime: 0 },
    { url: "https://b.com/", title: "Read one", hasBeenRead: true, creationTime: 0, lastUpdateTime: 0 },
  ]);

  it("marks read Reading List entries and opens them as links", () => {
    expect(rows).toEqual([
      { type: "bookmark", id: "rl-0", title: "Unread one", url: "https://a.com/" },
      { type: "bookmark", id: "rl-1", title: "✓ Read one", url: "https://b.com/" },
    ]);
  });

  it("list what the view read, ranked by the text after it", () => {
    const c = ctx([tab(1)], { source: rows });
    expect(view("/rl", c).rows).toEqual(rows);
    expect(view("/rl unread", c).rows).toEqual([rows[0]]);
  });

  it("say when the list is empty", () => {
    expect(view("/rl", ctx([]))).toEqual({ rows: [], empty: "Reading List is empty" });
    expect(view("/rc", ctx([], { source: [] }))).toEqual({ rows: [], empty: "No recently closed tabs" });
  });
});

describe("regex view", () => {
  it("matches the tabs against a pattern, most recent first", () => {
    const c = ctx([tab(1, { title: "GitHub a" }), tab(2, { title: "Docs" }), tab(3, { title: "GitLab" })]);
    expect(ids(view("/re ^Git", c).rows)).toEqual([3, 1]);
  });

  it("lists nothing for a pattern that does not compile", () => {
    expect(view("/re (", ctx([tab(1)])).rows).toEqual([]);
  });
});

describe("other prefixes", () => {
  it("an action previews the tabs it would act on, and none when bare", () => {
    const c = ctx([tab(1, { title: "GitHub" }), tab(2, { title: "Docs" })]);
    expect(ids(view("/close github", c).rows)).toEqual([1]);
    expect(view("/close", c).rows).toEqual([]);
  });

  it("an unknown prefix searches the text as typed", () => {
    const c = ctx([tab(1, { title: "GitHub" })]);
    expect(view("/nosuch git", c).rows).toBe(c.search.rank("/nosuch git"));
  });

  it("a prefix named like an Object.prototype member is not a view", () => {
    const c = ctx([tab(1)]);
    for (const p of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(() => resolveView(p, "", c)).not.toThrow();
      expect(resolveView(p, "", c).rows).toBe(c.search.rank(`/${p} `));
    }
  });
});

describe("selection over dividers", () => {
  const d = (id: string): SearchResult => ({ type: "divider", id, title: id, url: "" });
  const [a, b] = [tab(1), tab(2)];

  it("a fresh list starts on its first real row", () => {
    expect(firstSelectable([d("x"), a, b])).toBe(1);
    expect(firstSelectable([a, b])).toBe(0);
    expect(firstSelectable([])).toBe(0);
    expect(firstSelectable([d("x")])).toBe(0);
  });

  it("steps over dividers in either direction", () => {
    const rows = [d("x"), a, d("y"), b];
    expect(nextSelectable(rows, 1, 1)).toBe(3);
    expect(nextSelectable(rows, 3, -1)).toBe(1);
  });

  it("stays on the last real row at either end rather than rest on a label", () => {
    const rows = [d("x"), a, d("y"), b];
    expect(nextSelectable(rows, 3, 1)).toBe(3);
    expect(nextSelectable(rows, 1, -1)).toBe(1);
  });

  it("leaves a divider it is parked on for the nearest real row the other way", () => {
    expect(nextSelectable([a, d("x")], 1, 1)).toBe(0);
    expect(nextSelectable([d("x"), a], 0, -1)).toBe(1);
    expect(nextSelectable([d("x"), d("y")], 0, 1)).toBe(0);
  });
});
