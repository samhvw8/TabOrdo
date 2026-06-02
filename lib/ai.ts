import { addRule, domainMatches } from "./rules.ts";
import { getFullHostname } from "./tabs.ts";

export type AIStatus =
  | "unsupported"
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

export const MIN_CHROME_VERSION = 138;

const TAB_GROUP_COLORS = [
  "blue", "cyan", "green", "yellow", "orange", "pink", "purple", "red", "grey",
] as const;

export interface AISuggestedRule {
  name: string;
  color: chrome.tabGroups.ColorEnum;
  patterns: string[];
}

declare const LanguageModel: {
  availability(opts?: unknown): Promise<AIStatus>;
  create(opts?: unknown): Promise<{
    prompt(input: string, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<string>;
    promptStreaming(input: string, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): AsyncIterable<string>;
    destroy?(): void;
  }>;
};

export function getChromeVersion(): number {
  const m = navigator.userAgent.match(/Chrome\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function hasLanguageModel(): boolean {
  return typeof (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel !== "undefined";
}

export async function getAIStatus(): Promise<{ status: AIStatus; reason?: string }> {
  const version = getChromeVersion();
  if (version > 0 && version < MIN_CHROME_VERSION) {
    return {
      status: "unsupported",
      reason: `Requires Chrome ${MIN_CHROME_VERSION}+ (detected ${version}).`,
    };
  }
  if (!hasLanguageModel()) {
    return {
      status: "unsupported",
      reason: "Built-in LanguageModel API not exposed in this browser build.",
    };
  }
  try {
    const status = await LanguageModel.availability();
    return { status };
  } catch (e) {
    return { status: "unsupported", reason: (e as Error).message };
  }
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          color: { type: "string", enum: [...TAB_GROUP_COLORS] },
          patterns: { type: "array", items: { type: "string" } },
        },
        required: ["name", "color", "patterns"],
      },
    },
  },
  required: ["rules"],
};

const SYSTEM_PROMPT =
  "You organize browser tabs into topical groups. " +
  "Given a list of `domain: example titles` lines, produce 3 to 8 group rules. " +
  "Each rule: a SHORT topic name (1-2 words like \"Work\", \"AI Research\", \"Shopping\"), " +
  "a color from the allowed enum, and a list of domain patterns (use the exact domains from input). " +
  "Cluster related domains under one theme. Skip lone domains that don't fit. " +
  "Pick distinct colors when possible. Output JSON only.";

interface HostSummary {
  host: string;
  titles: string[];
}

function summarizeTabs(tabs: chrome.tabs.Tab[], maxHosts = 60): string {
  const byHost = new Map<string, HostSummary>();
  for (const t of tabs) {
    if (!t.url || t.url.startsWith("chrome://") || t.url.startsWith("chrome-extension://")) continue;
    const host = getFullHostname(t.url);
    if (!host) continue;
    const existing = byHost.get(host) ?? { host, titles: [] };
    if (t.title && existing.titles.length < 3) existing.titles.push(t.title);
    byHost.set(host, existing);
  }
  return [...byHost.values()]
    .slice(0, maxHosts)
    .map((h) => `${h.host}: ${h.titles.join(" | ") || "(no title)"}`)
    .join("\n");
}

function sanitizeRule(raw: AISuggestedRule): AISuggestedRule | null {
  const name = (raw.name || "").trim().slice(0, 40);
  const patterns = Array.isArray(raw.patterns)
    ? raw.patterns.map((p) => (p || "").trim()).filter(Boolean)
    : [];
  if (!name || patterns.length === 0) return null;
  const color = (TAB_GROUP_COLORS as readonly string[]).includes(raw.color)
    ? raw.color
    : "blue";
  return { name, color: color as chrome.tabGroups.ColorEnum, patterns };
}

function buildUserPrompt(summary: string, hint?: string): string {
  const trimmedHint = hint?.trim();
  const hintLine = trimmedHint ? `\n\nAdditional guidance from the user: ${trimmedHint}` : "";
  return `Open tabs:\n${summary}\n\nReturn JSON with rules.${hintLine}`;
}

