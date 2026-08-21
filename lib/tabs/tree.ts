// Tab lineage — which tab opened which — and the branch gathering built on it.
//
// Chrome exposes an opener in tab.openerTabId, but it is thin: it vanishes the moment the
// opener closes, it never survives a browser restart, and Chrome's tab strip forgets *every*
// opener relationship the moment any tab navigates by something other than a link click —
// typing a URL anywhere wipes the lot (TabStripModel::TabNavigating: "we assume they're
// beginning a different task"). Recording the link ourselves at tabs.onCreated buys the case
// that actually breaks a reading session — an *intermediate* tab closing. Close article B and
// its sub-links re-parent to the listing page above it, so gathering from that listing page
// still catches them. openerTabId alone drops them.
//
// One opener Chrome reports is deliberately not recorded: a Ctrl+T new-tab page names the tab
// you were looking at as its opener ("tabs opened in the foreground inherit the opener of the
// previously active tab"), and Chrome keeps that link through the first navigation typed into
// it, as a quick-lookup heuristic. Whatever gets typed there is a new task, not part of the
// branch, so the tab is recorded as an explicit root — which also stops the live value from
// re-introducing the link when the map and Chrome are merged.
//
// Closing a *root* is the one case this cannot rescue: with no grandparent to inherit, its
// children become roots and stop being each other's siblings. Keeping them linked would mean
// tombstoning the dead id and teaching every reader to step over it — more machinery than the
// case earns, and it is not the case that breaks a reading session.
//
// chrome.storage.session is the right home for the map: tab ids are handed out per browser
// session and the next one reuses the same small range, so a map that outlived the session
// would confidently point every branch at unrelated tabs.

import { GROUP_COLORS } from "./types.ts";
import { untouchableGroupIds } from "./group.ts";
import { getFullHostname, hashCode } from "../url.ts";

const TREE_KEY = "tabParents";

/**
 * Sentinel parent: "this tab has no opener, and Chrome's live value for it is not to be
 * trusted". Recorded for the Ctrl+T case described above. Never a real tab id.
 */
export const EXPLICIT_ROOT = -1;

/** child tab id -> the tab that opened it, or EXPLICIT_ROOT. */
export type ParentMap = Record<number, number>;

// What a Ctrl+T (or the browser-menu "New tab") tab is navigating to when tabs.onCreated
// fires. Matched by prefix: Chrome has reported both "chrome://newtab/" and the WebUI page
// behind it, and Edge has its own scheme.
const NEW_TAB_PAGE_PREFIXES = ["chrome://newtab", "chrome://new-tab-page", "edge://newtab", "about:newtab"];

function isNewTabPage(url: string | undefined): boolean {
  return !!url && NEW_TAB_PAGE_PREFIXES.some((p) => url.startsWith(p));
}

/**
 * The parent to record for a freshly created tab: its opener, EXPLICIT_ROOT for a new-tab
 * page whose opener is only Chrome's quick-lookup heuristic, or undefined when there is
 * nothing to record at all. Read at tabs.onCreated, when pendingUrl still says what the tab
 * is — by the time it has navigated, a Ctrl+T tab and a link-opened one look identical.
 */
export function lineageOpener(
  tab: Pick<chrome.tabs.Tab, "id" | "openerTabId" | "url" | "pendingUrl">
): number | undefined {
  if (tab.id === undefined || tab.openerTabId === undefined || tab.openerTabId === tab.id) return undefined;
  if (isNewTabPage(tab.pendingUrl) || isNewTabPage(tab.url)) return EXPLICIT_ROOT;
  return tab.openerTabId;
}

/**
 * Fold the live openerTabId values into the recorded map. Chrome's value wins where both
 * exist — it is the browser's own truth and it covers tabs opened before this extension was
 * installed — while the recorded map covers the case Chrome drops, an opener that has since
 * closed. Links pointing at a tab that no longer exists are discarded either way: a dead
 * parent is the same as no parent. The one place the map overrules Chrome is a tab recorded
 * as an EXPLICIT_ROOT: Chrome's opener there is the Ctrl+T heuristic, not lineage.
 */
