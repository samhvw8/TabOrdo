import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installChromeStub, type ChromeStub, type StubTab } from "./testing/chrome-stub.ts";
import { runAIGroup } from "./aigroup.ts";
import { getAIProgress, setAIProgress, defaultProgress } from "./ai.ts";
import { isBulkLocked, ECHO_GRACE_MS } from "./bulklock.ts";
import { createSelfWriteLedger } from "./selfwrite.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
  stub.windows = [{ id: 1 }, { id: 2 }];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const tab = (t: Partial<StubTab> & { id: number }): StubTab =>
  ({ url: "https://x.com", title: "X", pinned: false, windowId: 1, groupId: -1, index: 0, ...t });

/** A model that is available and answers `answer` to every prompt. */
function stubModel(answer: unknown) {
  vi.stubGlobal("LanguageModel", {
    availability: async () => "available",
    create: async () => ({
      contextWindow: Infinity,
      contextUsage: 0,
      prompt: async () => JSON.stringify(answer),
      destroy: () => {},
    }),
  });
}

describe("runAIGroup", () => {
  it("groups each suggestion in the window holding most of its tabs, and marks them as ours", async () => {
    stub.openTabs = [
      tab({ id: 1, url: "https://svelte.dev", index: 0 }),
      tab({ id: 2, url: "https://wxt.dev", index: 1 }),
      tab({ id: 3, url: "https://vitejs.dev", windowId: 2, index: 0 }),
    ];
    stubModel([{ group: "Web dev", indices: [0, 1, 2] }]);
    const selfWrites = createSelfWriteLedger();

    const result = await runAIGroup(selfWrites);

    expect(result).toEqual({ ok: true, message: "AI grouped 3 tab(s) into 1 group(s)" });
    const gid = stub.openTabs.find((t) => t.id === 1)!.groupId;
    expect(stub.openTabs.map((t) => [t.windowId, t.groupId])).toEqual([[1, gid], [1, gid], [1, gid]]);
    expect(stub.groupUpdates).toEqual([{ id: gid, title: "Web dev", color: "blue" }]);
    expect([1, 2, 3].every((id) => selfWrites.has(id))).toBe(true);
    expect((await getAIProgress()).status).toBe("done");
  });

  it("releases the bulk lock when it is done", async () => {
    vi.useFakeTimers();
    stub.openTabs = [tab({ id: 1 }), tab({ id: 2, index: 1 })];
    stubModel([]);
    expect(await runAIGroup(createSelfWriteLedger())).toEqual({ ok: true, message: "AI found no groups to suggest" });
    vi.advanceTimersByTime(ECHO_GRACE_MS + 1);
    expect(await isBulkLocked()).toBe(false);
  });

  it("refuses to start while another run is in flight", async () => {
    await setAIProgress({ ...defaultProgress(), status: "prompting" });
    expect(await runAIGroup(createSelfWriteLedger())).toEqual({ ok: false, message: "AI grouping already in progress" });
  });

  it("says so when there are fewer than two loose tabs", async () => {
    stub.openTabs = [tab({ id: 1 }), tab({ id: 2, index: 1, groupId: 9 })];
    stubModel([]);
    expect(await runAIGroup(createSelfWriteLedger())).toEqual({ ok: false, message: "Need 2+ ungrouped tabs" });
  });
});
