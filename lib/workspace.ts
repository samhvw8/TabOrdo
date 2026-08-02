interface SavedWorkspace {
  tabs: { url: string; pinned: boolean }[];
  savedAt: number;
}

// Pre-0.4.4 versions stored a single workspace under this key; folded into the stack on read.
const LEGACY_WORKSPACE_KEY = "tabOrdo_workspace";
const WORKSPACES_KEY = "tabOrdo_workspaces";

async function getWorkspaceStack(): Promise<SavedWorkspace[]> {
  const data = await chrome.storage.local.get([WORKSPACES_KEY, LEGACY_WORKSPACE_KEY]);
  const stored = data[WORKSPACES_KEY];
  const stack: SavedWorkspace[] = Array.isArray(stored) ? stored : [];
  const legacy = data[LEGACY_WORKSPACE_KEY] as SavedWorkspace | undefined;
  if (legacy && legacy.tabs.length > 0) stack.unshift(legacy);
  return stack;
}

async function saveWorkspaceStack(stack: SavedWorkspace[]): Promise<void> {
  await chrome.storage.local.set({ [WORKSPACES_KEY]: stack });
  await chrome.storage.local.remove(LEGACY_WORKSPACE_KEY);
}

export async function focusMode(): Promise<number> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const toSave = tabs.filter((t) => t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"));
  if (toSave.length === 0) return 0;
  const stack = await getWorkspaceStack();
  stack.push({
    tabs: toSave.map((t) => ({ url: t.url!, pinned: t.pinned })),
    savedAt: Date.now(),
  });
  // Persist before closing anything so a failure mid-close can never lose tabs.
  await saveWorkspaceStack(stack);
  await chrome.tabs.create({ active: true });
  await chrome.tabs.remove(toSave.map((t) => t.id!));
  return toSave.length;
}

export async function unfocusMode(): Promise<number> {
  const stack = await getWorkspaceStack();
  const workspace = stack.pop();
  if (!workspace) return 0;
  let restored = 0;
  for (const t of workspace.tabs) {
    try {
      await chrome.tabs.create({ url: t.url, pinned: t.pinned, active: false });
      restored++;
    } catch (e) {
      // One URL Chrome refuses to open (file://, view-source:) used to throw out of the loop,
      // so the popped stack was never persisted — and the retry reopened every tab that had
      // already come back, on top of itself.
      console.warn("[TabOrdo] unfocus: could not reopen", t.url, e);
    }
  }
  // Persist unconditionally: the workspace has been consumed either way, and leaving it on
  // the stack is what made a partial restore duplicate tabs.
  await saveWorkspaceStack(stack);
  return restored;
}

export async function hasSavedWorkspace(): Promise<boolean> {
  return (await getWorkspaceStack()).length > 0;
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
  // Always keep the first URL, even if it alone blows the cap. Otherwise capped was empty and
  // we opened a blank window before reporting "no valid URLs found".
  if (capped.length === 0) capped.push(urls[0]);

  const win = await chrome.windows.create({ url: capped[0] });
  for (let i = 1; i < capped.length; i++) {
    const tab = await chrome.tabs.create({ windowId: win.id!, url: capped[i], active: false });
    await chrome.tabs.discard(tab.id!).catch(() => {});
  }
  return capped.length;
}