export function resolveParents(
  tabs: Pick<chrome.tabs.Tab, "id" | "openerTabId">[],
  stored: ParentMap
): Map<number, number> {
  const live = new Set<number>();
  for (const t of tabs) if (t.id !== undefined) live.add(t.id);

  const parents = new Map<number, number>();
  const roots = new Set<number>();
  for (const [child, parent] of Object.entries(stored)) {
    const c = Number(child);
    if (!live.has(c)) continue;
    if (parent === EXPLICIT_ROOT) roots.add(c);
    else if (c !== parent && live.has(parent)) parents.set(c, parent);
  }
  for (const t of tabs) {
    if (t.id === undefined || t.openerTabId === undefined || roots.has(t.id)) continue;
    if (t.openerTabId === t.id || !live.has(t.openerTabId)) continue;
    parents.set(t.id, t.openerTabId);
  }
  return parents;
}

/** The tab that opened `tabId`, as far as the map and Chrome between them know. */
export async function parentOf(tabId: number): Promise<number | undefined> {
  const all = await chrome.tabs.query({});
  return resolveParents(all, await readParents()).get(tabId);
}

/**
 * Every tab reachable downward from `rootId`, returned in `candidates` order so the caller
 * controls the strip ordering. The root is included only if `candidates` holds it — callers
 * filter out tabs Chrome refuses to group, and a pinned root is one of them.
 *
 * The visited set is defensive rather than load-bearing. Chrome hands out tab ids from a
 * rising per-session counter, so a parent always outranks its child and a cycle should not be
 * constructible — but this walks *persisted* state that outlives any single service-worker
 * run, and a walk over a map that somehow went bad has to terminate rather than spin.
 */
export function collectSubtree(
  rootId: number,
  parents: Map<number, number>,
  candidates: number[]
): number[] {
  const children = new Map<number, number[]>();
  for (const [child, parent] of parents) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(child);
  }

  const seen = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return candidates.filter((id) => seen.has(id));
}

/**
 * The branch as an outline: root first, then each child followed by its own subtree, with the
 * depth below the root. Siblings come in `order` (strip order, normally), so the outline reads
 * top-to-bottom the way the tabs sit left-to-right. Only ids present in `order` appear.
 * Same cycle guard as collectSubtree, for the same reason.
 */
export function branchOutline(
  rootId: number,
  parents: Map<number, number>,
  order: number[]
): { id: number; depth: number }[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const children = new Map<number, number[]>();
  for (const [child, parent] of parents) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(child);
  }
  // Walk the whole map and filter at emit time, like collectSubtree: a node missing from
  // `order` is left out without severing whatever sits below it.
  const at = (id: number) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  for (const kids of children.values()) kids.sort((a, b) => at(a) - at(b));

  const out: { id: number; depth: number }[] = [];
  const seen = new Set<number>([rootId]);
  const stack: { id: number; depth: number }[] = [{ id: rootId, depth: 0 }];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (rank.has(node.id)) out.push(node);
    const kids = children.get(node.id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) {
      if (seen.has(kids[i])) continue;
      seen.add(kids[i]);
      stack.push({ id: kids[i], depth: node.depth + 1 });
    }
  }
  return out;
}

/** branchOutline over the live strip: every tab below `rootId`, in tree order with depths. */
export async function outlineBranch(rootId: number): Promise<{ id: number; depth: number }[]> {
  const all = await chrome.tabs.query({});
  const ordered = [...all]
    .filter((t) => t.id !== undefined)
    .sort((a, b) => a.windowId - b.windowId || (a.index ?? 0) - (b.index ?? 0))
    .map((t) => t.id!);
  return branchOutline(rootId, resolveParents(all, await readParents()), ordered);
}

