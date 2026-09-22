// The service worker's tab automations: auto-group, auto-ungroup, auto-sort, switch-to-existing
// and pin follow. Each export is one listener's body over an explicit AutomationState, so
// entrypoints/background/index.ts only wires them to their events and they can be tested
// against the chrome stub.

import { getConfig, matchDomainToRule, isIgnoredUrl, isIgnoredGroupName, type GroupRule, type RulesConfig } from "./rules.ts";
import { getFullHostname, getDomainMapper, getGroupNameMapper, planDomainGroup, domainGroupPartners, sortTabsInWindow, isSharedGroup, closeTabs } from "./tabs/index.ts";
import { findBounceTarget } from "./bounce.ts";
import { logAction } from "./actionLog.ts";
import { isBulkLocked } from "./bulklock.ts";
import { createSelfWriteLedger, type SelfWriteLedger } from "./selfwrite.ts";

// Never dissolve a group younger than this — another manager (or our own
// create→title two-step) may still be filling/titling it.
export const GROUP_SETTLE_MS = 2000;

// A tab created this recently waits out the rest of the window before auto-group looks at it,
// so other extensions can group their own tabs first.
export const NEW_TAB_GRACE_MS = 300;

// How long a tab counts as new: the grace above, and switch-to-existing, which only bounces a
// brand-new tab.
const RECENT_TAB_MS = 2000;

const UNGROUP_DEBOUNCE_MS = 150;

// Auto-sort waits this long after the last tab in a window finishes loading, so a burst of
// loads sorts the window once rather than once per tab.
export const SORT_SETTLE_MS = 250;

/** What the worker remembers between events. Memory only: MV3 tears the worker down on idle. */
export interface AutomationState {
  /** Tab ids TabOrdo itself just grouped/ungrouped, so listeners can tell our own echoes
   *  apart from external mutations and skip re-reacting to them. */
  selfWrites: SelfWriteLedger;
  /** Same idea for pin follow's writes, kept apart so a pin write never hides a group change
   *  on the same tab. Without it every copy pin follow updated would echo back as a pin change
   *  and start another pass, each one waking the worker and re-querying every tab. */
  pinSelfWrites: SelfWriteLedger;
  /** When this worker saw each group created, for the settle window. Groups created before
   *  this worker session have no entry and are treated as settled. */
  groupCreatedAt: Map<number, number>;
  /** Tabs created in the last RECENT_TAB_MS, with when. */
  recentTabs: Map<number, number>;
  ungroupTimers: Map<number, ReturnType<typeof setTimeout>>;
  /** Pending auto-sort per window, the windows being sorted now, and those owed one more
   *  sort because a load landed while theirs ran. */
  sortTimers: Map<number, ReturnType<typeof setTimeout>>;
  sortRunning: Set<number>;
  sortAgain: Set<number>;
}

export function createAutomationState(): AutomationState {
  return {
    selfWrites: createSelfWriteLedger(),
    pinSelfWrites: createSelfWriteLedger(),
    groupCreatedAt: new Map(),
    recentTabs: new Map(),
    ungroupTimers: new Map(),
    sortTimers: new Map(),
    sortRunning: new Set(),
    sortAgain: new Set(),
  };
}

export function noteTabCreated(state: AutomationState, tab: chrome.tabs.Tab): void {
  if (!tab.id) return;
  state.recentTabs.set(tab.id, Date.now());
  setTimeout(() => state.recentTabs.delete(tab.id!), RECENT_TAB_MS);
}

// --- Auto-ungroup ---------------------------------------------------------------------------

function scheduleAutoUngroup(state: AutomationState, windowId: number, delayMs = UNGROUP_DEBOUNCE_MS): void {
  const existing = state.ungroupTimers.get(windowId);
  if (existing) clearTimeout(existing);
  state.ungroupTimers.set(windowId, setTimeout(() => {
    state.ungroupTimers.delete(windowId);
    void autoUngroupSingleTabGroups(state, windowId);
  }, delayMs));
}

