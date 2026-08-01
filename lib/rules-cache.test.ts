import { describe, it, expect, beforeEach, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";

let stub: ChromeStub;
let rules: typeof import("./rules.ts");

// rules.ts registers its storage.onChanged listener at module scope, so the stub has to
// exist before the module is evaluated. Reset and re-import per test.
beforeEach(async () => {
  stub = installChromeStub();
  vi.resetModules();
  rules = await import("./rules.ts");
});

/** Let queued onChanged callbacks run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function countReads(): () => number {
  const area = chrome.storage.local;
  const orig = area.get.bind(area);
  let n = 0;
  (area as { get: unknown }).get = async (keys: string | string[]) => {
    n++;
    return orig(keys);
  };
  return () => n;
}

describe("config cache", () => {
  it("serves a second read from cache instead of storage", async () => {
    await rules.getConfig();
    const reads = countReads();
    await rules.getConfig();
    await rules.getConfig();
    expect(reads()).toBe(0);
  });

  it("drops the cache when another context writes the config", async () => {
    await rules.setAutoGroup(true);
    expect(await rules.getAutoGroup()).toBe(true);

    // Another realm writes directly, then its onChanged is delivered.
    await chrome.storage.local.set({
      rulesConfig: { ...(stub.localData.rulesConfig as object), autoGroup: false },
    });
    await settle();

    expect(await rules.getAutoGroup()).toBe(false);
  });
});

describe("config cache — failed writes", () => {
  it("does not leave a phantom config cached when the write rejects", async () => {
    await rules.getConfig();
    stub.failWrites = true;

    await expect(rules.setAutoGroup(true)).rejects.toThrow();

    // The write never landed, so no onChanged will ever arrive to invalidate a cache primed
    // ahead of it. The next read must go to storage and report the truth.
    stub.failWrites = false;
    expect(await rules.getAutoGroup()).toBe(false);
  });

  it("does not launder a failed write into storage on the next write", async () => {
    await rules.getConfig();
    stub.failWrites = true;
    await expect(rules.setAutoGroup(true)).rejects.toThrow();
    stub.failWrites = false;

    await rules.setAutoSort(true);

    const stored = stub.localData.rulesConfig as { autoGroup: boolean; autoSort: boolean };
    expect(stored.autoSort).toBe(true);
    expect(stored.autoGroup).toBe(false);
  });
});

describe("config cache — cross-context writes", () => {
  it("does not revert a sibling context's toggle that has not been delivered yet", async () => {
    await rules.getConfig(); // warm this context's cache

    // Simulate the side panel writing autoGroup:true. Mutating localData directly models the
    // window where the write has landed but onChanged has not yet been delivered here.
    stub.localData.rulesConfig = {
      ...(stub.localData.rulesConfig as object),
      autoGroup: true,
    };

    await rules.setAutoSort(true);

    const stored = stub.localData.rulesConfig as { autoGroup: boolean; autoSort: boolean };
    expect(stored.autoSort).toBe(true);
    // Read-modify-write on the write path goes to storage, not the stale cache, so the
    // sibling's toggle survives.
    expect(stored.autoGroup).toBe(true);
  });

  it("still serializes rapid toggles within one context", async () => {
    await Promise.all([rules.setAutoGroup(true), rules.setAutoSort(true), rules.setUseRules(true)]);
    const stored = stub.localData.rulesConfig as Record<string, boolean>;
    expect(stored.autoGroup).toBe(true);
    expect(stored.autoSort).toBe(true);
    expect(stored.useRules).toBe(true);
  });
});
