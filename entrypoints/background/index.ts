import { getConfig, matchDomainToRule, isIgnoredUrl, isIgnoredGroupName } from "../../lib/rules.ts";
import { getFullHostname, getDomainMapper, sortTabsInWindow, pickMajorityWindow, GROUP_COLORS, hashCode, setTitleBadge, recordOpener, lineageOpener, forgetTab, isSharedGroup } from "../../lib/tabs/index.ts";
import { syncPinUrl, clearPinTabIds } from "../../lib/pin.ts";
import { findBounceTarget } from "../../lib/bounce.ts";
import { logAction } from "../../lib/actionLog.ts";
import { addToReadingList } from "../../lib/readinglist.ts";
import { checkAIAvailability, suggestGroups, setAIProgress, getAIProgress, defaultProgress } from "../../lib/ai.ts";
import { isBulkLocked, acquireBulkLock, releaseBulkLock, newLockOwner, withBulkLock, AI_LEASE_MS } from "../../lib/bulklock.ts";
let pinSyncInProgress = false;
const ungroupTimers = new Map<number, ReturnType<typeof setTimeout>>();

// How often a live AI run re-ups its bulk-lock lease (see runAIGroup). Far inside
// AI_LEASE_MS, so suppression can't lapse between ticks.
const AI_LEASE_RENEW_MS = 60 * 1000;

// Never dissolve a group younger than this — another manager (or our own
// create→title two-step) may still be filling/titling it.
const GROUP_SETTLE_MS = 2000;
const groupCreatedAt = new Map<number, number>();

// Tab ids TabOrdo itself just grouped/ungrouped, so listeners can tell our own
// echoes apart from external mutations and skip re-reacting to them.
const SELF_WRITE_TTL_MS = 1000;
const selfWrites = new Map<number, number>();

// Both ledgers only ever pruned an entry when the *same* id was queried again, so ids nobody
// asks about again — a long AI run marks hundreds — sat there for the life of the worker. A
// recycled tab id landing on one of them would then suppress a genuine external mutation.
// Sweeping on write is enough: nothing reads an entry it wouldn't also have to write past.
function sweepExpired(ledger: Map<number, number>, now: number): void {
  for (const [id, t] of ledger) {
    if (now - t > SELF_WRITE_TTL_MS) ledger.delete(id);
  }
}

function markSelfWrite(tabIds: number[]): void {
  const now = Date.now();
  sweepExpired(selfWrites, now);
  for (const id of tabIds) selfWrites.set(id, now);
}

function isRecentSelfWrite(tabId: number): boolean {
  const t = selfWrites.get(tabId);
  if (t === undefined) return false;
  if (Date.now() - t > SELF_WRITE_TTL_MS) {
    selfWrites.delete(tabId);
    return false;
  }
  return true;
}

// Same idea, separate ledger for pin-state writes. The pinSyncInProgress flag alone couldn't
// suppress the echoes: Chrome dispatches the onUpdated events our own tabs.update calls
// generate *after* the loop has finished and cleared the flag, so every synced tab kicked off
// another full pass. They converged (the state already matched) but each one woke the worker
// and re-queried every tab in the profile.
const pinSelfWrites = new Map<number, number>();

function markPinSelfWrite(tabIds: number[]): void {
  const now = Date.now();
  sweepExpired(pinSelfWrites, now);
  for (const id of tabIds) pinSelfWrites.set(id, now);
}

function isRecentPinSelfWrite(tabId: number): boolean {
  const t = pinSelfWrites.get(tabId);
  if (t === undefined) return false;
  if (Date.now() - t > SELF_WRITE_TTL_MS) {
    pinSelfWrites.delete(tabId);
    return false;
  }
  return true;
}

function scheduleAutoUngroup(windowId: number, delayMs = 150): void {
  const existing = ungroupTimers.get(windowId);
  if (existing) clearTimeout(existing);
  ungroupTimers.set(windowId, setTimeout(() => {
    ungroupTimers.delete(windowId);
    autoUngroupSingleTabGroups(windowId);
  }, delayMs));
}

