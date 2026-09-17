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
  // The tab's id at snapshot time, so executeUndo can tell a tab the close removed from one
  // it failed to remove. Optional: entries persisted by older versions have none.
  id?: number;
  // Optional: entries persisted by older versions have none. Without them a restore dropped
  // the tab at the end of the strip and outside whatever group it was closed from — the
  // group snapshot has always recorded index, and a close is no less a position change.
  index?: number;
  groupId?: number;
  groupTitle?: string;
  groupColor?: string;
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

// Storage layout: one key per entry, and a small metadata key beside it.
//
// The stack used to be ONE array under `tabOrdo_undoStack`, and every push was a
// read-modify-write of all of it. A group snapshot covers every unpinned tab, so with twenty of
// them at a thousand tabs each push read 1.2 MB, wrote 1.2 MB, and storage.onChanged handed old
// AND new — 2.4 MB — to the service worker and every open popup and side panel. A single-tab
// close still paid ~600 KB each way, and every popup open read the whole stack just to decide
// whether to light the Undo button.
//
// So each entry has its own pair of keys, written together in one set():
//   tabOrdo_undo:<id>      the entry, snapshot and all. Read only by popUndo, and only the top one.
//   tabOrdo_undoMeta:<id>  { type, label, timestamp }. All the UI's mirror ever holds.
// `<id>` leads with a zero-padded timestamp, so key order is stack order. A realm always pushes
// above the newest entry it has seen; two surfaces pushing in the same millisecond order
// arbitrarily, and both entries survive. Entries are found by name with getKeys, which returns
// no values, and evicted with remove. As bulklock.ts found for its leases, writers that only add
// or remove their own keys have no shared value to lose an update on: two surfaces pushing back
// to back can no longer drop each other's entry, which the old layout needed a re-read before
// every write to (mostly) prevent.
const ENTRY_PREFIX = "tabOrdo_undo:";
const META_PREFIX = "tabOrdo_undoMeta:";
/** The single-array layout described above. Only ever read to migrate it. */
const LEGACY_KEY = "tabOrdo_undoStack";
const MAX_STACK = 20;

/** An entry without its snapshot: enough for `canUndo`, and a few hundred bytes for all twenty. */
export interface UndoMeta {
  /** Storage id. Ids sort oldest first. */
  id: string;
  type: string;
  label: string;
  timestamp: number;
}

// Metadata of the persisted stack, oldest first, so peekUndo can stay synchronous for the UI's
// `canUndo` binding. The popup and the side panel are the same component in two realms, each
// with its own mirror over one persisted stack, so every mutation refreshes it first.
let mirror: UndoMeta[] = [];

