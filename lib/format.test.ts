import { describe, it, expect } from "vitest";
import { relTime } from "./format.ts";

describe("relTime", () => {
  const now = new Date(2026, 0, 15, 14, 30).getTime();

  it("says just now under a minute", () => {
    expect(relTime(now - 59_999, now)).toBe("just now");
  });

  it("counts whole minutes under an hour", () => {
    expect(relTime(now - 60_000, now)).toBe("1m ago");
    expect(relTime(now - 3_599_999, now)).toBe("59m ago");
  });

  it("shows the clock time from an hour on", () => {
    const ts = now - 3_600_000;
    expect(relTime(ts, now)).toBe(new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  });
});
