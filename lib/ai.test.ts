import { describe, it, expect, vi, afterEach } from "vitest";
import { suggestGroups, checkAIAvailability } from "./ai.ts";

const TABS = [
  { id: 11, title: "Svelte docs", url: "https://svelte.dev/docs" },
  { id: 12, title: "WXT guide", url: "https://wxt.dev/guide" },
  { id: 13, title: "Pasta recipe", url: "https://example.com/pasta" },
];

/** Cost of a prompt in the fake model: 100 tokens per listed tab, nothing else. */
const perTabLine = (input: string) => (input.match(/^\d+\. /gm)?.length ?? 0) * 100;

function stubModel(opts: { answer?: string; session?: Record<string, unknown> } = {}) {
  const session = {
    contextWindow: Infinity,
    contextUsage: 0,
    measureContextUsage: vi.fn(async (input: string, _options?: object) => perTabLine(input)),
    prompt: vi.fn(async (_input: string, _options?: object) => opts.answer ?? "[]"),
    destroy: vi.fn(),
    ...opts.session,
  };
  const LanguageModel = {
    availability: vi.fn(async (_options?: object) => "available"),
    create: vi.fn(async (_options: Record<string, unknown>) => session),
  };
  vi.stubGlobal("LanguageModel", LanguageModel);
  return { LanguageModel, session };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("suggestGroups", () => {
  // Chrome's create() has no systemPrompt member; WebIDL drops unknown members silently, so
  // the model never saw its instructions or the answer format.
  it("gives the model its instructions as a system message in initialPrompts", async () => {
    const { LanguageModel } = stubModel();
    await suggestGroups(TABS);
    const options = LanguageModel.create.mock.calls[0][0];
    expect(options).not.toHaveProperty("systemPrompt");
    expect(options.initialPrompts).toEqual([{ role: "system", content: expect.stringContaining("group") }]);
  });

  it("constrains the answer to a JSON schema of groups", async () => {
    const { session } = stubModel();
    await suggestGroups(TABS);
    expect(session.prompt).toHaveBeenCalledWith(expect.any(String), {
      responseConstraint: expect.objectContaining({
        type: "array",
        items: expect.objectContaining({ required: ["group", "indices"] }),
      }),
    });
  });

  it("maps the model's indices back to tab ids", async () => {
    stubModel({ answer: '[{"group":"Dev","indices":[0,1]},{"group":"Food","indices":[2]}]' });
    expect(await suggestGroups(TABS)).toEqual({
      suggestions: [
        { groupName: "Dev", color: "blue", tabIds: [11, 12] },
        { groupName: "Food", color: "cyan", tabIds: [13] },
      ],
      omitted: 0,
    });
  });

  it("ignores indices that name no tab and drops the groups left empty", async () => {
    stubModel({ answer: '[{"group":"Ghost","indices":[7]},{"group":"Dev","indices":[0,9,1]}]' });
    const { suggestions } = await suggestGroups(TABS);
    expect(suggestions).toEqual([{ groupName: "Dev", color: "blue", tabIds: [11, 12] }]);
  });

  it("reports an answer that isn't a group list as an error, not as 'no groups'", async () => {
    stubModel({ answer: '{"groups":[]}' });
    await expect(suggestGroups(TABS)).rejects.toThrow(/couldn't read/);
    stubModel({ answer: "Sure! Here are your groups" });
    await expect(suggestGroups(TABS)).rejects.toThrow(/couldn't read/);
  });

  it("lets a failed prompt surface and still destroys the session", async () => {
    const { session } = stubModel({
      session: { prompt: vi.fn(async () => { throw new Error("model crashed"); }) },
    });
    await expect(suggestGroups(TABS)).rejects.toThrow("model crashed");
    expect(session.destroy).toHaveBeenCalled();
  });

  it("lists only the tabs that fit the context window left after the system prompt", async () => {
    // 50 already used by the system prompt leaves 250: room for two 100-token tabs.
    const { session } = stubModel({
      answer: '[{"group":"Dev","indices":[0,1]}]',
      session: { contextWindow: 300, contextUsage: 50 },
    });
    const result = await suggestGroups(TABS);
    const sent = session.prompt.mock.calls[0][0];
    expect(sent).toContain("Svelte docs");
    expect(sent).toContain("WXT guide");
    expect(sent).not.toContain("Pasta recipe");
    expect(result).toEqual({ suggestions: [{ groupName: "Dev", color: "blue", tabIds: [11, 12] }], omitted: 1 });
    // The schema is sent with the prompt, so it has to be in the measurement too.
    expect(session.measureContextUsage).toHaveBeenLastCalledWith(sent, {
      responseConstraint: expect.objectContaining({ type: "array" }),
    });
  });

  it("falls back to the input* names on Chrome versions before the context* rename", async () => {
    const measureInputUsage = vi.fn(async (input: string) => perTabLine(input));
    stubModel({
      session: {
        contextWindow: undefined,
        contextUsage: undefined,
        measureContextUsage: undefined,
        inputQuota: 250,
        inputUsage: 0,
        measureInputUsage,
      },
    });
    const { omitted } = await suggestGroups(TABS);
    expect(omitted).toBe(1);
    expect(measureInputUsage).toHaveBeenCalled();
  });

  it("fails loudly when not even two tabs fit", async () => {
    const { session } = stubModel({ session: { contextWindow: 150 } });
    await expect(suggestGroups(TABS)).rejects.toThrow(/context/);
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it("clips a huge title or URL so one tab can't crowd out the rest", async () => {
    const { session } = stubModel();
    const huge = "https://example.com/?q=" + "x".repeat(5000);
    await suggestGroups([...TABS, { id: 14, title: "T".repeat(5000), url: huge }]);
    const sent = session.prompt.mock.calls[0][0];
    expect(sent).not.toContain(huge);
    expect(sent).not.toContain("T".repeat(500));
    expect(sent.length).toBeLessThan(1000);
  });
});

describe("checkAIAvailability", () => {
  it("asks about the same text-in, text-out session that suggestGroups creates", async () => {
    const { LanguageModel } = stubModel();
    await suggestGroups(TABS);
    expect(await checkAIAvailability()).toEqual({ available: true, reason: "" });
    const { initialPrompts: _, ...createCore } = LanguageModel.create.mock.calls[0][0];
    expect(LanguageModel.availability).toHaveBeenCalledWith(createCore);
    expect(createCore.expectedOutputs).toEqual([{ type: "text", languages: ["en"] }]);
  });

  it("explains a missing Prompt API", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const result = await checkAIAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/chrome:\/\/flags/);
  });

  it("tells a model still downloading apart from one that needs enabling", async () => {
    const { LanguageModel } = stubModel();
    LanguageModel.availability.mockResolvedValue("downloading");
    const result = await checkAIAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/downloading/);
    expect(result.reason).not.toMatch(/flags/);
  });
});