export interface AutoUngroupPlan {
  /** The lone tab of each group to dissolve, with the group's title for the action log. */
  ungroup: { tabId: number; title: string }[];
  /** Set when a single-tab group was too young to judge: how long until the first one settles. */
  settleInMs?: number;
}

/**
 * Which single-tab groups in one window to dissolve. Skips shared groups, groups younger than
 * GROUP_SETTLE_MS, untitled groups (other tools make those, and dissolving them started a
 * delete-and-recreate loop with them; TabOrdo's own groups always have titles), groups named
 * after a rule while rules are on, and names on the ignore list.
 */
export function planAutoUngroup(
  tabs: chrome.tabs.Tab[],
  groups: chrome.tabGroups.TabGroup[],
  config: RulesConfig,
  groupCreatedAt: ReadonlyMap<number, number>,
  now: number
): AutoUngroupPlan {
  const ruleNames = config.useRules ? new Set(config.rules.map((r) => r.name)) : null;
  const groupTitleMap = new Map(groups.map((g) => [g.id, g.title || ""]));
  const sharedGroupIds = new Set(groups.filter(isSharedGroup).map((g) => g.id));
  const members = new Map<number, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    if (tab.groupId !== -1) {
      if (!members.has(tab.groupId)) members.set(tab.groupId, []);
      members.get(tab.groupId)!.push(tab);
    }
  }

  const plan: AutoUngroupPlan = { ungroup: [] };
  for (const [groupId, groupTabs] of members) {
    if (groupTabs.length !== 1 || !groupTabs[0].id) continue;
    if (sharedGroupIds.has(groupId)) continue;
    const createdAt = groupCreatedAt.get(groupId);
    if (createdAt !== undefined) {
      const age = now - createdAt;
      if (age < GROUP_SETTLE_MS) {
        plan.settleInMs = Math.min(plan.settleInMs ?? Infinity, GROUP_SETTLE_MS - age);
        continue;
      }
    }
    const title = groupTitleMap.get(groupId);
    if (!title) continue;
    if (ruleNames && ruleNames.has(title)) continue;
    if (isIgnoredGroupName(title, config.ignoreGroupNames)) continue;
    plan.ungroup.push({ tabId: groupTabs[0].id, title });
  }
  return plan;
}

export async function autoUngroupSingleTabGroups(state: AutomationState, windowId: number): Promise<void> {
  try {
    if (await isBulkLocked()) return;
    const config = await getConfig();
    const [tabs, groups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups.query({ windowId }),
    ]);
    const plan = planAutoUngroup(tabs, groups, config, state.groupCreatedAt, Date.now());
    // A group still settling gets looked at again once it has.
    if (plan.settleInMs !== undefined) scheduleAutoUngroup(state, windowId, plan.settleInMs + UNGROUP_DEBOUNCE_MS);
    for (const { tabId, title } of plan.ungroup) {
      state.selfWrites.mark([tabId]);
      await chrome.tabs.ungroup(tabId);
      await logAction("Ungrouped", `"${title}" (single tab left)`);
    }
  } catch (e) {
    console.error("[TabOrdo] auto-ungroup error:", e);
  }
}

/** Auto-ungroup the window if the flag is on. `what` names the caller in the error log. */
async function scheduleAutoUngroupIfOn(state: AutomationState, windowId: number, what: string): Promise<void> {
  try {
    const config = await getConfig();
    if (config.autoUngroup) scheduleAutoUngroup(state, windowId);
  } catch (e) {
    console.error(`[TabOrdo] ${what}:`, e);
  }
}

export async function onTabRemoved(state: AutomationState, tabId: number, removeInfo: chrome.tabs.TabRemoveInfo): Promise<void> {
  state.recentTabs.delete(tabId);
  if (removeInfo.isWindowClosing) return;
  await scheduleAutoUngroupIfOn(state, removeInfo.windowId, "onRemoved config read");
}

