import { getConfig, matchDomainToRule, isIgnoredUrl, isIgnoredGroupName } from "../../lib/rules.ts";
import { getFullHostname, getDomain, sortTabsInWindow, GROUP_COLORS, hashCode } from "../../lib/tabs.ts";
let pinSyncInProgress = false;
const ungroupTimers = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleAutoUngroup(windowId: number): void {
  const existing = ungroupTimers.get(windowId);
  if (existing) clearTimeout(existing);
  ungroupTimers.set(windowId, setTimeout(() => {
    ungroupTimers.delete(windowId);
    autoUngroupSingleTabGroups(windowId);
  }, 150));
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
    const groupCounts = new Map<number, chrome.tabs.Tab[]>();
    for (const tab of allTabs) {
      if (tab.groupId !== -1) {
        if (!groupCounts.has(tab.groupId)) groupCounts.set(tab.groupId, []);
        groupCounts.get(tab.groupId)!.push(tab);
      }
    }
    for (const [groupId, tabs] of groupCounts) {
      if (tabs.length !== 1 || !tabs[0].id) continue;
      const title = groupTitleMap.get(groupId);
      if (ruleNames && title && ruleNames.has(title)) continue;
      if (title && isIgnoredGroupName(title, config.ignoreGroupNames)) continue;
      await chrome.tabs.ungroup(tabs[0].id);
    }
  } catch (e) {
    console.error("[TabOrdo] auto-ungroup error:", e);
  }
}

async function tryGroupTab(tabId: number, groupId: number, title: string, color: chrome.tabGroups.ColorEnum): Promise<void> {
  try {
    await chrome.tabs.group({ tabIds: [tabId], groupId });
  } catch (e) {
    console.warn("[TabOrdo] stale group", groupId, "- creating new:", e);
    const newGroupId = await chrome.tabs.group({ tabIds: [tabId] }).catch((e2) => { console.error("[TabOrdo] fallback group create:", e2); return null; });
    if (newGroupId) await chrome.tabGroups.update(newGroupId, { title, color }).catch((e2) => console.error("[TabOrdo] fallback group update:", e2));
  }
}

export default defineBackground(() => {
  // Track recently created tabs — give other extensions time to group them
  const recentTabs = new Map<number, number>();
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) {
      recentTabs.set(tab.id, Date.now());
      setTimeout(() => recentTabs.delete(tab.id!), 2000);
    }
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

  // Tab moved between groups / in or out of a group — fires changeInfo.groupId
  chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    if (changeInfo.groupId === undefined) return;
    try {
      const config = await getConfig();
      if (config.autoUngroup) scheduleAutoUngroup(tab.windowId);
    } catch (e) {
      console.error("[TabOrdo] onUpdated groupId:", e);
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
                const match = existingGroups.find((g) => g.title === rule.name);
                if (match) {
                  await tryGroupTab(tabId, match.id, rule.name, rule.color);
                } else {
                  const groupId = await chrome.tabs.group({ tabIds: [tabId] }).catch((e) => { console.error("[TabOrdo] rule group create:", e); return null; });
                  if (groupId) await chrome.tabGroups.update(groupId, { title: rule.name, color: rule.color }).catch((e) => console.error("[TabOrdo] rule group update:", e));
                }
                grouped = true;
              }
            }
            if (!grouped) {
              const domain = getDomain(url);
              if (domain) {
                const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
                const match = existingGroups.find((g) => g.title === domain);
                if (match) {
                  await tryGroupTab(tabId, match.id, domain, GROUP_COLORS[Math.abs(hashCode(domain)) % GROUP_COLORS.length]);
                } else {
                  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
                  const sameDomain = windowTabs.filter((t) => t.id !== tabId && t.groupId === -1 && getDomain(t.url || "") === domain);
                  if (sameDomain.length > 0) {
                    const groupId = await chrome.tabs.group({ tabIds: [tabId, ...sameDomain.map((t) => t.id!)] }).catch((e) => { console.error("[TabOrdo] domain group create:", e); return null; });
                    if (groupId) await chrome.tabGroups.update(groupId, { title: domain, color: GROUP_COLORS[Math.abs(hashCode(domain)) % GROUP_COLORS.length] }).catch((e) => console.error("[TabOrdo] domain group update:", e));
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
  });

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
      if (tab.active || tab.pinned || tab.audible || tab.discarded) continue;
      if ((tab.lastAccessed || 0) < cutoff) {
        await chrome.tabs.discard(tab.id!).catch(() => {});
      }
    }
  });

});

