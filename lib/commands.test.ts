import { describe, it, expect } from "vitest";
import { matchCommands, ALL_COMMANDS, TRIAGE_COMMANDS } from "./commands.ts";

describe("matchCommands", () => {
  it("returns every visible command for bare /, omitting hidden aliases", () => {
    const cmds = matchCommands("/");
    expect(cmds.length).toBe(ALL_COMMANDS.filter((c) => !c.hidden).length);
    expect(cmds.some((c) => c.hidden)).toBe(false);
  });

  it("still resolves a hidden alias when it is typed out", () => {
    expect(matchCommands("/freeze").some((c) => c.prefix === "freeze")).toBe(true);
  });

  it("finds /readlater command", () => {
    const cmds = matchCommands("/readlater");
    expect(cmds.some((c) => c.prefix === "readlater")).toBe(true);
  });

  it("finds /recent command", () => {
    const cmds = matchCommands("/recent");
    expect(cmds.some((c) => c.prefix === "recent")).toBe(true);
  });

  it("finds /aigroup command", () => {
    const cmds = matchCommands("/aigroup");
    expect(cmds.some((c) => c.prefix === "aigroup")).toBe(true);
  });

  it("returns triage commands for bare @", () => {
    const cmds = matchCommands("@");
    expect(cmds.length).toBe(TRIAGE_COMMANDS.length);
  });

  it("finds @f frozen triage command", () => {
    const cmds = matchCommands("@f");
    expect(cmds.some((c) => c.prefix === "@f")).toBe(true);
  });

  it("fuzzy matches partial input", () => {
    const cmds = matchCommands("/read");
    expect(cmds.some((c) => c.prefix === "readlater")).toBe(true);
  });

  it("returns empty for non-command input", () => {
    const cmds = matchCommands("hello");
    expect(cmds).toHaveLength(0);
  });
});
