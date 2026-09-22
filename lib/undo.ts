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
  // it failed to remove.
  id: number;
  // Where the tab sat, so a restore puts it back in place and in its group rather than at the
  // end of the strip.
  index: number;
  groupId: number;
  groupTitle?: string;
  groupColor?: string;
}

interface GroupAssignment {
  tabId: number;
  groupId: number;
  groupTitle?: string;
  groupColor?: string;
  // /aigroup moves tabs across windows, so restoring group membership alone would leave them
  // stranded where the AI put them.
  windowId: number;
  index: number;
}

// One key per entry, `tabOrdo_undo:<id>`, so a push or a pop reads and writes one snapshot rather
// than the whole stack, and writers that only add or remove their own keys have no shared value
// to lose an update on. `<id>` leads with a zero-padded timestamp, so key order is stack order.
// Entries are found by name with getKeys, which returns no values. The measurements behind this
// layout are in .okf/architecture/undo-stack.md.
const ENTRY_PREFIX = "tabOrdo_undo:";
const MAX_STACK = 20;

/** Entry ids in the session area, oldest first. Names only: no snapshot is read. */
async function entryIds(): Promise<string[]> {
  return (await chrome.storage.session.getKeys())
    .filter((k) => k.startsWith(ENTRY_PREFIX))
    .map((k) => k.slice(ENTRY_PREFIX.length))
    .sort();
}

/** The stamp of this realm's last push, so two pushes that overlap still stack in call order. */
let lastStamp = 0;

/**
 * Await this before doing the thing being undone. The write has to be durable while the
 * caller is still alive: Chrome tears the popup down on any focus loss, so a fire-and-forget
 * persist can lose the snapshot for anything that hands off to the background (/aigroup).
 * A failed write rejects — do NOT close anything you could not snapshot.
 */
export async function pushUndo(entry: UndoEntry): Promise<void> {
  // Above the newest entry listed, so the push lands on top even within the same millisecond as
  // the last one, or after the clock has stepped back.
  const ids = await entryIds();
  const newest = ids.length > 0 ? Number(ids[ids.length - 1].slice(0, 16)) || 0 : 0;
  const stamp = (lastStamp = Math.max(Date.now(), newest + 1, lastStamp + 1));
  const id = `${String(stamp).padStart(16, "0")}-${Math.random().toString(36).slice(2, 10)}`;
  await chrome.storage.session.set({ [ENTRY_PREFIX + id]: entry });
  // The snapshot is durable from here on. Eviction is housekeeping, and failing it must not fail
  // the push a caller is waiting on before it closes anything. It lists again so that a push
  // another surface made meanwhile counts toward the cap: both are newer than anything evicted.
  try {
    const all = await entryIds();
    const evicted = all.slice(0, Math.max(0, all.length - MAX_STACK));
    if (evicted.length > 0) await chrome.storage.session.remove(evicted.map((e) => ENTRY_PREFIX + e));
  } catch {}
}

/** Whether there is anything to undo. Lists key names only, so it reads no snapshot. */
export async function hasUndo(): Promise<boolean> {
  return (await chrome.storage.session.getKeys()).some((k) => k.startsWith(ENTRY_PREFIX));
}

/** The top entry with its snapshot. Reads that one payload. */
export async function peekUndoEntry(): Promise<UndoEntry | null> {
  const ids = await entryIds();
  if (ids.length === 0) return null;
  const key = ENTRY_PREFIX + ids[ids.length - 1];
  return ((await chrome.storage.session.get(key))[key] as UndoEntry | undefined) ?? null;
}

/**
 * Take the top entry off the stack. Nothing serialises pops: two that overlap, in one surface or
 * two, can both read the top entry before either removes it. The popup's `busy` flag is what
 * keeps a surface from overlapping itself.
 */
export async function popUndo(): Promise<UndoEntry | null> {
  for (const id of (await entryIds()).reverse()) {
    const key = ENTRY_PREFIX + id;
    const entry = (await chrome.storage.session.get(key))[key] as UndoEntry | undefined;
    // Survivable here, unlike on push: the undo this entry drives runs either way, and failing
    // the pop would only cost the user their undo.
    await chrome.storage.session.remove(key).catch(() => {});
    // Missing means another surface popped it between our listing and this read: take the one
    // under it rather than report an empty stack.
    if (entry) return entry;
  }
  return null;
}

