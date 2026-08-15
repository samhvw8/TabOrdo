// Palette action handlers, one per slash command.
//
// These used to be a ~300-line switch inside App.svelte's handleActionCommand, which meant
// the behaviour of every destructive command was only reachable by mounting the component —
// so none of it was tested. A handler here is an ordinary async function over ActionContext:
// unit-testable against the chrome stub, and adding a command is a one-file change.
//
// What stays in the component: the bulk lock, the busy flag, status-message timing, and
// /aigroup (which is deliberately run outside the lock — see App.svelte).

import {
  closeTabs, sortTabsInWindow, mergeAllWindows, removeDuplicates, muteTab, setTabVolume,
  splitTabToWindow, discardTabs, closeTabsToLeft, closeTabsToRight, closeTabsSameSite,
  closeOldTabs, shuffleTabs, uniteDomain, isolateDomain, splitWindow, splitByDomain,
  stackWindows, collapseAllGroups, moveCurrentTab, moveGroup, pinCurrentTab, unpinCurrentTab,
  pinCurrentGroup, unpinCurrentGroup, collectBranch, groupBranch, branchUpRoot,
  type MoveGroupsResult,
} from "./tabs/index.ts";
import { archiveTabs, isArchivable } from "./archive.ts";
import { snapshotBeforeClose, snapshotBeforeGroup } from "./undo.ts";
import { focusMode, unfocusMode, exportTabsToFile } from "./workspace.ts";
import { addTabsToReadingList, isReadingListAvailable } from "./readinglist.ts";
import { getRecentlyClosed, restoreSession } from "./sessions.ts";
import { rankedSearch, buildSearchHaystack, type SearchResult } from "./search.ts";

export const FEEDBACK_URL = "https://github.com/samhvw8/TabOrdo/issues";

export interface ActionContext {
  /** Text after the command prefix. Empty string when the user typed the bare command. */
  query: string;
  /** Tabs matched by `query`, already filtered to ones with a live tabId. */
  matchingTabs: SearchResult[];
  tabIds: number[];
  currentWindowId: number;
  /** Re-rank the full tab set against a secondary query — /vol's trailing filter needs it. */
  rankTabs: (query: string) => SearchResult[];
  /** Open the hidden file input. The element lives in the component. */
  requestFilePicker: () => void;
}

export interface ActionResult {
  /** Status to show. Undefined leaves whatever message was already on screen. */
  message?: string;
  /** True when tabs changed: the caller clears the query, refreshes undo, and reloads. */
  acted: boolean;
  /** The handler changed saved-workspace state; the caller re-reads hasSavedWorkspace(). */
  workspaceChanged?: boolean;
  /** A result list to display instead of the live tab search (/recent). */
  results?: SearchResult[];
}

export type ActionHandler = (ctx: ActionContext) => Promise<ActionResult>;

const NOTHING: ActionResult = { acted: false };