/**
 * Drop `tabIds` from the map without severing the branches below them: each surviving child
 * re-parents to its nearest ancestor that is *not* being removed. Closing the Hacker News tab
 * should leave the articles standing as roots, not orphan every sub-link they had opened.
 *
 * Batched rather than one-at-a-time because closing a window removes a whole branch at once,
 * and walking the chain here settles a tab whose parent *and* grandparent are both going in
 * the same pass — which repeated single splices would only reach by rebuilding the map once
 * per tab. Returns null when nothing changed, so the caller can skip the write.
 */
export function spliceParents(parents: ParentMap, tabIds: number[]): ParentMap | null {
  const dead = new Set(tabIds);
  const next: ParentMap = {};
  let changed = false;

  for (const [child, parent] of Object.entries(parents)) {
    const c = Number(child);
    if (dead.has(c)) { changed = true; continue; }

    let p: number | undefined = parent;
    const seen = new Set<number>([c]);
    while (p !== undefined && dead.has(p) && !seen.has(p)) {
      seen.add(p);
      p = parents[p];
    }
    // Nothing live left above it, or the chain looped back around: it becomes a root. An
    // EXPLICIT_ROOT is kept only when it is this tab's own recorded value — inheriting the
    // sentinel from a closed Ctrl+T ancestor would just be a plain root wearing a flag.
    if (p === undefined || dead.has(p) || p === c) { changed = true; continue; }
    if (p === EXPLICIT_ROOT && parent !== EXPLICIT_ROOT) { changed = true; continue; }
    if (p !== parent) changed = true;
    next[c] = p;
  }
  return changed ? next : null;
}

/** Single-tab spliceParents. Kept for the one-at-a-time callers and the shape it documents. */
export function spliceParent(parents: ParentMap, tabId: number): ParentMap {
  return spliceParents(parents, [tabId]) ?? parents;
}

export async function readParents(): Promise<ParentMap> {
  try {
    const data = await chrome.storage.session?.get(TREE_KEY);
    return (data?.[TREE_KEY] as ParentMap | undefined) ?? {};
  } catch (e) {
    console.warn("[TabOrdo] tab lineage read failed:", e);
    return {};
  }
}

// chrome.storage.session has no compare-and-swap, so two overlapping read-modify-writes would
// silently drop one — and ctrl-clicking twenty links fires twenty onCreated events back to
// back. Every mutation goes through this chain instead. The background service worker is the
// only writer, so serialising is enough; deliberately no in-memory cache, because the worker
// is torn down on idle and a cache would be one more thing to get wrong on the way back up.
let queue: Promise<void> = Promise.resolve();

function mutate(
  fn: (parents: ParentMap) => ParentMap | null,
  opts: { stillNeeded?: () => boolean; onFailed?: () => void } = {}
): Promise<void> {
  queue = queue
    .then(async () => {
      // Checked inside the queued task rather than at call time: by the time this runs, an
      // earlier task in the same batch may already have done this one's work, and then even
      // the read is wasted.
      if (opts.stillNeeded && !opts.stillNeeded()) return;
      const next = fn(await readParents());
      // null means the mutation was a no-op — skip the write rather than rewrite the same map.
      if (next !== null) await chrome.storage.session?.set({ [TREE_KEY]: next });
    })
    .catch((e) => {
      console.warn("[TabOrdo] tab lineage write failed:", e);
      opts.onFailed?.();
    });
  return queue;
}

/** `openerTabId` may be EXPLICIT_ROOT — see lineageOpener. */
export function recordOpener(tabId: number, openerTabId: number): Promise<void> {
  return mutate((parents) =>
    tabId === openerTabId || parents[tabId] === openerTabId
      ? null
      : { ...parents, [tabId]: openerTabId }
  );
}

