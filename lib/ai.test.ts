import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkAIAvailability, suggestGroups } from "./ai.ts";

beforeEach(() => {
  delete (globalThis as any).ai;
  delete (globalThis as any).LanguageModel;
});

describe("checkAIAvailability", () => {
  it("returns unavailable with setup instructions when no API exists", async () => {
    const result = await checkAIAvailability();
    expect(result.available).toBe(false);
    expect(result.needsDownload).toBe(false);
    expect(result.reason).toContain("chrome://flags");
  });

  it("works with legacy window.ai API (Chrome 138-149)", async () => {
    (globalThis as any).ai = {
      languageModel: { capabilities: vi.fn().mockResolvedValue({ available: "readily" }) },
    };
    const result = await checkAIAvailability();
    expect(result).toMatchObject({ available: true, needsDownload: false, reason: "" });
  });

  it("works with new LanguageModel API (Chrome 150+)", async () => {
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(),
    };
    const result = await checkAIAvailability();
    expect(result).toMatchObject({ available: true, needsDownload: false, reason: "" });
  });

  it("detects downloadable status (Chrome 150+)", async () => {
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: vi.fn(),
    };
    const result = await checkAIAvailability();
    expect(result.available).toBe(false);
    expect(result.needsDownload).toBe(true);
    expect(result.reason).toContain("LanguageModel.create()");
  });

  it("detects after-download status (legacy API)", async () => {
    (globalThis as any).ai = {
      languageModel: { capabilities: vi.fn().mockResolvedValue({ available: "after-download" }) },
    };
    const result = await checkAIAvailability();
    expect(result.available).toBe(false);
    expect(result.needsDownload).toBe(true);
  });

  it("prefers LanguageModel over window.ai when both exist", async () => {
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(),
    };
    (globalThis as any).ai = {
      languageModel: { capabilities: vi.fn().mockResolvedValue({ available: "no" }) },
    };
    const result = await checkAIAvailability();
    expect(result.available).toBe(true);
  });

  it("returns error message on failure", async () => {
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockRejectedValue(new Error("fail")),
      create: vi.fn(),
    };
    const result = await checkAIAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toContain("fail");
  });
});

describe("suggestGroups", () => {
  it("returns empty array when AI not available", async () => {
    const result = await suggestGroups([{ id: 1, title: "Test", url: "https://test.com" }]);
    expect(result).toEqual([]);
  });

  it("parses valid JSON response with new API", async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue(JSON.stringify([
        { group: "Development", indices: [0, 1] },
        { group: "Social", indices: [2] },
      ])),
      destroy: vi.fn(),
    };
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(mockSession),
    };

    const tabs = [
      { id: 10, title: "GitHub", url: "https://github.com" },
      { id: 20, title: "VS Code", url: "https://code.visualstudio.com" },
      { id: 30, title: "Twitter", url: "https://twitter.com" },
    ];
    const result = await suggestGroups(tabs);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ groupName: "Development", tabIds: [10, 20] });
    expect(result[1]).toMatchObject({ groupName: "Social", tabIds: [30] });
    expect(mockSession.destroy).toHaveBeenCalled();
  });

  it("parses valid JSON response with legacy API", async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue(JSON.stringify([
        { group: "Work", indices: [0] },
      ])),
      destroy: vi.fn(),
    };
    (globalThis as any).ai = {
      languageModel: {
        capabilities: vi.fn().mockResolvedValue({ available: "readily" }),
        create: vi.fn().mockResolvedValue(mockSession),
      },
    };

    const result = await suggestGroups([{ id: 1, title: "Test", url: "https://test.com" }]);
    expect(result).toHaveLength(1);
    expect(result[0].groupName).toBe("Work");
  });

  it("returns empty on invalid JSON response", async () => {
    const mockSession = { prompt: vi.fn().mockResolvedValue("not json"), destroy: vi.fn() };
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(mockSession),
    };
    const result = await suggestGroups([{ id: 1, title: "Test", url: "https://test.com" }]);
    expect(result).toEqual([]);
    expect(mockSession.destroy).toHaveBeenCalled();
  });

  it("filters out groups with no valid tab IDs", async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue(JSON.stringify([
        { group: "Valid", indices: [0] },
        { group: "Invalid", indices: [99] },
      ])),
      destroy: vi.fn(),
    };
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(mockSession),
    };
    const result = await suggestGroups([{ id: 1, title: "Test", url: "https://test.com" }]);
    expect(result).toHaveLength(1);
    expect(result[0].groupName).toBe("Valid");
  });
});
