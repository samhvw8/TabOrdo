import { getConfig, matchDomainToRule, isIgnoredUrl, isIgnoredGroupName } from "../../lib/rules.ts";
import { getFullHostname, getDomain, sortTabsInWindow, GROUP_COLORS, hashCode } from "../../lib/tabs.ts";
import { syncPinUrl } from "../../lib/pin.ts";
import { findBounceTarget } from "../../lib/bounce.ts";
import { logAction } from "../../lib/actionLog.ts";
import { addToReadingList } from "../../lib/readinglist.ts";
import { checkAIAvailability, suggestGroups, setAIProgress, getAIProgress, defaultProgress } from "../../lib/ai.ts";
let pinSyncInProgress = false;
const ungroupTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Never dissolve a group younger than this — another manager (or our own
// create→title two-step) may still be filling/titling it.
const GROUP_SETTLE_MS = 2000;
const groupCreatedAt = new Map<number, number>();

// Tab ids TabOrdo itself just grouped/ungrouped, so listeners can tell our own
// echoes apart from external mutations and skip re-reacting to them.
const SELF_WRITE_TTL_MS = 1000;
const selfWrites = new Map<number, number>();

function markSelfWrite(tabIds: number[]): void {
  const now = Date.now();
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
    const session = await chrome.storage.session.get("bulkOpInProgress").catch((): Record<string, unknown> => ({}));
    if (session.bulkOpInProgress) return;
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

function isSharedGroup(group: chrome.tabGroups.TabGroup): boolean {
  return (group as any).shared === true;
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

export default defineBackground(() => {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "open-dashboard") {
      await chrome.storage.session.set({ openMode: "dashboard" });
      await chrome.action.openPopup();
    }
  });

  const recentTabs = new Map<number, number>();
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) {
      recentTabs.set(tab.id, Date.now());
      setTimeout(() => recentTabs.delete(tab.id!), 2000);
    }
  });

  // Track group ages for the settle-window guard. Groups created before this
  // worker session have no entry and are treated as settled.
  chrome.tabGroups.onCreated.addListener((group) => {
    groupCreatedAt.set(group.id, Date.now());
  });
  chrome.tabGroups.onRemoved.addListener((group) => {
    groupCreatedAt.delete(group.id);
  });
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

  // Switch to an existing tab instead of keeping a fresh duplicate.
  // Fires only for brand-new (recentTabs) foreground tabs on their first navigation —
  // background-created tabs (restores, bulk loads, middle-click) are never bounced.
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!changeInfo.url || !tab.active) return;
    if (!recentTabs.has(tabId)) return;
    try {
      const config = await getConfig();
      if (!config.switchToExisting) return;
      const session = await chrome.storage.session.get("bulkOpInProgress").catch((): Record<string, unknown> => ({}));
      if (session.bulkOpInProgress) return;
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

  // Tab moved between groups / in or out of a group — fires changeInfo.groupId
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

  // Sync pinned tab URL and title when a tab navigates or finishes loading
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!changeInfo.url && !changeInfo.title) return;
    try {
      await syncPinUrl(tabId, tab.url || "", tab.title);
    } catch (e) {
      console.error("[TabOrdo] pin URL sync error:", e);
    }
  });

  // Tab moved to another window — old window's group may have shrunk to 1
  chrome.tabs.onDetached.addListener(async (_tabId, detachInfo) => {
    try {
      const config = await getConfig();
      if (config.autoUngroup) scheduleAutoUngroup(detachInfo.oldWindowId);
    } catch (e) {
      console.error("[TabOrdo] onDetached:", e);
    }
  });

  // Sweep all windows when autoUngroup toggles ON, so existing 1-tab groups get dissolved
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

  // Auto-group and other tab automations
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!tab.url) return;
    const isComplete = changeInfo.status === "complete";
    const isUrlChange = !!changeInfo.url;
    if (!isComplete && !isUrlChange) return;

    const config = await getConfig();

    // Auto-group by domain (or rules if enabled) — trigger on URL change for responsiveness
    const session = await chrome.storage.session.get("bulkOpInProgress").catch((): Record<string, unknown> => ({}));
    if (isUrlChange && config.autoGroup && !tab.pinned && !session.bulkOpInProgress) {
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
          if (isIgnoredUrl(url, config.ignorePatterns)) return;
          const hostname = getFullHostname(url);
          if (hostname && !url.startsWith("chrome://")) {
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
              const domain = getDomain(url);
              if (domain) {
                const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
                const match = existingGroups.find((g) => g.title === domain && !isSharedGroup(g));
                if (match) {
                  await tryGroupTab(tabId, match.id, domain, GROUP_COLORS[Math.abs(hashCode(domain)) % GROUP_COLORS.length]);
                } else {
                  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
                  const sameDomain = windowTabs.filter((t) => t.id !== tabId && t.groupId === -1 && getDomain(t.url || "") === domain);
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

    // Auto-sort on tab load
    const freshSession = await chrome.storage.session.get("bulkOpInProgress").catch((): Record<string, unknown> => ({}));
    if (config.autoSort && changeInfo.status === "complete" && !freshSession.bulkOpInProgress) {
      await sortTabsInWindow(tab.windowId);
    }

    // Auto pin follow
    if (changeInfo.pinned !== undefined && config.autoPinFollow && !pinSyncInProgress) {
      pinSyncInProgress = true;
      try {
        const allTabs = await chrome.tabs.query({});
        const sameUrl = allTabs.filter((t) => t.id !== tabId && t.url === tab.url);
        for (const t of sameUrl) {
          if (t.pinned !== changeInfo.pinned) {
            await chrome.tabs.update(t.id!, { pinned: changeInfo.pinned });
          }
        }
      } finally {
        pinSyncInProgress = false;
      }
    }
  });

  // Auto-discard alarm
  const DISCARD_ALARM = "autoDiscard";

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

  if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener(async (info) => {
      try {
        switch (info.menuItemId) {
          case "tabOrdo-group-domain": {
            const { groupTabsByDomain } = await import("../../lib/tabs.ts");
            await groupTabsByDomain("additive");
            break;
          }
          case "tabOrdo-dedup": {
            const { removeDuplicates } = await import("../../lib/tabs.ts");
            await removeDuplicates();
            break;
          }
          case "tabOrdo-sort": {
            const win = await chrome.windows.getCurrent();
            await sortTabsInWindow(win.id!);
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
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "aigroup-start") {
      runAIGroup().then((result) => sendResponse(result));
      return true;
    }
    if (msg.type === "aigroup-status") {
      getAIProgress().then((p) => sendResponse(p));
      return true;
    }
  });

  async function runAIGroup(): Promise<{ ok: boolean; message: string }> {
    const current = await getAIProgress();
    if (current.status === "checking" || current.status === "prompting" || current.status === "grouping") {
      return { ok: false, message: "AI grouping already in progress" };
    }

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

    try {
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
        const gid = await chrome.tabs.group({ tabIds: s.tabIds });
        await safeGroupUpdate(gid, { title: s.groupName, color: s.color as chrome.tabGroups.ColorEnum });
        grouped += s.tabIds.length;
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
    }
  }

  chrome.runtime.onStartup.addListener(async () => {
    const alarm = await chrome.alarms.get(DISCARD_ALARM);
    if (!alarm) {
      chrome.alarms.create(DISCARD_ALARM, { periodInMinutes: 5 });
    }
  });

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

