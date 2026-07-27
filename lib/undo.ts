export interface UndoEntry {
  type: string;
  label: string;
  timestamp: number;
  data: unknown;
}

interface ClosedTabData {
  url: string;
  pinned: boolean;
  windowId: number;
}

interface GroupAssignment {
  tabId: number;
  groupId: number;
  groupTitle?: string;
  groupColor?: string;
  // Optional: entries persisted by older versions have neither. /aigroup moves tabs across
  // windows, so restoring group membership alone left them stranded where the AI put them.
  windowId?: number;
  index?: number;
}

const UNDO_KEY = "tabOrdo_undoStack";
const stack: UndoEntry[] = [];
const MAX_STACK = 20;

function persistStack() {
  chrome.storage.session?.set({ [UNDO_KEY]: [...stack] }).catch(() => {});
}

export async function loadUndoStack(): Promise<void> {
  try {
    const data = await chrome.storage.session.get(UNDO_KEY);
    const loaded = data[UNDO_KEY];
    if (Array.isArray(loaded)) {
      stack.length = 0;
      stack.push(...loaded);
    }
  } catch {}
}

export function pushUndo(entry: UndoEntry) {
  stack.push(entry);
  if (stack.length > MAX_STACK) stack.shift();
  persistStack();
}

export function peekUndo(): UndoEntry | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

export function popUndo(): UndoEntry | null {
  const entry = stack.pop() || null;
  persistStack();
  return entry;
}

export function undoStackSize(): number {
  return stack.length;
}

export async function snapshotBeforeClose(tabIds: number[]): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const idSet = new Set(tabIds);
  const toClose = tabs.filter((t) => idSet.has(t.id!));
  snapshotClosedTabs(toClose);
}

export function snapshotClosedTabs(tabs: chrome.tabs.Tab[]): void {
  const data: ClosedTabData[] = tabs.map((t) => ({
    url: t.url || "",
    pinned: t.pinned,
    windowId: t.windowId,
  }));
  pushUndo({
    type: "close",
    label: `Closed ${data.length} tab(s)`,
    timestamp: Date.now(),
    data,
  });
}

export async function snapshotBeforeGroup(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const groups = await chrome.tabGroups.query({});
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const data: GroupAssignment[] = tabs
    .filter((t) => !t.pinned)
    .map((t) => {
      const g = groupMap.get(t.groupId);
      return {
        tabId: t.id!,
        groupId: t.groupId,
        groupTitle: g?.title,
        groupColor: g?.color,
        windowId: t.windowId,
        index: t.index,
      };
    });
  pushUndo({
    type: "group",
    label: "Group change",
    timestamp: Date.now(),
    data,
  });
}

export async function executeUndo(): Promise<string> {
  const entry = popUndo();
  if (!entry) return "Nothing to undo";

  switch (entry.type) {
    case "close": {
      const tabs = entry.data as ClosedTabData[];
      // The snapshot records where each tab lived; put it back there when that window still
      // exists instead of dumping every restored tab into whatever window is focused now.
      const openWindows = new Set<number>();
      try {
        for (const w of await chrome.windows.getAll()) {
          if (w.id !== undefined) openWindows.add(w.id);
        }
      } catch {}
      let reopened = 0;
      for (const t of tabs) {
        if (!t.url || t.url === "chrome://newtab/") continue;
        try {
          await chrome.tabs.create({
            url: t.url,
            pinned: t.pinned,
            active: false,
            ...(openWindows.has(t.windowId) ? { windowId: t.windowId } : {}),
          });
          reopened++;
        } catch {}
      }
      return `Reopened ${reopened} tab(s)`;
    }
    case "group": {
      const assignments = entry.data as GroupAssignment[];
      const currentTabs = await chrome.tabs.query({});
      const currentIds = new Set(currentTabs.map((t) => t.id));

      const grouped = assignments.filter((a) => a.groupId !== -1 && currentIds.has(a.tabId));

      const byGroup = new Map<string, { title: string; color: string; tabIds: number[] }>();
      for (const a of grouped) {
        const key = `${a.groupTitle || ""}:${a.groupColor || ""}`;
        if (!byGroup.has(key)) byGroup.set(key, { title: a.groupTitle || "", color: a.groupColor || "", tabIds: [] });
        byGroup.get(key)!.tabIds.push(a.tabId);
      }

      const allCurrentGrouped = currentTabs.filter((t) => t.groupId !== -1);
      if (allCurrentGrouped.length > 0) {
        await chrome.tabs.ungroup(allCurrentGrouped.map((t) => t.id!)).catch(() => {});
      }

      // Put tabs back in the window they came from before regrouping. /aigroup relocates tabs
      // across windows, and chrome.tabs.group rejects ids spanning windows anyway, so this has
      // to happen first. Ungrouping above frees them from their current group's block.
      const openWindows = new Set<number>();
      try {
        for (const w of await chrome.windows.getAll()) {
          if (w.id !== undefined) openWindows.add(w.id);
        }
      } catch {}
      const byTabId = new Map(currentTabs.map((t) => [t.id!, t]));
      const relocations = assignments
        .filter((a) => a.windowId !== undefined && currentIds.has(a.tabId) && openWindows.has(a.windowId))
        .filter((a) => {
          const t = byTabId.get(a.tabId);
          return !!t && (t.windowId !== a.windowId || t.index !== a.index);
        })
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const a of relocations) {
        await chrome.tabs
          .move(a.tabId, { windowId: a.windowId!, index: a.index ?? -1 })
          .catch(() => {});
      }

      for (const [, info] of byGroup) {
        if (info.tabIds.length === 0) continue;
        const validIds = info.tabIds.filter((id) => currentIds.has(id));
        if (validIds.length === 0) continue;
        const gid = await chrome.tabs.group({ tabIds: validIds });
        await chrome.tabGroups.update(gid, {
          title: info.title,
          color: info.color as chrome.tabGroups.ColorEnum,
        });
      }
      return "Restored previous group state";
    }
    default:
      return "Unknown undo type";
  }
}