// Closing a window fires onRemoved once per tab — fifty events for a fifty-tab window, each
// wanting its own read-modify-write. They queue behind one another, so by the time the first
// task actually runs the rest have already registered here: it splices the whole set in one
// pass and every follower finds the set empty and returns before paying for even a read.
// Fifty writes, each fanning storage.onChanged out to every open realm, collapse into one.
//
// Deliberately no timer. A debounce would leave work pending with nothing keeping the service
// worker alive to finish it; here everything still queued is work that has already been done.
const pendingForget = new Set<number>();

export function forgetTab(tabId: number): Promise<void> {
  pendingForget.add(tabId);
  let batch: number[] = [];
  return mutate(
    (parents) => {
      batch = [...pendingForget];
      pendingForget.clear();
      return spliceParents(parents, batch);
    },
    {
      stillNeeded: () => pendingForget.size > 0,
      // Draining clears the set before the write, and the write can fail. Put the batch back
      // so the next removal re-splices it: without this, one failed write orphans every child
      // in the storm permanently — their parent is gone, so nothing later re-derives the link.
      // Restoring only on failure, never on success, is what keeps the drain from livelocking.
      onFailed: () => { for (const id of batch) pendingForget.add(id); },
    }
  );
}

export interface Branch {
  root: chrome.tabs.Tab;
  /** Where the group will form. The window the user is looking at, not necessarily the root's. */
  windowId: number;
  /** The branch in strip order, target window first. Excludes tabs Chrome won't let us group. */
  tabs: chrome.tabs.Tab[];
  /** False when the root itself could not join: pinned, or sitting in a protected group. */
  rootIncluded: boolean;
  // The two skip reasons are counted apart because they read as different sentences to the
  // user — "pinned" is something they can undo, "protected" points at their ignore list — and
  // a single total once reported a pinned tab as being in a group that did not exist. Both
  // exclude the root, which rootIncluded already speaks for.
  /** Members Chrome will not group because they are pinned. */
  skippedPinned: number;
  /** Members left alone because their group is shared or on the user's ignore list. */
  skippedProtected: number;
  /**
   * The group this branch already lives in, when there is one: the root's group, sitting in
   * the target window, with no member from outside the branch. Running the command again
   * folds into it — adding the tabs opened since — instead of dissolving and rebuilding it,
   * which would cost the group its collapse state, its colour, and any identity Chrome's saved
   * groups had given it. A group holding a stranger (a domain auto-group, say) does not
   * qualify: the branch gets a group of its own, which is what the command promises.
   */
  existingGroup?: { id: number; title: string };
}

export interface BranchUpTarget {
  /** The tab to gather from. Undefined when there is nothing above worth gathering. */
  rootId?: number;
  /** True when the walk stepped past at least one ancestor already in the active tab's group. */
  climbed: boolean;
}

/**
 * Where /branchup should start gathering from `tabId`.
 *
 * Normally that is simply the tab that opened it. But the command is meant to be repeatable,
 * and after one run the ancestors it gathered are sitting in the same group as the active tab
 * — stopping at the nearest one would rebuild the group you already have and never climb. So
 * walk past every ancestor sharing the active tab's group and take the next one above them.
 *
 * An ungrouped active tab skips the walk entirely: groupId -1 is "no group", not a group that
 * every loose tab has in common.
 *
 * `climbed` is what separates the two ways this comes back empty. A tab nobody opened has no
 * parent at all. A tab whose parent is sitting right beside it in the same group has one — the
 * walk just consumed it — and telling that user "this wasn't opened from another tab" is a
 * flat lie about their own window. Nothing here knows whether that shared group came from an
 * earlier run or the user's own hand, and it does not need to: either way there is nothing
 * left above to gather.
 */