function newEntryId(): string {
  // Above the newest entry this realm knows of, so a push lands on top even within the same
  // millisecond as the last one, or after the clock has stepped back.
  const newest = mirror.length > 0 ? Number(mirror[mirror.length - 1].id.slice(0, 16)) || 0 : 0;
  const stamp = Math.max(Date.now(), newest + 1);
  return `${String(stamp).padStart(16, "0")}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Key names in the session area, plus the values when getting the names meant reading them. */
async function listSession(): Promise<{ names: string[]; values: Record<string, unknown> | null }> {
  const area = chrome.storage.session;
  const getKeys = (area as { getKeys?: () => Promise<string[]> }).getKeys;
  // getKeys is Chrome 130+. Older builds read the whole area, as bulklock.ts does: correct, and
  // no more expensive than the single-array layout was on every build.
  if (typeof getKeys !== "function") {
    const values = await area.get(null);
    return { names: Object.keys(values), values };
  }
  return { names: await getKeys.call(area), values: null };
}

/**
 * Move a stack left by the single-array layout onto per-entry keys, then delete it. Chrome clears
 * the session area when an extension updates or reloads, so in practice there is nothing to find,
 * and looking costs nothing: it is one name in a listing every refresh makes anyway. The ids are
 * fixed by position and sort before any timestamped id, so two realms migrating at once write the
 * same keys, and the old stack stays under everything pushed since.
 */
async function migrateLegacy(values: Record<string, unknown> | null): Promise<void> {
  const area = chrome.storage.session;
  const legacy = values ? values[LEGACY_KEY] : (await area.get(LEGACY_KEY))[LEGACY_KEY];
  const items: Record<string, unknown> = {};
  if (Array.isArray(legacy)) {
    legacy.slice(-MAX_STACK).forEach((entry: UndoEntry, i) => {
      if (!entry || typeof entry !== "object") return;
      const id = `${String(i).padStart(16, "0")}-legacy`;
      items[ENTRY_PREFIX + id] = entry;
      items[META_PREFIX + id] = { type: entry.type, label: entry.label, timestamp: entry.timestamp };
    });
  }
  if (Object.keys(items).length > 0) await area.set(items);
  await area.remove(LEGACY_KEY);
}

/** Rebuild the mirror from key names, reading only metadata this realm has not seen yet. */
async function refreshMirror(): Promise<void> {
  let { names, values } = await listSession();
  if (names.includes(LEGACY_KEY)) {
    await migrateLegacy(values);
    ({ names, values } = await listSession());
  }
  const ids = names
    .filter((k) => k.startsWith(META_PREFIX))
    .map((k) => k.slice(META_PREFIX.length))
    .sort();
  const known = new Map(mirror.map((m) => [m.id, m]));
  const unseen = ids.filter((id) => !known.has(id));
  if (unseen.length > 0) {
    const got = values ? values : await chrome.storage.session.get(unseen.map((id) => META_PREFIX + id));
    for (const id of unseen) {
      const m = got[META_PREFIX + id] as Omit<UndoMeta, "id"> | undefined;
      if (m) known.set(id, { id, type: m.type, label: m.label, timestamp: m.timestamp });
    }
  }
  mirror = ids.flatMap((id) => known.get(id) ?? []);
}

// Pushes, pops and reloads in one realm run one at a time. Storage writes no longer race — each
// entry has its own keys — but mirror refreshes still could: a slow one landing after a newer
// one would roll `canUndo` back to a stack that no longer exists.
let writeChain: Promise<unknown> = Promise.resolve();

export async function loadUndoStack(): Promise<void> {
  const run = writeChain.then(refreshMirror).catch(() => {});
  writeChain = run;
  return run;
}

/**
 * Await this before doing the thing being undone. The write has to be durable while the
 * caller is still alive: Chrome tears the popup down on any focus loss, so a fire-and-forget
 * persist can lose the snapshot for anything that hands off to the background (/aigroup).
 * A failed write rejects — do NOT close anything you could not snapshot.
 */
export async function pushUndo(entry: UndoEntry): Promise<void> {
  const run = writeChain.then(async () => {
    const id = newEntryId();
    const meta = { type: entry.type, label: entry.label, timestamp: entry.timestamp };
    // One set() for both keys, so no surface ever lists an entry whose snapshot is not there.
    await chrome.storage.session?.set({ [ENTRY_PREFIX + id]: entry, [META_PREFIX + id]: meta });
    mirror = [...mirror, { id, ...meta }];
    // The snapshot is durable from here on. Eviction is housekeeping, and failing it must not
    // fail the push a caller is waiting on before it closes anything.
    try {
      await refreshMirror();
      const evicted = mirror.slice(0, Math.max(0, mirror.length - MAX_STACK));
      if (evicted.length > 0) {
        await chrome.storage.session.remove(evicted.flatMap((m) => [ENTRY_PREFIX + m.id, META_PREFIX + m.id]));
        mirror = mirror.slice(evicted.length);
      }
    } catch {}
  });
  writeChain = run.catch(() => {});
  return run;
}

/** The top entry's metadata. Synchronous, from the mirror; the snapshot itself stays in storage. */
export function peekUndo(): UndoMeta | null {
  return mirror.length > 0 ? mirror[mirror.length - 1] : null;
}

/** The top entry with its snapshot. Reads that one payload. */
export async function peekUndoEntry(): Promise<UndoEntry | null> {
  await loadUndoStack();
  const top = peekUndo();
  if (!top) return null;
  const key = ENTRY_PREFIX + top.id;
  return ((await chrome.storage.session.get(key))[key] as UndoEntry | undefined) ?? null;
}

export async function popUndo(): Promise<UndoEntry | null> {
  const run = writeChain.then(async () => {
    await refreshMirror().catch(() => {});
    while (mirror.length > 0) {
      const top = mirror[mirror.length - 1];
      const key = ENTRY_PREFIX + top.id;
      const entry = (await chrome.storage.session.get(key))[key] as UndoEntry | undefined;
      mirror = mirror.slice(0, -1);
      // Survivable here, unlike on push: the entry is already out of the mirror and the undo it
      // drives runs either way. Failing the pop would only cost the user their undo.
      await chrome.storage.session.remove([key, META_PREFIX + top.id]).catch(() => {});
      // Missing means the other surface popped it between our listing and this read: take the
      // one under it rather than report an empty stack.
      if (entry) return entry;
    }
    return null;
  });
  writeChain = run.catch(() => {});
  return run;
}

export function undoStackSize(): number {
  return mirror.length;
}

/** Whether a storage.onChanged batch touched the undo stack, so a surface should reload its mirror. */
export function touchesUndoStack(changes: Record<string, unknown>): boolean {
  return Object.keys(changes).some((k) => k.startsWith(META_PREFIX) || k === LEGACY_KEY);
}

/**
 * Called by closeTabs, and nothing else: the snapshot lives inside the one function that
 * removes tabs so no new call site can forget it. Ids that are no longer open are simply not
 * recorded — there is nothing to bring back — and when none of them are, no entry is pushed,
 * since an empty entry would only burn the undo slot under it.
 */
export async function snapshotBeforeClose(tabIds: number[]): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const idSet = new Set(tabIds);
  const toClose = tabs.filter((t) => idSet.has(t.id!));
  if (toClose.length === 0) return;
  const groupMap = new Map<number, chrome.tabGroups.TabGroup>();
  try {
    for (const g of await chrome.tabGroups.query({})) groupMap.set(g.id, g);
  } catch {}
  const data: ClosedTabData[] = toClose.map((t) => {
    const g = groupMap.get(t.groupId);
    return {
      id: t.id,
      url: t.url || "",
      pinned: t.pinned,
      windowId: t.windowId,
      index: t.index,
      groupId: t.groupId,
      groupTitle: g?.title,
      groupColor: g?.color,
    };
  });
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
      // The snapshot precedes the close, so it can name tabs the close then failed to remove —
      // one Chrome refused mid-drag, or the whole batch when the worker died in between.
      // Recreating those would put a second copy beside the one still open. Tab ids are unique
      // for the life of the browser session, and so is this stack (session storage), so "still
      // open" is a set lookup. A failed query falls back to restoring everything, as before.
      let liveIds = new Set<number>();
      try {
        liveIds = new Set((await chrome.tabs.query({})).map((t) => t.id!));
      } catch {}
      let reopened = 0;
      const regrouped: { tabId: number; data: ClosedTabData }[] = [];
      for (const t of tabs) {
        if (!t.url || t.url === "chrome://newtab/") continue;
        if (t.id !== undefined && liveIds.has(t.id)) continue;
        const sameWindow = openWindows.has(t.windowId);
        try {
          // The recorded index only means anything in the window it was recorded from; a tab
          // whose window is gone goes wherever the focused one has room.
          const created = await chrome.tabs.create({
            url: t.url,
            pinned: t.pinned,
            active: false,
            ...(sameWindow ? { windowId: t.windowId } : {}),
            ...(sameWindow && t.index !== undefined ? { index: t.index } : {}),
          });
          reopened++;
          if (created?.id !== undefined && t.groupId !== undefined && t.groupId !== -1) {
            regrouped.push({ tabId: created.id, data: t });
          }
        } catch {}
      }

      // Put the restored tabs back in their group. Same bucketing as the "group" case below:
      // window plus title plus colour, because chrome.tabs.group rejects ids spanning windows
      // and two same-named groups in different windows are different groups.
      const byGroup = new Map<string, { title: string; color: string; windowId?: number; tabIds: number[] }>();
      for (const { tabId, data } of regrouped) {
        const windowId = openWindows.has(data.windowId) ? data.windowId : undefined;
        const key = `${windowId ?? "?"}:${data.groupTitle || ""}:${data.groupColor || ""}`;
        if (!byGroup.has(key)) {
          byGroup.set(key, { title: data.groupTitle || "", color: data.groupColor || "", windowId, tabIds: [] });
        }
        byGroup.get(key)!.tabIds.push(tabId);
      }
      if (byGroup.size > 0) {
        // Closing one tab out of a group leaves the group standing, so rejoin it rather than
        // building a second group beside it with the same name.
        const liveGroups = await chrome.tabGroups.query({}).catch(() => []);
        for (const [, info] of byGroup) {
          // Only ever rejoin a group in the window the tab is actually going back to —
          // chrome.tabs.group rejects ids that span windows.
          const match =
            info.windowId === undefined
              ? undefined
              : liveGroups.find(
                  (g) =>
                    g.windowId === info.windowId &&
                    (g.title || "") === info.title &&
                    (g.color || "") === info.color
                );
          try {
            const gid = await chrome.tabs.group(
              match
                ? { tabIds: info.tabIds, groupId: match.id }
                : {
                    tabIds: info.tabIds,
                    ...(info.windowId !== undefined ? { createProperties: { windowId: info.windowId } } : {}),
                  }
            );
            if (!match) {
              await chrome.tabGroups.update(gid, {
                title: info.title,
                color: info.color as chrome.tabGroups.ColorEnum,
              });
            }
          } catch (e) {
            // A group Chrome refuses to rebuild must not turn a successful reopen into a failure.
            console.warn("[TabOrdo] undo: could not regroup restored tabs", info.title, e);
          }
        }
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
