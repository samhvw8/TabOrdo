import { AI_LEASE_MS } from "./bulklock.ts";

interface AIGroupSuggestion {
  groupName: string;
  color: string;
  tabIds: number[];
}

export interface AIGroupProgress {
  status: "idle" | "checking" | "prompting" | "grouping" | "done" | "error";
  total: number;
  processed: number;
  currentTab: string;
  grouped: number;
  groupCount: number;
  error: string;
}

/** What setAIProgress writes: the progress plus when it was written. */
type StoredProgress = AIGroupProgress & { startedAt: number };

export const AI_PROGRESS_KEY = "tabOrdo_aiGroupProgress";

const IN_FLIGHT: ReadonlySet<AIGroupProgress["status"]> = new Set(["checking", "prompting", "grouping"]);

export function defaultProgress(): AIGroupProgress {
  return { status: "idle", total: 0, processed: 0, currentTab: "", grouped: 0, groupCount: 0, error: "" };
}

export async function getAIProgress(): Promise<AIGroupProgress> {
  try {
    const data = await chrome.storage.session.get(AI_PROGRESS_KEY);
    const progress = data[AI_PROGRESS_KEY] as StoredProgress | undefined;
    if (!progress) return defaultProgress();
    // The on-device prompt is the one stretch of a run that makes no chrome.* calls, so an MV3
    // worker torn down mid-prompt leaves an in-flight record with nobody left to finish it —
    // and runAIGroup refuses to start while one is there, until the browser restarts. Age it
    // out on the same lease the run holds the bulk lock for.
    if (IN_FLIGHT.has(progress.status) && Date.now() - progress.startedAt > AI_LEASE_MS) {
      return defaultProgress();
    }
    return progress;
  } catch { return defaultProgress(); }
}

export async function setAIProgress(progress: AIGroupProgress): Promise<void> {
  const record: StoredProgress = { ...progress, startedAt: Date.now() };
  await chrome.storage.session.set({ [AI_PROGRESS_KEY]: record });
}

/** The slice of Chrome's Prompt API used here. Older Chrome only has the input* names for the
 *  context members; newer Chrome renames them to context* and keeps the old names as
 *  deprecated aliases in extensions. */
interface LanguageModelSession {
  prompt(input: string, options: PromptOptions): Promise<string>;
  measureContextUsage?(input: string, options: PromptOptions): Promise<number>;
  measureInputUsage?(input: string, options: PromptOptions): Promise<number>;
  readonly contextWindow?: number;
  readonly contextUsage?: number;
  readonly inputQuota?: number;
  readonly inputUsage?: number;
  destroy(): void;
}

interface PromptOptions {
  responseConstraint: object;
}

interface LanguageModelAPI {
  availability(options: typeof SESSION_OPTIONS): Promise<string>;
  create(options: typeof SESSION_OPTIONS & { initialPrompts: { role: "system"; content: string }[] }): Promise<LanguageModelSession>;
}

function getAPI(): LanguageModelAPI | undefined {
  return (globalThis as { LanguageModel?: LanguageModelAPI }).LanguageModel;
}

// Declared so availability() is asked about the session create() will actually make, and so
// Chrome doesn't warn about a missing output language. It doesn't filter what the model
// reads: non-English tab titles still go in.
const SESSION_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

const SYSTEM_PROMPT = "You are a tab organizer. Given a list of browser tabs (title + URL), suggest logical groups. Respond ONLY with valid JSON array of objects: [{\"group\": \"name\", \"indices\": [0,1,2]}]. Use short, descriptive group names (2-3 words max). Group by topic/purpose, not just domain.";

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      group: { type: "string" },
      indices: { type: "array", items: { type: "integer" } },
    },
    required: ["group", "indices"],
    additionalProperties: false,
  },
};

const PROMPT_OPTIONS: PromptOptions = { responseConstraint: RESPONSE_SCHEMA };

const COLORS = ["blue", "cyan", "green", "yellow", "orange", "pink", "purple", "red"];

// One tab with a huge title or URL (a data: URL, a tracking-laden link) would otherwise eat
// the context budget and push every tab after it out of the prompt.
const MAX_FIELD_CHARS = 150;

function clip(text: string): string {
  return text.length > MAX_FIELD_CHARS ? `${text.slice(0, MAX_FIELD_CHARS)}…` : text;
}