// Extracts every COMPLETE JSON object inside the `"rules"` array of a partial
// JSON buffer. Used to surface streamed rules to the UI before the whole
// response has arrived.
function extractCompleteRuleObjects(buffer: string): AISuggestedRule[] {
  const arrStart = buffer.indexOf("[", buffer.indexOf("\"rules\""));
  if (arrStart < 0) return [];
  const objs: string[] = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let escape = false;
  for (let i = arrStart + 1; i < buffer.length; i++) {
    const c = buffer[i];
    if (escape) { escape = false; continue; }
    if (inStr) {
      if (c === "\\") escape = true;
      else if (c === "\"") inStr = false;
      continue;
    }
    if (c === "\"") { inStr = true; continue; }
    if (c === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        objs.push(buffer.slice(objStart, i + 1));
        objStart = -1;
      }
    } else if (c === "]" && depth === 0) {
      break;
    }
  }
  const out: AISuggestedRule[] = [];
  for (const s of objs) {
    try {
      const parsed = JSON.parse(s) as AISuggestedRule;
      const clean = sanitizeRule(parsed);
      if (clean) out.push(clean);
    } catch {
      // Object isn't fully complete yet — skip; next pass will pick it up.
    }
  }
  return out;
}

export async function suggestRulesFromTabs(
  hint?: string,
  signal?: AbortSignal,
): Promise<AISuggestedRule[]> {
  const out: AISuggestedRule[] = [];
  for await (const rule of suggestRulesStreaming(hint, signal)) {
    out.push(rule);
  }
  return out;
}

export async function* suggestRulesStreaming(
  hint?: string,
  signal?: AbortSignal,
): AsyncGenerator<AISuggestedRule> {
  const tabs = await chrome.tabs.query({});
  const summary = summarizeTabs(tabs);
  if (!summary) return;

  const session = await LanguageModel.create({
    initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    temperature: 0.2,
    topK: 3,
  });

  try {
    const stream = session.promptStreaming(
      buildUserPrompt(summary, hint),
      { responseConstraint: RESPONSE_SCHEMA, signal },
    );

    let buffer = "";
    let emitted = 0;
    for await (const chunk of stream) {
      buffer += chunk;
      const ready = extractCompleteRuleObjects(buffer);
      while (emitted < ready.length) {
        yield ready[emitted];
        emitted++;
      }
    }

    // Final pass — catches the last object whose closing brace lands on the
    // tail chunk after our incremental parser bailed.
    try {
      const finalParsed = JSON.parse(buffer) as { rules?: AISuggestedRule[] };
      const rules = Array.isArray(finalParsed.rules) ? finalParsed.rules : [];
      const clean = rules.map(sanitizeRule).filter((r): r is AISuggestedRule => r !== null);
      while (emitted < clean.length) {
        yield clean[emitted];
        emitted++;
      }
    } catch {
      // Buffer not valid JSON overall; whatever we already yielded is the best
      // we have.
    }
  } finally {
    session.destroy?.();
  }
}

export interface TabMatch {
  tabId: number;
  title: string;
  host: string;
  favIconUrl?: string;
}

export async function previewMatchingTabs(patterns: string[]): Promise<TabMatch[]> {
  if (patterns.length === 0) return [];
  const tabs = await chrome.tabs.query({});
  const out: TabMatch[] = [];
  for (const t of tabs) {
    if (!t.id || !t.url) continue;
    if (t.url.startsWith("chrome://") || t.url.startsWith("chrome-extension://")) continue;
    const host = getFullHostname(t.url);
    if (!host) continue;
    const hit = patterns.some((p) => domainMatches(host, p));
    if (!hit) continue;
    out.push({
      tabId: t.id,
      title: t.title || host,
      host,
      favIconUrl: t.favIconUrl,
    });
  }
  return out;
}

export async function approveRule(suggestion: AISuggestedRule): Promise<void> {
  await addRule({
    name: suggestion.name,
    color: suggestion.color,
    patterns: Array.from(new Set(suggestion.patterns)),
  });
}
