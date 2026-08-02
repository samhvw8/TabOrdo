import { describe, it, expect, beforeEach } from "vitest";
import { focusMode, unfocusMode, hasSavedWorkspace, loadTabsFromText } from "./workspace.ts";

type FakeTab = { id: number; url?: string; pinned: boolean };

let storage: Record<string, unknown>;
let openTabs: FakeTab[];
let created: { url?: string; pinned?: boolean; active?: boolean }[];
let removed: number[];
let windowsCreated: { url?: string }[];
let discarded: number[];
/** URLs chrome.tabs.create rejects — file://, view-source: and friends in the real browser. */
let failCreateUrls: Set<string>;

beforeEach(() => {
  storage = {};
  openTabs = [];
  created = [];
  removed = [];
  windowsCreated = [];
  discarded = [];
  failCreateUrls = new Set();
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in storage) out[k] = storage[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(storage, structuredClone(items));
        },
        remove: async (key: string) => {
          delete storage[key];
        },
      },
    },
    tabs: {
      query: async () => openTabs,
      create: async (props: { url?: string; pinned?: boolean; active?: boolean }) => {
        if (props.url && failCreateUrls.has(props.url)) {
          throw new Error(`stub: create failed for ${props.url}`);
        }
        created.push(props);
        return { id: 1000 + created.length, url: props.url, pinned: props.pinned ?? false };
      },
      remove: async (ids: number[]) => {
        removed.push(...ids);
      },
      discard: async (id: number) => {
        discarded.push(id);
      },
    },
    windows: {
      create: async (props: { url?: string } = {}) => {
        windowsCreated.push(props);
        return { id: 900 + windowsCreated.length };
      },
    },
  } as unknown as typeof chrome;
});

const tab = (id: number, url: string, pinned = false): FakeTab => ({ id, url, pinned });

describe("focusMode data safety", () => {
  it("second focus does not destroy the first saved workspace (regression)", async () => {
    openTabs = [tab(1, "https://a.com"), tab(2, "https://b.com")];
    expect(await focusMode()).toBe(2);

    openTabs = [tab(3, "https://c.com")];
    expect(await focusMode()).toBe(1);

    created = [];
    expect(await unfocusMode()).toBe(1);
    expect(created.map((c) => c.url)).toEqual(["https://c.com"]);

    created = [];
    expect(await unfocusMode()).toBe(2);
    expect(created.map((c) => c.url)).toEqual(["https://a.com", "https://b.com"]);

    expect(await hasSavedWorkspace()).toBe(false);
  });

  it("saves the workspace before closing any tabs", async () => {
    openTabs = [tab(1, "https://a.com")];
    await focusMode();
    expect(await hasSavedWorkspace()).toBe(true);
    expect(removed).toEqual([1]);
  });

  it("restores pinned state", async () => {
    openTabs = [tab(1, "https://a.com", true), tab(2, "https://b.com")];
    await focusMode();
    created = [];
    await unfocusMode();
    expect(created).toEqual([
      { url: "https://a.com", pinned: true, active: false },
      { url: "https://b.com", pinned: false, active: false },
    ]);
  });

  it("skips chrome:// and extension pages", async () => {
    openTabs = [tab(1, "chrome://settings"), tab(2, "chrome-extension://abc/popup.html"), tab(3, "https://a.com")];
    expect(await focusMode()).toBe(1);
    expect(removed).toEqual([3]);
  });

  it("does nothing when no eligible tabs", async () => {
    openTabs = [tab(1, "chrome://settings")];
    expect(await focusMode()).toBe(0);
    expect(created).toEqual([]);
    expect(removed).toEqual([]);
    expect(await hasSavedWorkspace()).toBe(false);
  });

  it("unfocus with nothing saved returns 0", async () => {
    expect(await unfocusMode()).toBe(0);
    expect(created).toEqual([]);
  });
});

// One URL Chrome refuses to open used to throw out of the restore loop, so the popped stack
// was never persisted — and the next /unfocus reopened everything that had already come back.
describe("unfocus partial restore", () => {
  beforeEach(async () => {
    openTabs = [tab(1, "https://a.com"), tab(2, "file:///notes.txt"), tab(3, "https://c.com")];
    await focusMode();
    created = [];
    failCreateUrls.add("file:///notes.txt");
  });

  it("reopens the rest of the workspace and reports what came back", async () => {
    expect(await unfocusMode()).toBe(2);
    expect(created.map((c) => c.url)).toEqual(["https://a.com", "https://c.com"]);
  });

  it("consumes the workspace, so a retry cannot duplicate the restored tabs", async () => {
    await unfocusMode();
    expect(await hasSavedWorkspace()).toBe(false);

    created = [];
    expect(await unfocusMode()).toBe(0);
    expect(created).toEqual([]);
  });
});

describe("legacy single-slot migration", () => {
  const legacy = { tabs: [{ url: "https://old.com", pinned: false }], savedAt: 1 };

  it("restores a workspace saved under the legacy key", async () => {
    storage["tabOrdo_workspace"] = legacy;
    expect(await hasSavedWorkspace()).toBe(true);
    expect(await unfocusMode()).toBe(1);
    expect(created.map((c) => c.url)).toEqual(["https://old.com"]);
    expect(storage["tabOrdo_workspace"]).toBeUndefined();
    expect(await hasSavedWorkspace()).toBe(false);
  });

  it("keeps the legacy workspace below newer focuses", async () => {
    storage["tabOrdo_workspace"] = legacy;
    openTabs = [tab(1, "https://new.com")];
    await focusMode();

    created = [];
    await unfocusMode();
    expect(created.map((c) => c.url)).toEqual(["https://new.com"]);

    created = [];
    await unfocusMode();
    expect(created.map((c) => c.url)).toEqual(["https://old.com"]);
  });
});

describe("loadTabsFromText", () => {
  it("opens the URLs it parsed, discarding all but the first", async () => {
    const n = await loadTabsFromText("A\thttps://a.com\nB\thttps://b.com\nnot a url");
    expect(n).toBe(2);
    expect(windowsCreated).toEqual([{ url: "https://a.com" }]);
    expect(created.map((c) => c.url)).toEqual(["https://b.com"]);
    expect(discarded).toHaveLength(1);
  });

  it("still opens the first URL when it alone exceeds the size cap", async () => {
    // Previously capped came back empty here, so we opened a blank window and then
    // reported "no valid URLs found".
    const huge = "https://a.com/" + "x".repeat(3 * 1024 * 1024);
    const n = await loadTabsFromText(huge);
    expect(n).toBe(1);
    expect(windowsCreated).toEqual([{ url: huge }]);
  });

  it("opens nothing when no line parses to a URL", async () => {
    expect(await loadTabsFromText("nope\nstill nope")).toBe(0);
    expect(windowsCreated).toEqual([]);
  });
});
