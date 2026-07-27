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

const AI_PROGRESS_KEY = "tabOrdo_aiGroupProgress";

export function defaultProgress(): AIGroupProgress {
  return { status: "idle", total: 0, processed: 0, currentTab: "", grouped: 0, groupCount: 0, error: "" };
}

export async function getAIProgress(): Promise<AIGroupProgress> {
  try {
    const data = await chrome.storage.session.get(AI_PROGRESS_KEY);
    return data[AI_PROGRESS_KEY] ?? defaultProgress();
  } catch { return defaultProgress(); }
}

export async function setAIProgress(progress: AIGroupProgress): Promise<void> {
  await chrome.storage.session.set({ [AI_PROGRESS_KEY]: progress });
}

// Chrome 150+ moved from window.ai.languageModel to global LanguageModel class.
// Chrome 138-149 used window.ai.languageModel. Support both.
function getAPI(): { create: (opts?: any) => Promise<any>; availability: () => Promise<string> } | null {
  const LM = (globalThis as any).LanguageModel;
  if (LM?.create && LM?.availability) {
    return { create: (opts) => LM.create(opts), availability: () => LM.availability() };
  }
  const ai = (globalThis as any).ai;
  if (ai?.languageModel) {
    return {
      create: (opts) => ai.languageModel.create(opts),
      availability: async () => {
        const caps = await ai.languageModel.capabilities();
        if (caps.available === "readily") return "available";
        if (caps.available === "after-download") return "downloadable";
        return "unavailable";
      },
    };
  }
  return null;
}

async function isPromptAPIAvailable(): Promise<boolean> {
  try {
    const api = getAPI();
    if (!api) return false;
    const status = await api.availability();
    return status === "available" || status === "readily";
  } catch {
    return false;
  }
}

async function createSession(): Promise<any> {
  const api = getAPI()!;
  return api.create({
    systemPrompt: "You are a tab organizer. Given a list of browser tabs (title + URL), suggest logical groups. Respond ONLY with valid JSON array of objects: [{\"group\": \"name\", \"indices\": [0,1,2]}]. Use short, descriptive group names (2-3 words max). Group by topic/purpose, not just domain.",
  });
}

export async function checkAIAvailability(): Promise<{ available: boolean; needsDownload: boolean; reason: string }> {
  try {
    const api = getAPI();
    if (!api) {
      return {
        available: false,
        needsDownload: false,
        reason: "Enable in chrome://flags → #prompt-api-for-gemini-nano → Enabled, then restart Chrome",
      };
    }
    const status = await api.availability();
    if (status === "available" || status === "readily") {
      return { available: true, needsDownload: false, reason: "" };
    }
    if (status === "downloadable" || status === "after-download") {
      return {
        available: false,
        needsDownload: true,
        reason: "AI model needs download. Run: LanguageModel.create() in DevTools console to trigger it, then wait ~2min",
      };
    }
    return {
      available: false,
      needsDownload: false,
      reason: `AI status: ${status}. Enable #optimization-guide-on-device-model in chrome://flags`,
    };
  } catch (e) {
    return {
      available: false,
      needsDownload: false,
      reason: `AI error: ${e instanceof Error ? e.message : "unknown"}. Try enabling chrome://flags → #prompt-api-for-gemini-nano`,
    };
  }
}

// Gemini Nano frequently wraps its answer in a ```json fence or adds a sentence of
// preamble. Pull out the first bracketed array instead of feeding raw text to JSON.parse,
// which would throw and be swallowed as "no groups found".
//
// It also ignores "respond with an array" often enough to matter: {"groups": [...]}, a bare
// single group, and [[...]] all arrive in practice. Coerce those to the array the caller
// expects rather than reporting no groups.
function coerceToSuggestions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length === 1 && Array.isArray(value[0]) ? value[0] : value;
  }
  if (value && typeof value === "object") {
    // Check the single-group shape first: {"group":"A","indices":[0]} also contains an
    // array, and scanning for one would return the indices instead of the group.
    if ("group" in value) return [value];
    const wrapped = Object.values(value as Record<string, unknown>).find(Array.isArray);
    if (wrapped) return wrapped;
  }
  return null;
}

export function parseSuggestionJson(response: string): unknown {
  const cleaned = response.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    const coerced = coerceToSuggestions(JSON.parse(cleaned));
    if (coerced) return coerced;
  } catch {}
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    return coerceToSuggestions(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export async function suggestGroups(
  tabs: { id: number; title: string; url: string }[]
): Promise<AIGroupSuggestion[]> {
  if (!(await isPromptAPIAvailable())) return [];

  const tabList = tabs.map((t, i) => `${i}. ${t.title} | ${t.url}`).join("\n");
  const prompt = `Group these browser tabs:\n${tabList}`;

  const session = await createSession();
  try {
    const response = await session.prompt(prompt);
    const parsed = parseSuggestionJson(response);
    if (!Array.isArray(parsed)) return [];

    const colors = ["blue", "cyan", "green", "yellow", "orange", "pink", "purple", "red"];
    return parsed.map((g: any, i: number) => ({
      groupName: String(g?.group || "Group"),
      color: colors[i % colors.length],
      tabIds: (Array.isArray(g?.indices) ? g.indices : [])
        .map((idx: number) => tabs[idx]?.id)
        .filter((id: number | undefined): id is number => id !== undefined),
    })).filter((g: AIGroupSuggestion) => g.tabIds.length > 0);
  } catch {
    return [];
  } finally {
    session.destroy();
  }
}

export async function suggestTabSummary(title: string, url: string): Promise<string | null> {
  if (!(await isPromptAPIAvailable())) return null;
  const api = getAPI()!;
  const session = await api.create();
  try {
    return await session.prompt(`In 5 words or less, categorize this tab: "${title}" (${url})`);
  } catch {
    return null;
  } finally {
    session.destroy();
  }
}