/** A tab moved between groups, or in or out of one. Our own moves are skipped. */
export async function onTabRegrouped(
  state: AutomationState,
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): Promise<void> {
  if (changeInfo.groupId === undefined) return;
  if (state.selfWrites.has(tabId)) return;
  await scheduleAutoUngroupIfOn(state, tab.windowId, "onUpdated groupId");
}

/** A tab moved to another window: the group it left may be down to one tab. */
export async function onTabDetached(state: AutomationState, detachInfo: chrome.tabs.TabDetachInfo): Promise<void> {
  await scheduleAutoUngroupIfOn(state, detachInfo.oldWindowId, "onDetached");
}

/** Sweep every window when autoUngroup is switched on, so existing single-tab groups go too. */
export async function onConfigChanged(
  state: AutomationState,
  changes: Record<string, chrome.storage.StorageChange>,
  area: string
): Promise<void> {
  if (area !== "local" || !changes.rulesConfig) return;
  const oldOn = changes.rulesConfig.oldValue?.autoUngroup === true;
  const newOn = changes.rulesConfig.newValue?.autoUngroup === true;
  if (oldOn || !newOn) return;
  const wins = await chrome.windows.getAll().catch(() => []);
  for (const w of wins) {
    if (w.id !== undefined) scheduleAutoUngroup(state, w.id);
  }
}

// --- Auto-group -----------------------------------------------------------------------------

export async function safeGroupUpdate(groupId: number, props: chrome.tabGroups.UpdateProperties): Promise<void> {
  try {
    await chrome.tabGroups.update(groupId, props);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Saved groups") || msg.includes("not editable")) {
      console.warn("[TabOrdo] skipped update on saved/uneditable group", groupId);
      return;
    }
    throw e;
  }
}

/**
 * Join an existing group. False when it can't be joined (shared, or gone by now), and creating
 * a replacement is left to the caller: a rule makes a group of one on purpose, a domain never
 * does.
 *
 * Both callers take the group from a tabGroups.query they have just filtered with isSharedGroup,
 * so this no longer re-reads it with tabGroups.get to ask again. A group that has gone, or turned
 * shared, since that query makes tabs.group reject, and a rejection already comes back false.
 */
async function tryJoinGroup(selfWrites: SelfWriteLedger, tabId: number, groupId: number, title: string): Promise<boolean> {
  selfWrites.mark([tabId]);
  try {
    await chrome.tabs.group({ tabIds: [tabId], groupId });
    await logAction("Grouped", `tab into "${title}"`);
    return true;
  } catch (e) {
    console.warn("[TabOrdo] stale group", groupId, e);
    return false;
  }
}

/** The rule path: join the window's group named after the rule, or make it, one tab or not. */
async function groupByRule(selfWrites: SelfWriteLedger, tabId: number, windowId: number, rule: GroupRule): Promise<boolean> {
  const existingGroups = await chrome.tabGroups.query({ windowId });
  const match = existingGroups.find((g) => g.title === rule.name && !isSharedGroup(g));
  if (match && (await tryJoinGroup(selfWrites, tabId, match.id, rule.name))) return true;
  selfWrites.mark([tabId]);
  const groupId = await chrome.tabs.group({ tabIds: [tabId] }).catch((e) => { console.error("[TabOrdo] rule group create:", e); return null; });
  if (!groupId) return false;
  await safeGroupUpdate(groupId, { title: rule.name, color: rule.color });
  await logAction("Created group", `"${rule.name}" (rule)`);
  return true;
}