async function autoUngroupSingleTabGroups(windowId: number): Promise<void> {
  try {
    if (await isBulkLocked()) return;
    const config = await getConfig();
    const ruleNames = config.useRules ? new Set(config.rules.map((r) => r.name)) : null;
    const [allTabs, allGroups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups.query({ windowId }),
    ]);
    const groupTitleMap = new Map(allGroups.map((g) => [g.id, g.title || ""]));
    const sharedGroupIds = new Set(allGroups.filter(isSharedGroup).map((g) => g.id));
    const groupCounts = new Map<number, chrome.tabs.Tab[]>();
    for (const tab of allTabs) {
      if (tab.groupId !== -1) {
        if (!groupCounts.has(tab.groupId)) groupCounts.set(tab.groupId, []);
        groupCounts.get(tab.groupId)!.push(tab);
      }
    }
    for (const [groupId, tabs] of groupCounts) {
      if (tabs.length !== 1 || !tabs[0].id) continue;
      if (sharedGroupIds.has(groupId)) continue;
      const createdAt = groupCreatedAt.get(groupId);
      if (createdAt !== undefined) {
        const age = Date.now() - createdAt;
        if (age < GROUP_SETTLE_MS) {
          scheduleAutoUngroup(windowId, GROUP_SETTLE_MS - age + 150);
          continue;
        }
      }
      const title = groupTitleMap.get(groupId);
      if (!title) continue;
      if (ruleNames && ruleNames.has(title)) continue;
      if (isIgnoredGroupName(title, config.ignoreGroupNames)) continue;
      markSelfWrite([tabs[0].id]);
      await chrome.tabs.ungroup(tabs[0].id);
      await logAction("Ungrouped", `"${title}" (single tab left)`);
    }
  } catch (e) {
    console.error("[TabOrdo] auto-ungroup error:", e);
  }
}

async function safeGroupUpdate(groupId: number, props: chrome.tabGroups.UpdateProperties): Promise<void> {
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

async function tryGroupTab(tabId: number, groupId: number, title: string, color: chrome.tabGroups.ColorEnum): Promise<void> {
  try {
    const group = await chrome.tabGroups.get(groupId).catch(() => null);
    if (group && isSharedGroup(group)) return;
  } catch {}
  markSelfWrite([tabId]);
  try {
    await chrome.tabs.group({ tabIds: [tabId], groupId });
    await logAction("Grouped", `tab into "${title}"`);
  } catch (e) {
    console.warn("[TabOrdo] stale group", groupId, "- creating new:", e);
    const newGroupId = await chrome.tabs.group({ tabIds: [tabId] }).catch((e2) => { console.error("[TabOrdo] fallback group create:", e2); return null; });
    if (newGroupId) {
      await safeGroupUpdate(newGroupId, { title, color });
      await logAction("Created group", `"${title}"`);
    }
  }
}

/**
 * Register a startup listener without letting one failure take the rest down with it.
 *
 * Every listener below runs at the top level of the service worker, so a throw in any of them
 * aborts the whole script and every listener *after* it silently never registers. That is not
 * hypothetical: `chrome.commands.onCommand.addListener` used to be the first statement here,
 * unguarded, and an undefined `chrome.commands` — a build whose manifest lost the key, a
 * non-Chrome target — would kill auto-group, auto-sort, auto-discard, the context menus and
 * the AI runner in one go, leaving a single "Cannot read properties of undefined" in
 * chrome://extensions as the only clue. A missing optional API should cost you that one
 * feature, not all of them.
 */
function register(what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error(`[TabOrdo] could not register ${what}:`, e);
  }
}

