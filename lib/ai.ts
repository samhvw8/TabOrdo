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

export async function suggestGroups(
  tabs: { id: number; title: string; url: string }[]
): Promise<AIGroupSuggestion[]> {
  if (!(await isPromptAPIAvailable())) return [];

  const tabList = tabs.map((t, i) => `${i}. ${t.title} | ${t.url}`).join("\n");
  const prompt = `Group these browser tabs:\n${tabList}`;

  const session = await createSession();
  try {
    const response = await session.prompt(prompt);
    const parsed = JSON.parse(response);
    if (!Array.isArray(parsed)) return [];

    const colors = ["blue", "cyan", "green", "yellow", "orange", "pink", "purple", "red"];
    return parsed.map((g: any, i: number) => ({
      groupName: String(g.group || "Group"),
      color: colors[i % colors.length],
      tabIds: (g.indices as number[]).map((idx) => tabs[idx]?.id).filter(Boolean),
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