export async function branchUpRoot(tabId: number): Promise<BranchUpTarget> {
  const all = await chrome.tabs.query({});
  const byId = new Map(all.filter((t) => t.id !== undefined).map((t) => [t.id!, t]));
  const parents = resolveParents(all, await readParents());

  const groupId = byId.get(tabId)?.groupId ?? -1;
  const seen = new Set<number>([tabId]);
  let current = tabId;
  let climbed = false;
  for (;;) {
    const parent = parents.get(current);
    // `seen` guards the same corrupted-map loop collectSubtree does.
    if (parent === undefined || seen.has(parent)) return { climbed };
    if (groupId === -1 || byId.get(parent)?.groupId !== groupId) return { rootId: parent, climbed };
    seen.add(parent);
    current = parent;
    climbed = true;
  }
}

/**
 * The branch rooted at `rootId`: that tab plus everything opened from it, transitively.
 *
 * `targetWindowId` is where the group will form. It is passed in rather than taken from the
 * root because /branchup roots at an ancestor, and that ancestor can live in another window —
 * anchoring there would build the group off-screen and drag the user's active tab into a
 * window they were not looking at.
 *
 * Two kinds of tab are filtered out. Pinned ones, because Chrome refuses to put a pinned tab
 * in a group and one of them would reject the whole call. And members of a shared or
 * ignore-listed group, because dissolving a group the user protected is not this command's
 * business. Both are dropped from the *candidates*, not from the parent map, so a filtered tab
 * mid-branch stops being a member without severing the branch below it — collectSubtree walks
 * the full map and only intersects with candidates at the end.
 *
 * Note this honours ignoreGroupNames but not ignorePatterns: the name list protects a group
 * the user built, while the URL patterns govern which sites get auto-grouped by domain. A
 * branch is lineage-derived and explicitly aimed, so the URL list has no say in it.
 */
export async function collectBranch(
  rootId: number,
  targetWindowId: number
): Promise<Branch | null> {
  const all = await chrome.tabs.query({});
  const root = all.find((t) => t.id === rootId);
  if (!root) return null;

  const untouchable = await untouchableGroupIds();
  const groupable = (t: chrome.tabs.Tab) =>
    t.id !== undefined && !t.pinned && !untouchable.has(t.groupId);

  // Target window first: everything is about to be gathered there, so ordering by raw windowId
  // would interleave the incoming tabs with the ones already in place.
  const ordered = all
    .filter(groupable)
    .sort(
      (a, b) =>
        Number(b.windowId === targetWindowId) - Number(a.windowId === targetWindowId) ||
        a.windowId - b.windowId ||
        (a.index ?? 0) - (b.index ?? 0)
    );

  const parents = resolveParents(all, await readParents());
  // Walk over every live tab id, then keep only the groupable ones — so `skipped` counts the
  // members that were filtered rather than tabs that were never in the branch at all.
  const liveIds = all.filter((t) => t.id !== undefined).map((t) => t.id!);
  const inBranch = new Set(collectSubtree(rootId, parents, liveIds));
  const tabs = ordered.filter((t) => inBranch.has(t.id!));

  const members = all.filter((t) => t.id !== undefined && t.id !== rootId && inBranch.has(t.id));
  const rootIncluded = tabs.some((t) => t.id === rootId);

  let existingGroup: Branch["existingGroup"];
  if (rootIncluded && root.groupId !== -1 && root.windowId === targetWindowId) {
    const outsiders = all.some((t) => t.groupId === root.groupId && !inBranch.has(t.id!));
    if (!outsiders) {
      const group = (await chrome.tabGroups.query({ windowId: targetWindowId })).find((g) => g.id === root.groupId);
      if (group) existingGroup = { id: group.id, title: group.title || "" };
    }
  }

  return {
    root,
    windowId: targetWindowId,
    tabs,
    rootIncluded,
    skippedPinned: members.filter((t) => t.pinned).length,
    // Pinned wins the attribution when a tab is both: unpinning is the actionable half.
    skippedProtected: members.filter((t) => !t.pinned && untouchable.has(t.groupId)).length,
    existingGroup,
  };
}

