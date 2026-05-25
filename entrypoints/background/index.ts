import { getConfig, matchDomainToRule } from "../../lib/rules.ts";
import { getFullHostname, getDomain, sortTabsInWindow, GROUP_COLORS, hashCode } from "../../lib/tabs.ts";

let pinSyncInProgress = false;

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
  // Auto-group and other tab automations
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!tab.url) return;
    const isComplete = changeInfo.status === "complete";
    const isUrlChange = !!changeInfo.url;
    if (!isComplete && !isUrlChange) return;

    const config = await getConfig();

    // Auto-group by domain (or rules if enabled) — trigger on URL change for responsiveness
    const session = await chrome.storage.session.get("bulkOpInProgress").catch(() => ({}));
    if (isUrlChange && config.autoGroup && !tab.pinned && tab.groupId === -1 && !session.bulkOpInProgress) {
      try {
        // Re-fetch tab: Chrome may assign opener's group after the URL change event
        const freshTab = await chrome.tabs.get(tabId).catch(() => null);
        if (freshTab && freshTab.groupId === -1) {
          const url = freshTab.url || tab.url;
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
      } catch (e) {
        console.error("[TabOrdo] auto-group error:", e);
      }
    }

    // Auto-sort on tab load
    const freshSession = await chrome.storage.session.get("bulkOpInProgress").catch(() => ({}));
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