export default defineBackground(() => {
  // Needs the manifest "commands" key; absent without it.
  register("commands.onCommand", () => {
    chrome.commands.onCommand.addListener(async (command) => {
      if (command === "open-dashboard") {
        // The flag is consumed by the popup on mount. If openPopup fails (it needs Chrome 127+,
        // and rejects when no window is focused) a stale flag would sit in session storage and
        // silently steal search autofocus from the *next* ordinary Cmd+E open.
        await chrome.storage.session.set({ openMode: "dashboard" });
        try {
          await chrome.action.openPopup();
        } catch (e) {
          console.warn("[TabOrdo] openPopup failed:", e);
          await chrome.storage.session.remove("openMode").catch(() => {});
        }
      }
    });
  });

  const recentTabs = new Map<number, number>();
  register("tabs.onCreated", () => {
    chrome.tabs.onCreated.addListener((tab) => {
      if (tab.id) {
        recentTabs.set(tab.id, Date.now());
        setTimeout(() => recentTabs.delete(tab.id!), 2000);
      }
    });
  });

  // Tab lineage for /branch and /branchup. Recorded here rather than read on demand because
  // tab.openerTabId is only readable while the opener is still open, and gathering a reading
  // branch is most useful precisely after you have closed the listing page you started from.
  // Registered apart from the recentTabs listener above so a failure in one costs only itself.
  register("tabs.onCreated (lineage)", () => {
    chrome.tabs.onCreated.addListener((tab) => {
      // lineageOpener also turns a Ctrl+T new-tab page into an explicit root: Chrome names the
      // tab you were on as its opener, and whatever gets typed there is not part of a branch.
      const opener = lineageOpener(tab);
      if (opener !== undefined) void recordOpener(tab.id!, opener);
    });
  });

  register("tabs.onRemoved (lineage)", () => {
    chrome.tabs.onRemoved.addListener((tabId) => {
      // Deliberately no isWindowClosing early-out. The splice is the point: a closing tab's
      // children inherit its parent, so a branch survives losing a tab in the middle of it.
      // Skipping window teardown would drop that for every tab in the window.
      void forgetTab(tabId);
    });
  });

  // Track group ages for the settle-window guard. Groups created before this
  // worker session have no entry and are treated as settled.
  register("tabGroups.onCreated", () => {
    chrome.tabGroups.onCreated.addListener((group) => {
      groupCreatedAt.set(group.id, Date.now());
    });
  });
  register("tabGroups.onRemoved", () => {
    chrome.tabGroups.onRemoved.addListener((group) => {
      groupCreatedAt.delete(group.id);
    });
  });
  register("tabs.onRemoved", () => {
    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
      recentTabs.delete(tabId);
      if (removeInfo.isWindowClosing) return;
      try {
        const config = await getConfig();
        if (!config.autoUngroup) return;
        scheduleAutoUngroup(removeInfo.windowId);
      } catch (e) {
        console.error("[TabOrdo] onRemoved config read:", e);
      }
    });
  });

  // Switch to an existing tab instead of keeping a fresh duplicate.
  // Fires only for brand-new (recentTabs) foreground tabs on their first navigation —
  // background-created tabs (restores, bulk loads, middle-click) are never bounced.
  register("tabs.onUpdated (switch-to-existing)", () => {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (!changeInfo.url || !tab.active) return;
      if (!recentTabs.has(tabId)) return;
      try {
        const config = await getConfig();
        if (!config.switchToExisting) return;
        if (await isBulkLocked()) return;
        const allTabs = await chrome.tabs.query({});
        const target = findBounceTarget(allTabs, tabId, changeInfo.url, tab.openerTabId);
        if (!target) return;
        await chrome.tabs.update(target.id, { active: true });
        await chrome.windows.update(target.windowId, { focused: true });
        await chrome.tabs.remove(tabId);
      } catch (e) {
        console.error("[TabOrdo] switch-to-existing error:", e);
      }
    });
  });

  // Tab moved between groups / in or out of a group — fires changeInfo.groupId
  register("tabs.onUpdated (groupId)", () => {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.groupId === undefined) return;
      if (isRecentSelfWrite(tabId)) return;
      try {
        const config = await getConfig();
        if (config.autoUngroup) scheduleAutoUngroup(tab.windowId);
      } catch (e) {
        console.error("[TabOrdo] onUpdated groupId:", e);
      }
    });
  });

  // Sync pinned tab URL and title when a tab navigates or finishes loading
  register("tabs.onUpdated (pin URL sync)", () => {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      const navDone = changeInfo.status === "complete";
      if (!changeInfo.url && !changeInfo.title && !navDone) return;
      try {
        const pin = await syncPinUrl(tabId, tab.url || "", tab.title);
        // A full navigation tears down the injected MutationObserver with the page, leaving
        // the pin live but unbadged — re-apply once the new document has settled. Idempotent
        // in-page, so the title echo this causes converges instead of looping.
        if (pin && navDone) await setTitleBadge(tabId, true);
      } catch (e) {
        console.error("[TabOrdo] pin URL sync error:", e);
      }
    });
  });

  // Tab moved to another window — old window's group may have shrunk to 1
  register("tabs.onDetached", () => {
    chrome.tabs.onDetached.addListener(async (_tabId, detachInfo) => {
      try {
        const config = await getConfig();
        if (config.autoUngroup) scheduleAutoUngroup(detachInfo.oldWindowId);
      } catch (e) {
        console.error("[TabOrdo] onDetached:", e);
      }
    });
  });

  // Sweep all windows when autoUngroup toggles ON, so existing 1-tab groups get dissolved
  register("storage.onChanged", () => {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local" || !changes.rulesConfig) return;
      const oldOn = changes.rulesConfig.oldValue?.autoUngroup === true;
      const newOn = changes.rulesConfig.newValue?.autoUngroup === true;
      if (oldOn || !newOn) return;
      const wins = await chrome.windows.getAll().catch(() => []);
      for (const w of wins) {
        if (w.id !== undefined) scheduleAutoUngroup(w.id);
      }
    });
  });

  // Auto-group and other tab automations
  register("tabs.onUpdated (auto-group/auto-sort)", () => {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (!tab.url) return;
      const isComplete = changeInfo.status === "complete";
      const isUrlChange = !!changeInfo.url;
      if (!isComplete && !isUrlChange) return;

      const config = await getConfig();

      // Auto-group by domain (or rules if enabled) — trigger on URL change for responsiveness
      if (isUrlChange && config.autoGroup && !tab.pinned && !(await isBulkLocked())) {
        try {
          // For recently created tabs, wait so other extensions can group them first
          const createdAt = recentTabs.get(tabId);
          if (createdAt) {
            const elapsed = Date.now() - createdAt;
            if (elapsed < 300) await new Promise((r) => setTimeout(r, 300 - elapsed));
          }
          const freshTab = await chrome.tabs.get(tabId).catch(() => null);
          if (freshTab && freshTab.groupId === -1) {
            const url = freshTab.url || tab.url;
            const hostname = getFullHostname(url);
            // An ignored URL only opts out of *grouping*. Returning here instead skipped the
            // auto-ungroup and auto-sort below too, which the hostname guard beside it does not.
            if (hostname && !url.startsWith("chrome://") && !isIgnoredUrl(url, config.ignorePatterns)) {
              let grouped = false;
              if (config.useRules) {
                const rule = matchDomainToRule(hostname, config.rules);
                if (rule) {
                  const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
                  const match = existingGroups.find((g) => g.title === rule.name && !isSharedGroup(g));
                  if (match) {
                    await tryGroupTab(tabId, match.id, rule.name, rule.color);
                  } else {
                    markSelfWrite([tabId]);
                    const groupId = await chrome.tabs.group({ tabIds: [tabId] }).catch((e) => { console.error("[TabOrdo] rule group create:", e); return null; });
                    if (groupId) {
                      await safeGroupUpdate(groupId, { title: rule.name, color: rule.color });
                      await logAction("Created group", `"${rule.name}" (rule)`);
                    }
                  }
                  grouped = true;
                }
              }
              if (!grouped) {
                const domainOf = await getDomainMapper();
                const domain = domainOf(url);
                if (domain) {
                  const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
                  const match = existingGroups.find((g) => g.title === domain && !isSharedGroup(g));
                  if (match) {
                    await tryGroupTab(tabId, match.id, domain, GROUP_COLORS[Math.abs(hashCode(domain)) % GROUP_COLORS.length]);
                  } else {
                    const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
                    const sameDomain = windowTabs.filter((t) => t.id !== tabId && t.groupId === -1 && domainOf(t.url || "") === domain);
                    if (sameDomain.length > 0) {
                      const memberIds = [tabId, ...sameDomain.map((t) => t.id!)];
                      markSelfWrite(memberIds);
                      const groupId = await chrome.tabs.group({ tabIds: memberIds }).catch((e) => { console.error("[TabOrdo] domain group create:", e); return null; });
                      if (groupId) {
                        await safeGroupUpdate(groupId, { title: domain, color: GROUP_COLORS[Math.abs(hashCode(domain)) % GROUP_COLORS.length] });
                        await logAction("Created group", `"${domain}" (${memberIds.length} tabs)`);
                      }
                    }
                  }
                }
              }
            }
          }
          if (config.autoUngroup) {
            scheduleAutoUngroup(tab.windowId);
          }
        } catch (e) {
          console.error("[TabOrdo] auto-group error:", e);
        }
      }

      // Auto-sort on tab load.
      // Kept in this listener rather than its own: it is ordering-coupled to auto-group above,
      // which is awaited first so the sort sees the group that was just created. Chrome does
      // not await listeners, so splitting them would let the two interleave.
      if (config.autoSort && changeInfo.status === "complete" && !(await isBulkLocked())) {
        await sortTabsInWindow(tab.windowId);
      }
    });
  });

  // Auto pin follow — its own listener. It shares no state with the grouping automations,
  // and folding it into their guard made every pin toggle run their prologue first, paying
  // two storage round-trips to reach a branch that needs neither.
  register("tabs.onUpdated (pin follow)", () => {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.pinned === undefined || !tab.url) return;
      if (pinSyncInProgress) return;
      if (isRecentPinSelfWrite(tabId)) return;
      if (!(await getConfig()).autoPinFollow) return;

      pinSyncInProgress = true;
      try {
        const allTabs = await chrome.tabs.query({});
        const sameUrl = allTabs.filter((t) => t.id !== tabId && t.url === tab.url);
        const stale = sameUrl.filter((t) => t.pinned !== changeInfo.pinned);
        markPinSelfWrite(stale.map((t) => t.id!));
        for (const t of stale) {
          await chrome.tabs.update(t.id!, { pinned: changeInfo.pinned }).catch((e) => {
            console.warn("[TabOrdo] pin follow update failed:", e);
          });
        }
      } catch (e) {
        console.error("[TabOrdo] pin follow error:", e);
      } finally {
        pinSyncInProgress = false;
      }
    });
  });

  // Auto-discard alarm
  const DISCARD_ALARM = "autoDiscard";

  register("runtime.onInstalled", () => {
    chrome.runtime.onInstalled.addListener(() => {
      chrome.alarms.create(DISCARD_ALARM, { periodInMinutes: 5 });

      if (chrome.contextMenus) {
        chrome.contextMenus.removeAll(() => {
          chrome.contextMenus.create({ id: "tabOrdo-group-domain", title: "Group tabs by domain", contexts: ["action"] });
          chrome.contextMenus.create({ id: "tabOrdo-dedup", title: "Remove duplicate tabs", contexts: ["action"] });
          chrome.contextMenus.create({ id: "tabOrdo-sort", title: "Sort tabs by domain", contexts: ["action"] });
          chrome.contextMenus.create({ type: "separator", id: "tabOrdo-sep1", contexts: ["action"] });
          if (chrome.readingList) {
            chrome.contextMenus.create({ id: "tabOrdo-readlater", title: "Save to Reading List", contexts: ["action"] });
          }
          chrome.contextMenus.create({ id: "tabOrdo-discard", title: "Discard inactive tabs", contexts: ["action"] });
          if (chrome.sidePanel) {
            chrome.contextMenus.create({ type: "separator", id: "tabOrdo-sep2", contexts: ["action"] });
            chrome.contextMenus.create({ id: "tabOrdo-sidepanel", title: "Open in Side Panel", contexts: ["action"] });
          }
        });
      }
    });
  });

  if (chrome.contextMenus) {
    register("contextMenus.onClicked", () => {
      chrome.contextMenus.onClicked.addListener(async (info) => {
        try {
          switch (info.menuItemId) {
            // These three do the same bulk rearranging the palette does, so they need the same
            // suppression — without it the auto-group/sort/ungroup listeners react to the very
            // mutations these are making. The palette wrapped them; this path never did.
            case "tabOrdo-group-domain": {
              const { groupTabsByDomain } = await import("../../lib/tabs/index.ts");
              await withBulkLock(() => groupTabsByDomain("additive"));
              break;
            }
            case "tabOrdo-dedup": {
              const { removeDuplicates } = await import("../../lib/tabs/index.ts");
              await withBulkLock(() => removeDuplicates());
              break;
            }
            case "tabOrdo-sort": {
              const win = await chrome.windows.getCurrent();
              await withBulkLock(() => sortTabsInWindow(win.id!));
              break;
            }
            case "tabOrdo-readlater": {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab?.url && tab.title) await addToReadingList(tab.url, tab.title);
              break;
            }
            case "tabOrdo-discard": {
              const tabs = await chrome.tabs.query({});
              for (const tab of tabs) {
                if (!tab.active && !tab.pinned && !tab.audible && !tab.discarded) {
                  await chrome.tabs.discard(tab.id!).catch(() => {});
                }
              }
              break;
            }
            case "tabOrdo-sidepanel":
              if (chrome.sidePanel) {
                await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id! });
              }
              break;
          }
        } catch (e) {
          console.error("[TabOrdo] context menu error:", e);
        }
      });
    });
  }

  // The popup reads AI progress straight from session storage, so there is no status message
  // to answer here — only the start request.
  register("runtime.onMessage", () => {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "aigroup-start") {
        // Without the catch, anything rejecting before the run's own try left sendResponse
        // uncalled — the popup then waits on a port that will never answer.
        runAIGroup()
          .then((result) => sendResponse(result))
          .catch((e) => sendResponse({ ok: false, message: String(e) }));
        return true;
      }
    });
  });

  async function runAIGroup(): Promise<{ ok: boolean; message: string }> {
    const current = await getAIProgress();
    if (current.status === "checking" || current.status === "prompting" || current.status === "grouping") {
      return { ok: false, message: "AI grouping already in progress" };
    }

    // Hold the bulk lock for the whole run: the popup releases its own lock as soon as it
    // fires the message, so without this the auto-group/sort/ungroup listeners fight the AI.
    // The lease is ours alone — a popup finishing its own bulk action, or being reopened,
    // can no longer clear a lock this run is still holding.
    //
    // Taken before the availability check and the tab query rather than after: those can
    // reject too, and outside the try their rejection skipped the release and left the whole
    // profile suppressed for the ten-minute lease.
    const lockOwner = newLockOwner();
    // Renew the lease while the run is live. A single fixed lease silently lapsed under a
    // first-use model download or an oversized tab set, leaving the rest of the run
    // unsuppressed; the interval keeps it standing however long suggestGroups takes.
    let renewInFlight: Promise<void> = Promise.resolve();
    const renewTimer = setInterval(() => {
      renewInFlight = acquireBulkLock(lockOwner, AI_LEASE_MS);
    }, AI_LEASE_RENEW_MS);
    try {
      await acquireBulkLock(lockOwner, AI_LEASE_MS);

      await setAIProgress({ ...defaultProgress(), status: "checking" });
      const ai = await checkAIAvailability();
      if (!ai.available) {
        await setAIProgress({ ...defaultProgress(), status: "error", error: ai.reason });
        return { ok: false, message: ai.reason };
      }

      const ungroupedTabs = (await chrome.tabs.query({})).filter(
        (t) => t.groupId === -1 && !t.pinned && t.url && !t.url.startsWith("chrome://")
      );
      if (ungroupedTabs.length < 2) {
        await setAIProgress({ ...defaultProgress(), status: "error", error: "Need 2+ ungrouped tabs" });
        return { ok: false, message: "Need 2+ ungrouped tabs" };
      }

      const tabData = ungroupedTabs.map((t) => ({ id: t.id!, title: t.title || "", url: t.url || "" }));
      await setAIProgress({
        status: "prompting", total: tabData.length, processed: 0,
        currentTab: `Sending ${tabData.length} tabs to on-device AI...`,
        grouped: 0, groupCount: 0, error: "",
      });

      const suggestions = await suggestGroups(tabData);
      if (suggestions.length === 0) {
        await setAIProgress({ ...defaultProgress(), status: "done", total: tabData.length, processed: tabData.length });
        return { ok: true, message: "AI found no groups to suggest" };
      }

      await setAIProgress({
        status: "grouping", total: tabData.length, processed: tabData.length,
        currentTab: `Creating ${suggestions.length} groups...`,
        grouped: 0, groupCount: suggestions.length, error: "",
      });

      let grouped = 0;
      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i];
        if (s.tabIds.length < 1) continue;
        await setAIProgress({
          status: "grouping", total: tabData.length, processed: tabData.length,
          currentTab: `Creating group "${s.groupName}" (${i + 1}/${suggestions.length})`,
          grouped, groupCount: suggestions.length, error: "",
        });
        // The AI groups by topic across every window, but chrome.tabs.group rejects tab ids
        // that span windows — consolidate into the window holding most of them first.
        const members = (await Promise.all(s.tabIds.map((id) => chrome.tabs.get(id).catch(() => null))))
          .filter((t): t is chrome.tabs.Tab => t !== null);
        if (members.length === 0) continue;
        const targetWindowId = pickMajorityWindow(members);
        const strays = members.filter((t) => t.windowId !== targetWindowId).map((t) => t.id!);
        if (strays.length > 0) {
          await chrome.tabs.move(strays, { windowId: targetWindowId, index: -1 });
        }
        const memberIds = members.map((t) => t.id!);
        markSelfWrite(memberIds);
        const gid = await chrome.tabs.group({ tabIds: memberIds, createProperties: { windowId: targetWindowId } });
        await safeGroupUpdate(gid, { title: s.groupName, color: s.color as chrome.tabGroups.ColorEnum });
        grouped += memberIds.length;
      }

      const msg = `AI grouped ${grouped} tab(s) into ${suggestions.length} group(s)`;
      await setAIProgress({
        status: "done", total: tabData.length, processed: tabData.length,
        currentTab: msg, grouped, groupCount: suggestions.length, error: "",
      });
      return { ok: true, message: msg };
    } catch (e) {
      const err = e instanceof Error ? e.message : "AI grouping failed";
      await setAIProgress({ ...defaultProgress(), status: "error", error: err });
      return { ok: false, message: err };
    } finally {
      clearInterval(renewTimer);
      // A renewal whose read landed before this release would write the full lease back
      // after it — wait out any in-flight tick so the release is the last word.
      await renewInFlight;
      await releaseBulkLock(lockOwner);
    }
  }

  register("runtime.onStartup", () => {
    chrome.runtime.onStartup.addListener(async () => {
      // Tab ids are per-browser-session, and the new session reuses the same small range —
      // a stale pin.tabId therefore lands on an unrelated tab, and syncPinUrl (tabId-only
      // match) would rewrite the pin to wherever that tab goes. Shed them; URL matching
      // backfills fresh ids. Deliberately not in onInstalled: an extension reload keeps the
      // browser session, so the stored ids are still the right tabs there.
      await clearPinTabIds().catch((e) => console.error("[TabOrdo] pin tabId reset:", e));
      const alarm = await chrome.alarms.get(DISCARD_ALARM);
      if (!alarm) {
        chrome.alarms.create(DISCARD_ALARM, { periodInMinutes: 5 });
      }
    });
  });

  register("alarms.onAlarm", () => {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name !== DISCARD_ALARM) return;
      const config = await getConfig();
      if (!config.autoDiscard) return;
      const cutoff = Date.now() - 45 * 60 * 1000;
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.active || tab.pinned || tab.audible || tab.discarded || (tab as any).frozen) continue;
        if ((tab.lastAccessed || 0) < cutoff) {
          await chrome.tabs.discard(tab.id!).catch(() => {});
        }
      }
    });
  });

});