/** A Chrome group title is a narrow strip; a full page title just gets clipped mid-word. */
function branchTitle(root: chrome.tabs.Tab): string {
  const title = (root.title || "").trim();
  if (title && title.length <= 24) return title;
  // getFullHostname already strips a leading "www.".
  const host = getFullHostname(root.url || "");
  return host || title.slice(0, 24) || "Branch";
}

/**
 * Pull a branch into a group of its own. Members already sitting in some other group are taken
 * out of it — that is the whole point of the command — and members in another window are moved
 * across, because Chrome will not group tabs that span windows.
 *
 * Group first, then bring the strays in. The obvious order is the reverse, and it is worse: a
 * tabs.group call rejected mid-drag (Chrome does that) would leave every stray already moved
 * and nothing grouped, which is both the ugliest half-state and the likeliest one. This way a
 * branch with no strays — the common case — is a single tabs.group call that either happens or
 * doesn't, and a late failure leaves a correctly titled group plus a few loose tabs.
 *
 * One path cannot have that: when the target window contributes no members at all, there is
 * nothing to anchor the group to, so a stray has to be moved in before the group can exist. A
 * rejection there does leave that one tab moved and ungrouped. Reaching it takes a branch
 * whose every target-window member is pinned or protected, and the undo snapshot the caller
 * takes first still covers it.
 *
 * When the branch already has a group of its own (Branch.existingGroup), nothing is rebuilt:
 * the members not yet in it are moved across and added, and the group keeps its title unless
 * the command supplied one. `added` is what actually changed; a caller seeing zero with no
 * title given knows the run was a no-op.
 */
export async function groupBranch(
  branch: Branch,
  title?: string
): Promise<{ grouped: number; moved: number; title: string; added: number; reused: boolean }> {
  const { root, windowId, tabs, existingGroup } = branch;
  const wanted = (title || "").trim();

  if (existingGroup) {
    const toAdd = tabs.filter((t) => t.groupId !== existingGroup.id);
    const strays = toAdd.filter((t) => t.windowId !== windowId).map((t) => t.id!);
    if (strays.length > 0) await chrome.tabs.move(strays, { windowId, index: -1 });
    if (toAdd.length > 0) {
      await chrome.tabs.group({ tabIds: toAdd.map((t) => t.id!), groupId: existingGroup.id });
    }
    // Rename on request only; the colour stays — the group is the user's, not this run's.
    if (wanted && wanted !== existingGroup.title) {
      await chrome.tabGroups.update(existingGroup.id, { title: wanted });
    }
    return {
      grouped: tabs.length,
      moved: strays.length,
      title: wanted || existingGroup.title,
      added: toAdd.length,
      reused: true,
    };
  }

  const moved = tabs.filter((t) => t.windowId !== windowId).length;

  let seed = tabs.filter((t) => t.windowId === windowId);
  let rest = tabs.filter((t) => t.windowId !== windowId);
  // A pinned or protected root can leave the target window contributing nothing, and
  // tabs.group needs at least one member to anchor the new group.
  if (seed.length === 0) {
    if (rest.length === 0) return { grouped: 0, moved: 0, title: "", added: 0, reused: false };
    const [first, ...others] = rest;
    await chrome.tabs.move(first.id!, { windowId, index: -1 });
    seed = [first];
    rest = others;
  }

  const groupId = await chrome.tabs.group({
    tabIds: seed.map((t) => t.id!),
    createProperties: { windowId },
  });
  const name = wanted || branchTitle(root);
  await chrome.tabGroups.update(groupId, {
    title: name,
    color: GROUP_COLORS[Math.abs(hashCode(name)) % GROUP_COLORS.length],
  });

  if (rest.length > 0) {
    const ids = rest.map((t) => t.id!);
    await chrome.tabs.move(ids, { windowId, index: -1 });
    await chrome.tabs.group({ tabIds: ids, groupId });
  }
  return { grouped: tabs.length, moved, title: name, added: tabs.length, reused: false };
}