/** The domain path: join the site's group, or make one only with another loose tab of the site. */
async function groupByDomain(selfWrites: SelfWriteLedger, tabId: number, url: string, windowId: number, config: RulesConfig): Promise<boolean> {
  const [domainOf, nameOf, windowGroups] = await Promise.all([
    getDomainMapper(),
    getGroupNameMapper(),
    chrome.tabGroups.query({ windowId }),
  ]);
  const plan = planDomainGroup(url, windowGroups, domainOf, nameOf);
  if (!plan) return false;
  if (plan.joinGroupId !== undefined && (await tryJoinGroup(selfWrites, tabId, plan.joinGroupId, plan.title))) return true;
  // Tabs only once a join is off the table, and only the loose ones: this runs on every URL
  // change, and a join needs no tabs at all.
  const partnerIds = domainGroupPartners(
    tabId,
    plan.title,
    await chrome.tabs.query({ windowId, groupId: -1 }),
    nameOf,
    config.ignorePatterns
  );
  if (partnerIds.length === 0) return false;
  const memberIds = [tabId, ...partnerIds];
  selfWrites.mark(memberIds);
  const groupId = await chrome.tabs.group({ tabIds: memberIds }).catch((e) => { console.error("[TabOrdo] domain group create:", e); return null; });
  if (!groupId) return false;
  await safeGroupUpdate(groupId, { title: plan.title, color: plan.color });
  await logAction("Created group", `"${plan.title}" (${memberIds.length} tabs)`);
  return true;
}

/**
 * Group one loose tab by rule, or else by domain; true when the tab went into a group.
 * `chrome://` and ignored URLs are left alone. An ignored URL only opts out of *grouping*: the
 * auto-ungroup and auto-sort that follow in onTabNavigated still run for it, as they do for a
 * URL with no hostname.
 */
async function autoGroupTab(selfWrites: SelfWriteLedger, tabId: number, url: string, windowId: number, config: RulesConfig): Promise<boolean> {
  const hostname = getFullHostname(url);
  if (!hostname || url.startsWith("chrome://") || isIgnoredUrl(url, config.ignorePatterns)) return false;
  if (config.useRules) {
    const rule = matchDomainToRule(hostname, config.rules);
    if (rule) return groupByRule(selfWrites, tabId, windowId, rule);
  }
  return groupByDomain(selfWrites, tabId, url, windowId, config);
}

// --- Auto-sort ------------------------------------------------------------------------------

/**
 * Sort the window once loads in it have settled. Restarting the timer on every load turns a
 * burst into one sort; before, each tab that finished loading started a full sort of its own,
 * and with Chrome not awaiting listeners ten loads ran ten sorts at once, each moving blocks the
 * others had just moved: 1,208 tab moves and 998 regroups to open 200 tabs.
 */
export function scheduleAutoSort(state: AutomationState, windowId: number, delayMs = SORT_SETTLE_MS): void {
  const existing = state.sortTimers.get(windowId);
  if (existing) clearTimeout(existing);
  state.sortTimers.set(windowId, setTimeout(() => {
    state.sortTimers.delete(windowId);
    void runAutoSort(state, windowId);
  }, delayMs));
}

/** One sort per window at a time. A load that lands meanwhile earns one more, not one each. */
async function runAutoSort(state: AutomationState, windowId: number): Promise<void> {
  if (state.sortRunning.has(windowId)) {
    state.sortAgain.add(windowId);
    return;
  }
  state.sortRunning.add(windowId);
  try {
    // Read when the timer fires, not when it was set: the flag may have been turned off, or a
    // bulk action may have taken the lock, during the wait.
    const config = await getConfig();
    if (config.autoSort && !(await isBulkLocked())) await sortTabsInWindow(windowId);
  } catch (e) {
    console.error("[TabOrdo] auto-sort error:", e);
  } finally {
    state.sortRunning.delete(windowId);
    if (state.sortAgain.delete(windowId)) scheduleAutoSort(state, windowId, 0);
  }
}

/**
 * tabs.onUpdated: auto-group on a URL change, then auto-sort once the tab has loaded.
 *
 * The sort is scheduled, not run: it lands after the window's loads settle, so it sees the
 * groups auto-group made, including one made for a tab whose page had already finished loading,
 * which schedules a sort of its own.
 */
