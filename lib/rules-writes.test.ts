import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { updateConfig } from "./rules.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
});

describe("config writes", () => {
  it("does not launder a failed write into storage on the next write", async () => {
    stub.failWrites = true;
    await expect(updateConfig({ autoGroup: true })).rejects.toThrow();
    stub.failWrites = false;

    await updateConfig({ autoSort: true });

    const stored = stub.localData.rulesConfig as { autoGroup: boolean; autoSort: boolean };
    expect(stored.autoSort).toBe(true);
    expect(stored.autoGroup).toBe(false);
  });

  // The popup and the side panel are the same component in two contexts. Mutating localData
  // directly models the other one's write landing just before this one's.
  it("does not revert a toggle another context has just written", async () => {
    await updateConfig({});
    stub.localData.rulesConfig = { ...(stub.localData.rulesConfig as object), autoGroup: true };

    await updateConfig({ autoSort: true });

    const stored = stub.localData.rulesConfig as { autoGroup: boolean; autoSort: boolean };
    expect(stored.autoSort).toBe(true);
    expect(stored.autoGroup).toBe(true);
  });

  it("serializes rapid toggles within one context", async () => {
    await Promise.all([
      updateConfig({ autoGroup: true }),
      updateConfig({ autoSort: true }),
      updateConfig({ useRules: true }),
    ]);
    const stored = stub.localData.rulesConfig as Record<string, boolean>;
    expect(stored.autoGroup).toBe(true);
    expect(stored.autoSort).toBe(true);
    expect(stored.useRules).toBe(true);
  });
});