/** Group-count failures are the difference between "merged" and "merged, but lost your groups". */
export function mergeStatus(r: MoveGroupsResult): string {
  if (r.moved === 0) return "Nothing to merge";
  const base = `Merged ${r.moved} tab(s)`;
  return r.groupsFailed > 0 ? `${base} — ${r.groupsFailed} group(s) could not be rebuilt` : base;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Shared shape: act on matches, else fall back to the active tab, else do nothing. */
async function onMatchesOrActive(
  ctx: ActionContext,
  onMatches: (tabIds: number[]) => Promise<string>,
  onActive: (tab: chrome.tabs.Tab) => Promise<string>
): Promise<ActionResult> {
  if (ctx.tabIds.length > 0) return { message: await onMatches(ctx.tabIds), acted: true };
  // A query that matched nothing must NOT silently fall through to the active tab — the user
  // aimed at something specific and hitting a different tab would be worse than a no-op.
  if (ctx.query) return NOTHING;
  const tab = await activeTab();
  if (!tab?.id) return NOTHING;
  return { message: await onActive(tab), acted: true };
}

/**
 * /branch and /branchup are one gather run from two different roots — the active tab, or the
 * tab that opened it. Same body, so the "nothing to gather" wording stays in one place.
 *
 * The snapshot is taken only once the branch is known to be worth grouping: a no-op that still
 * pushed an undo entry would make Ctrl+Z pop something the user never did.
 */
async function gatherBranch(ctx: ActionContext, from: "self" | "parent"): Promise<ActionResult> {
  const tab = await activeTab();
  if (!tab?.id) return NOTHING;

  let rootId = tab.id;
  if (from === "parent") {
    const target = await branchUpRoot(tab.id);
    if (target.rootId === undefined) {
      return {
        // Having climbed means there *was* a parent and it is already in this group — saying
        // the tab wasn't opened from another would contradict what the user can see.
        message: target.climbed
          ? "Nothing left above — this branch is already gathered"
          : "No parent tab — this one wasn't opened from another",
        acted: false,
      };
    }
    rootId = target.rootId;
  }

  // The group forms in the window the user is looking at. For /branchup the root can be an
  // ancestor sitting in another window, and anchoring there would build the group off-screen.
  const branch = await collectBranch(rootId, tab.windowId);
  // A lone tab is not a branch, and a one-tab group is something autoUngroup would dissolve
  // out from under the user anyway.
  if (!branch || branch.tabs.length < 2) {
    // The root being left out is a different failure from "it opened nothing", and the user
    // can act on it. Chrome will not group a pinned tab, and a protected group stays whole.
    if (branch && !branch.rootIncluded) {
      return {
        message: branch.root.pinned
          ? "Root tab is pinned — Chrome can't group it"
          : "Root tab is in a protected group",
        acted: false,
      };
    }
    return {
      message:
        from === "parent"
          ? "Parent tab opened nothing else"
          : "No tabs were opened from this one",
      acted: false,
    };
  }

  await snapshotBeforeGroup();
  const { grouped, moved, title } = await groupBranch(branch, ctx.query);
  // Everything the command quietly declined to do gets said out loud — a member left behind in
  // a protected group is exactly the kind of omission that reads as a bug when it is silent.
  const notes: string[] = [];
  if (moved > 0) notes.push(`${moved} pulled from other window(s)`);
  if (!branch.rootIncluded) notes.push("root tab left out");
  if (branch.skippedPinned > 0) notes.push(`${branch.skippedPinned} pinned`);
  if (branch.skippedProtected > 0) notes.push(`${branch.skippedProtected} left in protected group(s)`);
  const suffix = notes.length > 0 ? ` — ${notes.join(", ")}` : "";
  return { message: `Grouped ${grouped} tab(s) into "${title}"${suffix}`, acted: true };
}

export const ACTION_HANDLERS: Record<string, ActionHandler> = {
  close: async (ctx) => {
    if (ctx.tabIds.length === 0) return NOTHING;
    await snapshotBeforeClose(ctx.tabIds);
    await closeTabs(ctx.tabIds);
    return { message: `Closed ${ctx.tabIds.length} tab(s)`, acted: true };
  },

  closeleft: async () => {
    const n = await closeTabsToLeft();
    return { message: n > 0 ? `Closed ${n} tab(s) to left` : "None to close", acted: true };
  },

  closeright: async () => {
    const n = await closeTabsToRight();
    return { message: n > 0 ? `Closed ${n} tab(s) to right` : "None to close", acted: true };
  },

  closeold: async () => {
    const n = await closeOldTabs();
    return { message: n > 0 ? `Closed ${n} old tab(s)` : "No old tabs found", acted: true };
  },

  closesite: async () => {
    const n = await closeTabsSameSite();
    return { message: n > 0 ? `Closed ${n} same-site tab(s)` : "No other tabs from this site", acted: true };
  },

  archive: async (ctx) => {
    if (ctx.tabIds.length === 0) return NOTHING;
    // Close exactly what was archived. This closed every match while archiveTabs skipped
    // urlless and newtab entries, so "Archived 8" could close 10 — and being the one
    // destructive handler with no snapshot, Ctrl+Z then popped some unrelated older entry.
    const eligible = ctx.matchingTabs.filter((t) => t.tabId !== undefined && isArchivable(t));
    if (eligible.length === 0) return { message: "Nothing to archive", acted: false };
    const tabIds = eligible.map((t) => t.tabId!);
    await snapshotBeforeClose(tabIds);
    const tabData = eligible.map((t) => ({ url: t.url, title: t.title, groupName: t.groupTitle }));
    const archived = await archiveTabs(tabData);
    await closeTabs(tabIds);
    return { message: `Archived ${archived} tab(s)`, acted: true };
  },

  group: async (ctx) => {
    if (ctx.tabIds.length === 0) return NOTHING;
    await snapshotBeforeGroup();
    const gid = await chrome.tabs.group({ tabIds: ctx.tabIds });
    await chrome.tabGroups.update(gid, { title: ctx.query || "Grouped" });
    return { message: `Grouped ${ctx.tabIds.length} tab(s)`, acted: true };
  },

  ungroup: async (ctx) => {
    if (ctx.tabIds.length > 0) {
      await snapshotBeforeGroup();
      await chrome.tabs.ungroup(ctx.tabIds);
      return { message: `Ungrouped ${ctx.tabIds.length} tab(s)`, acted: true };
    }
    if (ctx.query) return NOTHING;
    const tab = await activeTab();
    if (!tab?.id || tab.groupId === -1) return NOTHING;
    await snapshotBeforeGroup();
    await chrome.tabs.ungroup(tab.id);
    return { message: "Ungrouped current tab", acted: true };
  },

  merge: async () => {
    await snapshotBeforeGroup();
    return { message: mergeStatus(await mergeAllWindows()), acted: true };
  },

  sort: async (ctx) => {
    const allowed = ["title", "url", "domain"] as const;
    const sortBy = (allowed as readonly string[]).includes(ctx.query)
      ? (ctx.query as "title" | "url" | "domain")
      : "domain";
    await snapshotBeforeGroup();
    await sortTabsInWindow(ctx.currentWindowId, sortBy);
    return { message: `Sorted tabs by ${sortBy}`, acted: true };
  },

  dedup: async () => {
    const count = await removeDuplicates();
    return { message: count > 0 ? `Removed ${count} duplicate(s)` : "No duplicates found", acted: true };
  },

  // allSettled, like /reload above: the ids come from a list the popup built moments ago, and
  // one that has since gone stale must not abort the rest of the batch.
  mute: (ctx) => onMatchesOrActive(
    ctx,
    async (ids) => {
      await Promise.allSettled(ids.map((id) => muteTab(id, true)));
      return `Muted ${ids.length} tab(s)`;
    },
    async (tab) => { await muteTab(tab.id!, true); return "Muted active tab"; }
  ),

  unmute: (ctx) => onMatchesOrActive(
    ctx,
    async (ids) => {
      await Promise.allSettled(ids.map((id) => muteTab(id, false)));
      return `Unmuted ${ids.length} tab(s)`;
    },
    async (tab) => { await muteTab(tab.id!, false); return "Unmuted active tab"; }
  ),

  // Described as "send the active tab to a new window", but it used to require a query and
  // silently did nothing without one — the exact command the description invites you to type.
  split: (ctx) => onMatchesOrActive(
    ctx,
    async (ids) => { await splitTabToWindow(ids[0]); return "Split tab to new window"; },
    async (tab) => { await splitTabToWindow(tab.id!); return "Split tab to new window"; }
  ),

  extract: async () => {
    const tab = await activeTab();
    if (tab?.groupId && tab.groupId !== -1) {
      await chrome.windows.create({ tabId: tab.id! });
      return { message: "Extracted tab to new window", acted: true };
    }
    return { message: "Active tab is not in a group", acted: true };
  },

  // The trailing text is the group title, not a tab filter: the branch decides its own members.
  branch: (ctx) => gatherBranch(ctx, "self"),
  branchup: (ctx) => gatherBranch(ctx, "parent"),

  shuffle: async () => {
    await snapshotBeforeGroup();
    await shuffleTabs();
    return { message: "Shuffled tabs", acted: true };
  },

  unite: async () => {
    const n = await uniteDomain();
    return { message: n > 0 ? `United ${n} tab(s) from other windows` : "No matching tabs in other windows", acted: true };
  },

  isolate: async () => {
    const n = await isolateDomain();
    return { message: n > 0 ? `Isolated ${n} tab(s) to new window` : "Not enough tabs to isolate", acted: true };
  },

  splitv: async () => {
    await snapshotBeforeGroup();
    await splitWindow("vertical");
    return { message: "Split vertically", acted: true };
  },

  splith: async () => {
    await snapshotBeforeGroup();
    await splitWindow("horizontal");
    return { message: "Split horizontally", acted: true };
  },

  splitdomain: async () => {
    await snapshotBeforeGroup();
    const n = await splitByDomain();
    return { message: n > 0 ? `Split into ${n + 1} window(s)` : "Only one domain", acted: true };
  },

  stack: async () => {
    await stackWindows();
    return { message: "Stacked windows", acted: true };
  },

  focus: async () => {
    const n = await focusMode();
    return {
      message: n > 0 ? `Saved ${n} tab(s), focus mode on` : "No tabs to save",
      acted: true,
      workspaceChanged: true,
    };
  },

  unfocus: async () => {
    const n = await unfocusMode();
    return {
      message: n > 0 ? `Restored ${n} tab(s)` : "No saved workspace",
      acted: true,
      workspaceChanged: true,
    };
  },

  save: async () => {
    exportTabsToFile();
    return { message: "Exporting tabs...", acted: true };
  },

  load: async (ctx) => {
    ctx.requestFilePicker();
    return { acted: false };
  },

  feedback: async () => {
    await chrome.tabs.create({ url: FEEDBACK_URL });
    return { message: "Opening feedback page", acted: true };
  },

  discard: async (ctx) => {
    if (ctx.tabIds.length === 0) return NOTHING;
    await discardTabs(ctx.tabIds);
    return { message: `Discarded ${ctx.tabIds.length} tab(s)`, acted: true };
  },

  reload: async (ctx) => {
    if (ctx.tabIds.length === 0) return NOTHING;
    await Promise.allSettled(ctx.tabIds.map((id) => chrome.tabs.reload(id)));
    return { message: `Reloaded ${ctx.tabIds.length} tab(s)`, acted: true };
  },

  vol: async (ctx) => {
    const volMatch = ctx.query.match(/^(\d+)\s*(.*)/);
    if (!volMatch) return { message: "Usage: /vol 50 [search]", acted: true };
    const level = Math.max(0, Math.min(100, parseInt(volMatch[1])));
    const filter = volMatch[2].trim();

    if (filter) {
      const targets = ctx.rankTabs(filter).filter((t) => t.tabId);
      let ok = 0;
      for (const t of targets) if (await setTabVolume(t.tabId!, level / 100)) ok++;
      // Without host permissions only the active tab is scriptable — say so rather than
      // reporting success for tabs that were never touched.
      return {
        message: ok === targets.length
          ? `Volume ${level}% on ${ok} tab(s)`
          : `Volume ${level}% on ${ok}/${targets.length} tab(s) — the rest need page access (only the active tab is reachable)`,
        acted: true,
      };
    }

    const tab = await activeTab();
    if (!tab?.id) return { acted: true };
    const ok = await setTabVolume(tab.id, level / 100);
    return { message: ok ? `Volume ${level}% on active tab` : "Can't control volume on this page", acted: true };
  },

  collapse: async () => {
    const n = await collapseAllGroups();
    return { message: n > 0 ? `Collapsed ${n} group(s)` : "No groups to collapse", acted: true };
  },

  move: async (ctx) => ({ message: await moveCurrentTab(ctx.query), acted: true }),
  movegroup: async (ctx) => ({ message: await moveGroup(ctx.query), acted: true }),

  pin: async (ctx) => ({ message: await pinCurrentTab(ctx.query), acted: true }),
  unpin: async () => ({ message: await unpinCurrentTab(), acted: true }),
  pingroup: async (ctx) => ({ message: await pinCurrentGroup(ctx.query), acted: true }),
  unpingroup: async () => ({ message: await unpinCurrentGroup(), acted: true }),

  readlater: async (ctx) => {
    if (!isReadingListAvailable()) {
      return { message: "Reading List not available (requires Chrome 120+)", acted: true };
    }
    if (ctx.tabIds.length > 0) {
      const tabData = ctx.matchingTabs.map((t) => ({ url: t.url, title: t.title }));
      const added = await addTabsToReadingList(tabData);
      return { message: added > 0 ? `Added ${added} to Reading List` : "No valid tabs to add", acted: true };
    }
    if (ctx.query) return { acted: true };
    const tab = await activeTab();
    if (tab?.url && tab.title) {
      await addTabsToReadingList([{ url: tab.url, title: tab.title }]);
      return { message: "Added to Reading List", acted: true };
    }
    return { acted: true };
  },

  recent: async (ctx) => {
    const recentClosed = await getRecentlyClosed();
    const results = ctx.query
      ? rankedSearch(buildSearchHaystack(recentClosed), ctx.query).map((i) => recentClosed[i])
      : recentClosed;
    return {
      results,
      message: recentClosed.length === 0 ? "No recently closed tabs" : undefined,
      acted: false,
    };
  },

  sidepanel: async (ctx) => {
    if (!chrome.sidePanel) return { message: "Side Panel not available (Chrome 114+)", acted: true };
    await chrome.sidePanel.open({ windowId: ctx.currentWindowId });
    return { message: "Opened Side Panel", acted: true };
  },

  restore: async () => {
    const sessions = await chrome.sessions?.getRecentlyClosed?.({ maxResults: 1 }) ?? [];
    if (sessions.length === 0) return { message: "No recently closed tabs", acted: true };
    const sid = sessions[0].tab?.sessionId || sessions[0].window?.sessionId;
    if (!sid) return { message: "Nothing to restore", acted: true };
    await restoreSession(sid);
    return { message: "Restored last closed", acted: true };
  },

  freeze: async (ctx) => {
    if (ctx.tabIds.length > 0) {
      await discardTabs(ctx.tabIds);
      return { message: `Unloaded ${ctx.tabIds.length} tab(s)`, acted: true };
    }
    if (ctx.query) return NOTHING;
    const inactive = (await chrome.tabs.query({}))
      .filter((t) => !t.active && !t.pinned && !t.audible && !t.discarded);
    if (inactive.length === 0) return { message: "No tabs to unload", acted: true };
    await discardTabs(inactive.map((t) => t.id!));
    return { message: `Unloaded ${inactive.length} inactive tab(s)`, acted: true };
  },
};

// Aliases kept working for muscle memory; /lock and /pin are the same action.
ACTION_HANDLERS.lock = ACTION_HANDLERS.pin;
ACTION_HANDLERS.unlock = ACTION_HANDLERS.unpin;
ACTION_HANDLERS.lockgroup = ACTION_HANDLERS.pingroup;
ACTION_HANDLERS.unlockgroup = ACTION_HANDLERS.unpingroup;

/** Returns null for a prefix with no handler (e.g. /aigroup, run by the caller instead). */
export async function runAction(prefix: string, ctx: ActionContext): Promise<ActionResult | null> {
  const handler = ACTION_HANDLERS[prefix];
  return handler ? handler(ctx) : null;
}
