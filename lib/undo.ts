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
}

const stack: UndoEntry[] = [];
const MAX_STACK = 20;

export function pushUndo(entry: UndoEntry) {
  stack.push(entry);
  if (stack.length > MAX_STACK) stack.shift();
}

export function peekUndo(): UndoEntry | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

export function popUndo(): UndoEntry | null {
  return stack.pop() || null;
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
      let reopened = 0;
      for (const t of tabs) {
        if (!t.url || t.url === "chrome://newtab/") continue;
        try {
          await chrome.tabs.create({ url: t.url, pinned: t.pinned, active: false });
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
      const ungroupedIds = assignments.filter((a) => a.groupId === -1 && currentIds.has(a.tabId)).map((a) => a.tabId);

      if (ungroupedIds.length > 0) {
        await chrome.tabs.ungroup(ungroupedIds);
      }

      const byGroup = new Map<string, { title: string; color: string; tabIds: number[] }>();
      for (const a of grouped) {
        const key = `${a.groupTitle || ""}:${a.groupColor || ""}`;
        if (!byGroup.has(key)) byGroup.set(key, { title: a.groupTitle || "", color: a.groupColor || "", tabIds: [] });
        byGroup.get(key)!.tabIds.push(a.tabId);
      }

      const allCurrentGrouped = currentTabs.filter((t) => t.groupId !== -1);
      if (allCurrentGrouped.length > 0) {
        await chrome.tabs.ungroup(allCurrentGrouped.map((t) => t.id!));
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
