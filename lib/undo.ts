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

export const UNDO_KEY = "tabOrdo_undoStack";
// In-memory mirror of the persisted stack, so peekUndo can stay synchronous for the UI's
// `canUndo` binding. Every mutation re-reads storage first — see syncFromStorage.
const stack: UndoEntry[] = [];
const MAX_STACK = 20;

async function persistStack(): Promise<void> {
  try {
    await chrome.storage.session?.set({ [UNDO_KEY]: [...stack] });
  } catch {}
}

/**
 * Refresh the mirror from storage before mutating it. The popup and the side panel are the
 * same component in two realms, each with its own module instance but one shared persisted
 * stack — pushing onto a mirror loaded at mount time would overwrite whatever the other
 * surface recorded in the meantime.
 */
async function syncFromStorage(): Promise<void> {
  try {
    const data = await chrome.storage.session.get(UNDO_KEY);
    const loaded = data[UNDO_KEY];
    if (Array.isArray(loaded)) {
      stack.length = 0;
      stack.push(...loaded);
    }
  } catch {}
}

export async function loadUndoStack(): Promise<void> {
  await syncFromStorage();
}

/**
 * Await this before doing the thing being undone. The write has to be durable while the
 * caller is still alive: Chrome tears the popup down on any focus loss, so a fire-and-forget
 * persist can lose the snapshot for anything that hands off to the background (/aigroup).
 */
export async function pushUndo(entry: UndoEntry): Promise<void> {
  await syncFromStorage();
  stack.push(entry);
  if (stack.length > MAX_STACK) stack.shift();
  await persistStack();
}

export function peekUndo(): UndoEntry | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

export async function popUndo(): Promise<UndoEntry | null> {
  await syncFromStorage();
  const entry = stack.pop() || null;
  await persistStack();
  return entry;
}

export function undoStackSize(): number {
  return stack.length;
}

export async function snapshotBeforeClose(tabIds: number[]): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const idSet = new Set(tabIds);
  const toClose = tabs.filter((t) => idSet.has(t.id!));
  await snapshotClosedTabs(toClose);
}

export async function snapshotClosedTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
  const data: ClosedTabData[] = tabs.map((t) => ({
    url: t.url || "",
    pinned: t.pinned,
    windowId: t.windowId,
  }));
  await pushUndo({
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
  await pushUndo({
    type: "group",
    label: "Group change",
    timestamp: Date.now(),
    data,
  });
}

export async function executeUndo(): Promise<string> {
  const entry = await popUndo();
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
      const snapshotIds = new Set(assignments.map((a) => a.tabId));

      // Only tabs the snapshot actually covers. Ungrouping everything currently grouped also
      // dissolved groups the user built *after* the snapshot, in windows this undo never
      // touched — an undo that destroys unrelated state isn't an undo.
      const toUngroup = currentTabs.filter((t) => t.groupId !== -1 && snapshotIds.has(t.id!));
      if (toUngroup.length > 0) {
        await chrome.tabs.ungroup(toUngroup.map((t) => t.id!)).catch(() => {});
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

      // Bucket by window as well as title/color. Keying on title:color alone folded two
      // same-named groups living in different windows into one bucket, and the resulting
      // cross-window chrome.tabs.group call throws — taking the whole undo with it.
      // Legacy entries carry no windowId, so fall back to where the tab sits now.
      const windowFor = (a: GroupAssignment): number | undefined =>
        a.windowId !== undefined && openWindows.has(a.windowId)
          ? a.windowId
          : byTabId.get(a.tabId)?.windowId;

      const byGroup = new Map<string, { title: string; color: string; windowId?: number; tabIds: number[] }>();
      for (const a of assignments) {
        if (a.groupId === -1 || !currentIds.has(a.tabId)) continue;
        const windowId = windowFor(a);
        const key = `${windowId ?? "?"}:${a.groupTitle || ""}:${a.groupColor || ""}`;
        if (!byGroup.has(key)) {
          byGroup.set(key, { title: a.groupTitle || "", color: a.groupColor || "", windowId, tabIds: [] });
        }
        byGroup.get(key)!.tabIds.push(a.tabId);
      }

      let failed = 0;
      for (const [, info] of byGroup) {
        if (info.tabIds.length === 0) continue;
        try {
          const gid = await chrome.tabs.group({
            tabIds: info.tabIds,
            ...(info.windowId !== undefined ? { createProperties: { windowId: info.windowId } } : {}),
          });
          await chrome.tabGroups.update(gid, {
            title: info.title,
            color: info.color as chrome.tabGroups.ColorEnum,
          });
        } catch (e) {
          // One group Chrome refuses to rebuild must not abandon the rest of the restore.
          console.warn("[TabOrdo] undo: could not restore group", info.title, e);
          failed++;
        }
      }
      if (failed > 0) {
        return `Restored previous group state — ${failed} group(s) could not be rebuilt`;
      }
      return "Restored previous group state";
    }
    default:
      return "Unknown undo type";
  }
}
