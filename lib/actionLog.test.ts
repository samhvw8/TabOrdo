import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { logAction, getActionLog, clearActionLog } from "./actionLog.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
});

describe("logAction", () => {
  it("prepends entries newest-first with timestamps", async () => {
    await logAction("Grouped", 'tab into "github.com"');
    await logAction("Ungrouped", '"github.com" (single tab left)');
    const log = await getActionLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ action: "Ungrouped", detail: '"github.com" (single tab left)' });
    expect(log[1]).toMatchObject({ action: "Grouped", detail: 'tab into "github.com"' });
    expect(log[0].ts).toBeGreaterThan(0);
  });

  it("caps the log at 20 entries, dropping the oldest", async () => {
    for (let i = 0; i < 25; i++) {
      await logAction("Grouped", `entry ${i}`);
    }
    const log = await getActionLog();
    expect(log).toHaveLength(20);
    expect(log[0].detail).toBe("entry 24");
    expect(log[19].detail).toBe("entry 5");
  });

  it("never throws even if storage fails", async () => {
    (chrome.storage.local.set as unknown) = async () => {
      throw new Error("quota exceeded");
    };
    await expect(logAction("Grouped", "x")).resolves.toBeUndefined();
  });
});

describe("getActionLog", () => {
  it("returns empty array when nothing was logged", async () => {
    expect(await getActionLog()).toEqual([]);
  });

  it("returns empty array when stored value is malformed", async () => {
    stub.localData.tabOrdo_actionLog = "not an array";
    expect(await getActionLog()).toEqual([]);
  });
});

describe("clearActionLog", () => {
  it("empties the log", async () => {
    await logAction("Grouped", "a");
    await clearActionLog();
    expect(await getActionLog()).toEqual([]);
  });
});