function buildPrompt(tabs: { title: string; url: string }[], count: number): string {
  const lines = tabs.slice(0, count).map((t, i) => `${i}. ${clip(t.title)} | ${clip(t.url)}`);
  return `Group these browser tabs:\n${lines.join("\n")}`;
}

/**
 * How many tabs, from the front of the list, fit in what's left of the session's context
 * window. Chrome holds the answer's room back from the window it reports, so the prompt may
 * use all of it; past it, prompt() rejects instead of answering.
 */
async function fitTabCount(session: LanguageModelSession, tabs: { title: string; url: string }[]): Promise<number> {
  const contextWindow = session.contextWindow ?? session.inputQuota ?? Infinity;
  const budget = contextWindow - (session.contextUsage ?? session.inputUsage ?? 0);
  if (!Number.isFinite(budget)) return tabs.length;
  const measure = (input: string) => session.measureContextUsage
    ? session.measureContextUsage(input, PROMPT_OPTIONS)
    : session.measureInputUsage!(input, PROMPT_OPTIONS);

  let count = tabs.length;
  let used = await measure(buildPrompt(tabs, count));
  while (used > budget && count > 0) {
    // Cost grows about linearly with tab count, so one proportional cut usually lands; the
    // minus-one keeps the loop shrinking when that estimate is still over.
    count = Math.min(count - 1, Math.floor((count * budget) / used));
    used = await measure(buildPrompt(tabs, count));
  }
  return count;
}

export async function checkAIAvailability(): Promise<{ available: boolean; reason: string }> {
  try {
    const api = getAPI();
    if (!api) {
      return {
        available: false,
        reason: "Enable in chrome://flags → #prompt-api-for-gemini-nano → Enabled, then restart Chrome",
      };
    }
    const status = await api.availability(SESSION_OPTIONS);
    if (status === "available") {
      return { available: true, reason: "" };
    }
    if (status === "downloadable") {
      return {
        available: false,
        reason: "AI model needs download. Run: LanguageModel.create() in DevTools console to trigger it, then wait ~2min",
      };
    }
    if (status === "downloading") {
      return { available: false, reason: "The AI model is still downloading. Try again in a few minutes" };
    }
    return {
      available: false,
      reason: `AI status: ${status}. Enable #optimization-guide-on-device-model in chrome://flags`,
    };
  } catch (e) {
    return {
      available: false,
      reason: `AI error: ${e instanceof Error ? e.message : "unknown"}. Try enabling chrome://flags → #prompt-api-for-gemini-nano`,
    };
  }
}

// responseConstraint holds the model to RESPONSE_SCHEMA, so anything else means the
// constraint didn't take. Say so rather than reporting that no groups were found.
function parseSuggestions(response: string, tabs: { id: number }[]): AIGroupSuggestion[] {
  let parsed: unknown;
  try { parsed = JSON.parse(response); } catch { parsed = undefined; }
  if (!Array.isArray(parsed)) throw new Error("The on-device AI gave an answer TabOrdo couldn't read");

  return parsed
    .filter((g): g is { group: string; indices: number[] } =>
      typeof g?.group === "string" && Array.isArray(g?.indices))
    .map((g) => ({
      groupName: g.group.trim() || "Group",
      tabIds: g.indices
        .map((idx) => tabs[idx]?.id)
        .filter((id): id is number => id !== undefined),
    }))
    .filter((g) => g.tabIds.length > 0)
    .map((g, i) => ({ ...g, color: COLORS[i % COLORS.length] }));
}

export interface AIGroupResult {
  suggestions: AIGroupSuggestion[];
  /** Tabs left off the end of the prompt because the model's context window couldn't hold them. */
  omitted: number;
}

/** Callers check checkAIAvailability() first. Rejects on any model failure. */
export async function suggestGroups(
  tabs: { id: number; title: string; url: string }[]
): Promise<AIGroupResult> {
  const session = await getAPI()!.create({
    ...SESSION_OPTIONS,
    initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
  });
  try {
    const count = await fitTabCount(session, tabs);
    if (count < 2) throw new Error("The on-device AI's context window can't fit two of these tabs");
    const response = await session.prompt(buildPrompt(tabs, count), PROMPT_OPTIONS);
    return { suggestions: parseSuggestions(response, tabs.slice(0, count)), omitted: tabs.length - count };
  } finally {
    session.destroy();
  }
}