/** Whether a storage.onChanged batch pushed or popped an undo entry, so a surface should re-check hasUndo. */
export function touchesUndoStack(changes: Record<string, unknown>): boolean {
  return Object.keys(changes).some((k) => k.startsWith(ENTRY_PREFIX));
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
      id: t.id!,
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
        if (liveIds.has(t.id)) continue;
        const sameWindow = openWindows.has(t.windowId);
        try {
          // The recorded index only means anything in the window it was recorded from; a tab
          // whose window is gone goes wherever the focused one has room.
          const created = await chrome.tabs.create({
            url: t.url,
            pinned: t.pinned,
            active: false,
            ...(sameWindow ? { windowId: t.windowId, index: t.index } : {}),
          });
          reopened++;
          if (created?.id !== undefined && t.groupId !== -1) {
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
      // Snapshot order. Within one window that is strip order.
      const assignments = (entry.data as GroupAssignment[]).slice().sort((a, b) => a.index - b.index);
      let currentTabs = await chrome.tabs.query({});
      let byTabId = new Map(currentTabs.map((t) => [t.id!, t]));
      const snapshotIds = new Set(assignments.map((a) => a.tabId));
      const openWindows = new Set<number>();
      try {
        for (const w of await chrome.windows.getAll()) {
          if (w.id !== undefined) openWindows.add(w.id);
        }
      } catch {}

      // Bucket by window as well as title/color. Keying on title:color alone folded two
      // same-named groups living in different windows into one bucket, and the resulting
      // cross-window chrome.tabs.group call throws — taking the whole undo with it. A tab whose
      // window has closed since is bucketed where it sits now.
      const windowFor = (a: GroupAssignment): number | undefined =>
        openWindows.has(a.windowId) ? a.windowId : byTabId.get(a.tabId)?.windowId;

      // Groups the action never touched keep their id and collapsed state. Undo used to dissolve
      // and rebuild every group the snapshot named: after a /group that changed 8 of 63 groups
      // it rebuilt all 63, and every one came back expanded.
      const intact = findIntactGroups(assignments, currentTabs, windowFor);

      // Only tabs the snapshot actually covers. Ungrouping everything currently grouped also
      // dissolved groups the user built *after* the snapshot, in windows this undo never
      // touched — an undo that destroys unrelated state isn't an undo.
      const toUngroup = currentTabs.filter(
        (t) => t.groupId !== -1 && snapshotIds.has(t.id!) && !intact.has(t.groupId)
      );
      if (toUngroup.length > 0) {
        await chrome.tabs.ungroup(toUngroup.map((t) => t.id!)).catch(() => {});
        // Chrome moves a tab it ungroups out to the edge of its group, so the strip the moves
        // below are planned against has to be read again.
        currentTabs = await chrome.tabs.query({});
        byTabId = new Map(currentTabs.map((t) => [t.id!, t]));
      }

      // Put tabs back in the window and order they came from before regrouping. /aigroup
      // relocates tabs across windows, and chrome.tabs.group rejects ids spanning windows anyway,
      // so this has to happen first. Ungrouping above frees them from their current group's block.
      await restoreOrder(assignments, intact, currentTabs, openWindows);

      const byGroup = new Map<string, { title: string; color: string; windowId?: number; tabIds: number[] }>();
      for (const a of assignments) {
        if (a.groupId === -1 || intact.has(a.groupId) || !byTabId.has(a.tabId)) continue;
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
      // A group left standing may still have been renamed (/branch, /aigroup). Rebuilding it
      // used to restore the name as a side effect; now that it isn't rebuilt, restore it here.
      if (intact.size > 0) {
        const liveGroups = new Map((await chrome.tabGroups.query({}).catch(() => [])).map((g) => [g.id, g]));
        for (const [gid, [a]] of intact) {
          const g = liveGroups.get(gid);
          if (!g || ((g.title || "") === (a.groupTitle || "") && (g.color || "") === (a.groupColor || ""))) continue;
          await chrome.tabGroups
            .update(gid, {
              title: a.groupTitle || "",
              ...(a.groupColor ? { color: a.groupColor as chrome.tabGroups.ColorEnum } : {}),
            })
            .catch(() => {});
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

/**
 * Snapshot groups whose live group is exactly what was recorded: the same tabs, in the same
 * order, in the window the snapshot puts them in, still in one contiguous block. Keyed by group
 * id, members in snapshot order. Tabs closed since don't count against a group — there is
 * nothing to put back — but a tab that joined it since does.
 */
function findIntactGroups(
  assignments: GroupAssignment[],
  tabs: chrome.tabs.Tab[],
  windowFor: (a: GroupAssignment) => number | undefined
): Map<number, GroupAssignment[]> {
  const open = new Set(tabs.map((t) => t.id));
  const recorded = new Map<number, GroupAssignment[]>();
  for (const a of assignments) {
    if (a.groupId === -1 || !open.has(a.tabId)) continue;
    const list = recorded.get(a.groupId);
    if (list) list.push(a);
    else recorded.set(a.groupId, [a]);
  }
  const live = new Map<number, chrome.tabs.Tab[]>();
  for (const t of tabs) {
    if (t.groupId === -1) continue;
    const list = live.get(t.groupId);
    if (list) list.push(t);
    else live.set(t.groupId, [t]);
  }
  const intact = new Map<number, GroupAssignment[]>();
  for (const [groupId, members] of recorded) {
    const now = (live.get(groupId) ?? []).sort((a, b) => a.index - b.index);
    const windowId = windowFor(members[0]);
    const same =
      now.length === members.length &&
      now.every(
        (t, i) =>
          t.id === members[i].tabId &&
          t.windowId === windowId &&
          (i === 0 || t.index === now[i - 1].index + 1)
      );
    if (same) intact.set(groupId, members);
  }
  return intact;
}

// Restoring the strip order.
//
// This used to be one awaited tabs.move per displaced tab: 971 round-trips to undo a /shuffle at
// 1000 tabs, three seconds at a couple of milliseconds each. It is now planned against a model of
// the strip, and each window gets whichever of two plans needs fewer calls. What the plans may
// ask of Chrome is set by how Chromium actually moves tabs:
//
//  - tabs.move places an id list "one after another" (TabsMoveFunction::MoveTab): each tab goes
//    to `index`, then index+1. A batch is only exact when every tab arrives from the right of
//    its slot or from another window. A tab travelling rightward shifts the tabs before its
//    slot left under it, so rightward moves go one per call.
//  - A tab moved away from the rest of its group leaves the group, and a tab dropped between two
//    tabs of one group joins it (TabStripModel::GetGroupToAssign). So a group left intact moves
//    whole, with tabGroups.move — whose index is the group's first tab after the move, either
//    direction — and every tab lands right after a tab the snapshot put before it, which is never
//    the inside of a group. A one-tab group keeps its group wherever it lands, so it moves as a tab.
//  - tabs.ungroup has already run for everything not intact, so the rest move ungrouped.

/** What moves as one piece: a tab, or an intact group of two or more (which has `groupId`). */
interface Unit {
  ids: number[];
  groupId?: number;
}

/** One planned chrome call. `batchable`: every tab in it arrives from its right or another window. */
interface Move extends Unit {
  index: number;
  batchable: boolean;
  /** Already at `index`. Planned only so the batch around it stays one call. */
  settled?: boolean;
}

/** Each window's tab ids in strip order, pinned included, plus where every tab is. */
interface StripModel {
  strips: Map<number, number[]>;
  windowOf: Map<number, number>;
  pinned: Set<number>;
}

function modelStrips(tabs: chrome.tabs.Tab[]): StripModel {
  const m: StripModel = { strips: new Map(), windowOf: new Map(), pinned: new Set() };
  for (const t of [...tabs].sort((a, b) => a.index - b.index)) {
    const strip = m.strips.get(t.windowId);
    if (strip) strip.push(t.id!);
    else m.strips.set(t.windowId, [t.id!]);
    m.windowOf.set(t.id!, t.windowId);
    if (t.pinned) m.pinned.add(t.id!);
  }
  return m;
}

const cloneModel = (m: StripModel): StripModel => ({
  strips: new Map([...m.strips].map(([w, ids]) => [w, [...ids]])),
  windowOf: new Map(m.windowOf),
  pinned: m.pinned,
});

function stripOf(m: StripModel, windowId: number): number[] {
  let strip = m.strips.get(windowId);
  if (!strip) m.strips.set(windowId, (strip = []));
  return strip;
}

/** Lift `ids` out of wherever they are and insert them at `index` of the window's strip. */
function relocate(m: StripModel, ids: number[], windowId: number, index: number): void {
  for (const id of ids) {
    const from = stripOf(m, m.windowOf.get(id)!);
    from.splice(from.indexOf(id), 1);
    m.windowOf.set(id, windowId);
  }
  stripOf(m, windowId).splice(index, 0, ...ids);
}

const firstUnpinned = (m: StripModel, windowId: number) =>
  stripOf(m, windowId).filter((id) => m.pinned.has(id)).length;

/**
 * Walk the snapshot order left to right, pulling each piece to the cursor unless it is already
 * there. Every move is leftward or from another window, so consecutive tabs batch: a /shuffle
 * comes back in one call.
 */
function planFromFront(m: StripModel, windowId: number, units: Unit[]): Move[] {
  const moves: Move[] = [];
  let cursor = firstUnpinned(m, windowId);
  for (const u of units) {
    const last = moves[moves.length - 1];
    if (stripOf(m, windowId)[cursor] !== u.ids[0]) {
      moves.push({ ...u, index: cursor, batchable: true });
      relocate(m, u.ids, windowId, cursor);
    } else if (u.groupId === undefined && last && last.groupId === undefined && last.index + last.ids.length === cursor) {
      // A tab that happens to be in place mid-batch rides along: Chrome skips a tab already at
      // its index, and leaving it out would split the batch in two calls around it.
      moves.push({ ...u, index: cursor, batchable: true, settled: true });
    }
    cursor += u.ids.length;
  }
  return moves;
}

/**
 * Leave the longest run already in snapshot order where it is and put each other piece right
 * after its snapshot predecessor: a handful of tabs pulled out of place come back in a handful
 * of calls, however long the strip around them.
 */
function planAroundLongestRun(m: StripModel, windowId: number, units: Unit[]): Move[] {
  const rank = new Map(units.map((u, i) => [u.ids[0], i]));
  const anchors = longestIncreasing(stripOf(m, windowId).flatMap((id) => rank.get(id) ?? []));
  const moves: Move[] = [];
  let prev: Unit | undefined;
  for (const [i, u] of units.entries()) {
    if (!anchors.has(i)) {
      const strip = stripOf(m, windowId);
      const from = m.windowOf.get(u.ids[0]) === windowId ? strip.indexOf(u.ids[0]) : -1;
      let index = firstUnpinned(m, windowId);
      if (prev) {
        const after = strip.indexOf(prev.ids[prev.ids.length - 1]);
        // `index` is where the piece sits once lifted out, and lifting it from the left of its
        // predecessor shifts the predecessor left too.
        index = from !== -1 && from < after ? after + 1 - u.ids.length : after + 1;
      }
      if (from !== index) {
        moves.push({ ...u, index, batchable: from === -1 || from > index });
        relocate(m, u.ids, windowId, index);
      }
    }
    prev = u;
  }
  return moves;
}

/** Values of one longest strictly increasing subsequence. */
function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = [];
  const back: number[] = [];
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    back[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const out = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i !== -1; i = back[i]) out.add(seq[i]);
  return out;
}

/** Fold consecutive single-tab moves that land side by side, all arriving from the right, into one call. */
function toCalls(moves: Move[]): Move[] {
  const calls: Move[] = [];
  // Settled tabs held back until a real move continues the batch past them; a batch never ends on one.
  let riders: number[] = [];
  for (const mv of moves) {
    const last = calls[calls.length - 1];
    const joins =
      !!last &&
      last.groupId === undefined &&
      mv.groupId === undefined &&
      last.batchable &&
      mv.batchable &&
      mv.index === last.index + last.ids.length + riders.length;
    if (mv.settled) {
      if (joins) riders.push(...mv.ids);
      continue;
    }
    if (joins) last.ids = [...last.ids, ...riders, ...mv.ids];
    else calls.push({ ...mv, ids: [...mv.ids] });
    riders = [];
  }
  return calls;
}

async function restoreOrder(
  assignments: GroupAssignment[],
  intact: Map<number, GroupAssignment[]>,
  tabs: chrome.tabs.Tab[],
  openWindows: Set<number>
): Promise<void> {
  const live = new Map(tabs.map((t) => [t.id!, t]));
  // The pieces each window should hold, in snapshot order. A tab whose window has closed stays
  // where it is, and a tab pinned since belongs to the pinned block, where Chrome won't let an
  // unpinned order reach.
  const targets = new Map<number, Unit[]>();
  const placed = new Set<number>();
  for (const a of assignments) {
    const t = live.get(a.tabId);
    if (!openWindows.has(a.windowId) || !t || t.pinned) continue;
    let units = targets.get(a.windowId);
    if (!units) targets.set(a.windowId, (units = []));
    const group = intact.get(a.groupId);
    if (!group) {
      units.push({ ids: [a.tabId] });
    } else if (!placed.has(a.groupId)) {
      placed.add(a.groupId);
      const ids = group.map((g) => g.tabId);
      units.push(ids.length > 1 ? { ids, groupId: a.groupId } : { ids });
    }
  }

  let model = modelStrips(tabs);
  for (const [windowId, units] of [...targets].sort(([a], [b]) => a - b)) {
    const front = cloneModel(model);
    const around = cloneModel(model);
    const a = toCalls(planFromFront(front, windowId, units));
    const b = toCalls(planAroundLongestRun(around, windowId, units));
    const moved = (calls: Move[]) => calls.reduce((n, c) => n + c.ids.length, 0);
    const useB = b.length < a.length || (b.length === a.length && moved(b) <= moved(a));
    model = useB ? around : front;
    for (const call of useB ? b : a) {
      try {
        if (call.groupId !== undefined) await chrome.tabGroups.move(call.groupId, { index: call.index });
        else await chrome.tabs.move(call.ids, { windowId, index: call.index });
      } catch (e) {
        // Every later index in this window was computed against a strip this call didn't produce.
        // Leave the window as it is and plan the next one against the strip Chrome reports.
        console.warn("[TabOrdo] undo: could not restore tab order", e);
        try {
          model = modelStrips(await chrome.tabs.query({}));
        } catch {
          return;
        }
        break;
      }
    }
  }
}