export async function onTabNavigated(
  state: AutomationState,
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): Promise<void> {
  if (!tab.url) return;
  const isComplete = changeInfo.status === "complete";
  const isUrlChange = !!changeInfo.url;
  if (!isComplete && !isUrlChange) return;

  const config = await getConfig();

  // Trigger on the URL change rather than the load, for responsiveness.
  if (isUrlChange && config.autoGroup && !tab.pinned && !(await isBulkLocked())) {
    try {
      const createdAt = state.recentTabs.get(tabId);
      if (createdAt) {
        const elapsed = Date.now() - createdAt;
        if (elapsed < NEW_TAB_GRACE_MS) await new Promise((r) => setTimeout(r, NEW_TAB_GRACE_MS - elapsed));
      }
      // Re-read after the wait: Chrome, or another extension, may have grouped it meanwhile.
      const freshTab = await chrome.tabs.get(tabId).catch(() => null);
      if (freshTab && freshTab.groupId === -1) {
        const grouped = await autoGroupTab(state.selfWrites, tabId, freshTab.url || tab.url, tab.windowId, config);
        if (grouped && config.autoSort) scheduleAutoSort(state, tab.windowId);
      }
      if (config.autoUngroup) scheduleAutoUngroup(state, tab.windowId);
    } catch (e) {
      console.error("[TabOrdo] auto-group error:", e);
    }
  }

  if (config.autoSort && isComplete) scheduleAutoSort(state, tab.windowId);
}

// --- Switch to existing ---------------------------------------------------------------------

/**
 * Switch to an existing tab instead of keeping a fresh duplicate. Fires only for brand-new
 * (recentTabs) foreground tabs on their first navigation — background-created tabs (restores,
 * bulk loads, middle-click) are never bounced.
 */
export async function switchToExisting(
  state: AutomationState,
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): Promise<void> {
  if (!changeInfo.url || !tab.active) return;
  if (!state.recentTabs.has(tabId)) return;
  try {
    const config = await getConfig();
    if (!config.switchToExisting) return;
    if (await isBulkLocked()) return;
    const allTabs = await chrome.tabs.query({});
    const target = findBounceTarget(allTabs, tabId, changeInfo.url, tab.openerTabId);
    if (!target) return;
    await chrome.tabs.update(target.id, { active: true });
    await chrome.windows.update(target.windowId, { focused: true });
    // No undo snapshot, on purpose: the tab is a second old with no history, and its URL
    // is live in the tab the user was just sent to. An entry would restore the very
    // duplicate this exists to remove, and evict a real one from the 20-slot stack.
    await closeTabs([tabId], { snapshot: false });
  } catch (e) {
    console.error("[TabOrdo] switch-to-existing error:", e);
  }
}

// --- Pin follow -----------------------------------------------------------------------------

/**
 * Give every other tab with the same URL the Chrome pin state this one just changed to.
 *
 * Its own listener: it shares no state with the grouping automations, and folding it into their
 * guard made every pin toggle run their prologue first, paying two storage round-trips to reach
 * a branch that needs neither.
 *
 * The copies are marked on pinSelfWrites before they are updated, so their echoes are skipped
 * whenever they arrive. No "pass in progress" flag on top: it could not catch echoes that arrive
 * after the pass, and it swallowed a real toggle on another tab that arrived during one.
 */
export async function followPinState(
  state: AutomationState,
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): Promise<void> {
  if (changeInfo.pinned === undefined || !tab.url) return;
  if (state.pinSelfWrites.has(tabId)) return;
  if (!(await getConfig()).autoPinFollow) return;

  try {
    const allTabs = await chrome.tabs.query({});
    const sameUrl = allTabs.filter((t) => t.id !== tabId && t.url === tab.url);
    const stale = sameUrl.filter((t) => t.pinned !== changeInfo.pinned);
    state.pinSelfWrites.mark(stale.map((t) => t.id!));
    for (const t of stale) {
      await chrome.tabs.update(t.id!, { pinned: changeInfo.pinned }).catch((e) => {
        console.warn("[TabOrdo] pin follow update failed:", e);
      });
    }
  } catch (e) {
    console.error("[TabOrdo] pin follow error:", e);
  }
}
