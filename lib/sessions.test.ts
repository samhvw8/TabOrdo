import { describe, it, expect, beforeEach, vi } from "vitest";
import { getRecentlyClosed } from "./sessions.ts";

beforeEach(() => {
  globalThis.chrome = {
    sessions: {
      getRecentlyClosed: vi.fn(),
      restore: vi.fn(),
    },
  } as unknown as typeof chrome;
});

describe("getRecentlyClosed", () => {
  it("returns tabs from closed individual tabs", async () => {
    vi.mocked(chrome.sessions.getRecentlyClosed).mockResolvedValue([
      { tab: { sessionId: "s1", title: "Tab A", url: "https://a.com", favIconUrl: "https://a.com/icon.png" } },
      { tab: { sessionId: "s2", title: "Tab B", url: "https://b.com" } },
    ] as any);

    const results = await getRecentlyClosed();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ type: "history", title: "Tab A", url: "https://a.com" });
    expect(results[1]).toMatchObject({ type: "history", title: "Tab B", url: "https://b.com" });
  });

  it("extracts tabs from closed windows", async () => {
    vi.mocked(chrome.sessions.getRecentlyClosed).mockResolvedValue([
      {
        window: {
          sessionId: "w1",
          tabs: [
            { sessionId: "t1", title: "Win Tab 1", url: "https://c.com" },
            { sessionId: "t2", title: "Win Tab 2", url: "https://d.com" },
          ],
        },
      },
    ] as any);

    const results = await getRecentlyClosed();
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("session-win-t1");
    expect(results[1].id).toBe("session-win-t2");
  });

  it("handles mixed tabs and windows", async () => {
    vi.mocked(chrome.sessions.getRecentlyClosed).mockResolvedValue([
      { tab: { sessionId: "s1", title: "Solo", url: "https://solo.com" } },
      { window: { sessionId: "w1", tabs: [{ sessionId: "wt1", title: "From Win", url: "https://win.com" }] } },
    ] as any);

    const results = await getRecentlyClosed();
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("session-tab-s1");
    expect(results[1].id).toBe("session-win-wt1");
  });

  it("returns empty array when no recent sessions", async () => {
    vi.mocked(chrome.sessions.getRecentlyClosed).mockResolvedValue([] as any);
    const results = await getRecentlyClosed();
    expect(results).toHaveLength(0);
  });

  it("passes maxResults to the API", async () => {
    vi.mocked(chrome.sessions.getRecentlyClosed).mockResolvedValue([] as any);
    await getRecentlyClosed(10);
    expect(chrome.sessions.getRecentlyClosed).toHaveBeenCalledWith({ maxResults: 10 });
  });
});
