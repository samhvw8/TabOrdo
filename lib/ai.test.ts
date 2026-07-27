import { describe, it, expect } from "vitest";
import { parseSuggestionJson } from "./ai.ts";

const GROUPS = [{ group: "Work", indices: [0, 1] }];

describe("parseSuggestionJson", () => {
  it("parses a plain array", () => {
    expect(parseSuggestionJson(JSON.stringify(GROUPS))).toEqual(GROUPS);
  });

  it("strips a ```json fence", () => {
    expect(parseSuggestionJson("```json\n" + JSON.stringify(GROUPS) + "\n```")).toEqual(GROUPS);
  });

  it("strips a bare ``` fence", () => {
    expect(parseSuggestionJson("```\n" + JSON.stringify(GROUPS) + "\n```")).toEqual(GROUPS);
  });

  it("pulls the array out of surrounding prose", () => {
    expect(parseSuggestionJson("Here you go:\n" + JSON.stringify(GROUPS) + "\nHope that helps!"))
      .toEqual(GROUPS);
  });

  // The model ignores "respond with an array" often enough that these shapes were the most
  // common cause of a spurious "AI found no groups to suggest".
  it("unwraps an object wrapping the array", () => {
    expect(parseSuggestionJson(JSON.stringify({ groups: GROUPS }))).toEqual(GROUPS);
  });

  it("wraps a single bare group object", () => {
    const one = { group: "Work", indices: [0, 1] };
    expect(parseSuggestionJson(JSON.stringify(one))).toEqual([one]);
  });

  it("flattens a doubly-nested array", () => {
    expect(parseSuggestionJson(JSON.stringify([GROUPS]))).toEqual(GROUPS);
  });

  it("does not mistake a single group's indices for the group list", () => {
    const one = { group: "Work", indices: [3, 4] };
    expect(parseSuggestionJson(JSON.stringify(one))).toEqual([one]);
  });

  it("returns null for unusable output", () => {
    expect(parseSuggestionJson("I could not group these tabs.")).toBeNull();
    expect(parseSuggestionJson("")).toBeNull();
  });

  it("does not pollute the prototype", () => {
    parseSuggestionJson('[{"__proto__":{"polluted":true}}]');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
