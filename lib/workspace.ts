interface SavedWorkspace {
  tabs: { url: string; pinned: boolean }[];
  savedAt: number;
}

const WORKSPACE_KEY = "tabOrdo_workspace";

export async function focusMode(): Promise<number> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const toSave = tabs.filter((t) => t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"));
  const workspace: SavedWorkspace = {
    tabs: toSave.map((t) => ({ url: t.url!, pinned: t.pinned })),
    savedAt: Date.now(),
  };
  await chrome.storage.local.set({ [WORKSPACE_KEY]: workspace });
  await chrome.tabs.create({ active: true });
  await chrome.tabs.remove(toSave.map((t) => t.id!));
  return toSave.length;
}

export async function unfocusMode(): Promise<number> {
  const data = await chrome.storage.local.get(WORKSPACE_KEY);
  const workspace = data[WORKSPACE_KEY] as SavedWorkspace | undefined;
  if (!workspace || workspace.tabs.length === 0) return 0;
  for (const t of workspace.tabs) {
    await chrome.tabs.create({ url: t.url, pinned: t.pinned, active: false });
  }
  await chrome.storage.local.remove(WORKSPACE_KEY);
  return workspace.tabs.length;
}

export async function hasSavedWorkspace(): Promise<boolean> {
  const data = await chrome.storage.local.get(WORKSPACE_KEY);
  return !!data[WORKSPACE_KEY];
}

export function exportTabsToFile(): void {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const sorted = tabs
      .filter((t) => t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"))
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    const lines = sorted.map((t) => `${t.title}\t${t.url}`);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tabs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

export async function loadTabsFromText(text: string): Promise<number> {
  const lines = text.split("\n").filter((l) => l.trim());
  const urls = lines.map((l) => {
    const parts = l.split("\t");
    const candidate = parts.length > 1 ? parts[parts.length - 1].trim() : parts[0].trim();
    return candidate;
  }).filter((u) => u.startsWith("http"));

  if (urls.length === 0) return 0;

  const MAX_BYTES = 2 * 1024 * 1024;
  const encoder = new TextEncoder();
  let totalBytes = 0;
  const capped: string[] = [];
  for (const u of urls) {
    totalBytes += encoder.encode(u).length;
    if (totalBytes > MAX_BYTES) break;
    capped.push(u);
  }

  const win = await chrome.windows.create({ url: capped[0] });
  for (let i = 1; i < capped.length; i++) {
    const tab = await chrome.tabs.create({ windowId: win.id!, url: capped[i], active: false });
    await chrome.tabs.discard(tab.id!).catch(() => {});
  }
  return capped.length;
}
