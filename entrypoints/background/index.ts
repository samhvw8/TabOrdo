import { getConfig, matchDomainToRule } from "../../lib/rules.ts";
import { getFullHostname, getDomain, sortTabsInWindow, GROUP_COLORS, hashCode } from "../../lib/tabs.ts";

let pinSyncInProgress = false;

export default defineBackground(() => {
  // Auto-group and other tab automations
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!tab.url) return;
    const isComplete = changeInfo.status === "complete";
    const isUrlChange = !!changeInfo.url;
    if (!isComplete && !isUrlChange) return;

    const config = await getConfig();

    // Auto-group by domain (or rules if enabled) — trigger on URL change for responsiveness
    if (isUrlChange && config.autoGroup && !tab.pinned && tab.groupId === -1) {
      try {
        const hostname = getFullHostname(tab.url);
        if (hostname && !tab.url.startsWith("chrome://")) {
          let grouped = false;
          if (config.useRules) {
            const rule = matchDomainToRule(hostname, config.rules);
            if (rule) {
              const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
              const match = existingGroups.find((g) => g.title === rule.name);
              if (match) {
                await chrome.tabs.group({ tabIds: [tabId], groupId: match.id });
              } else {
                const groupId = await chrome.tabs.group({ tabIds: [tabId] });
                await chrome.tabGroups.update(groupId, { title: rule.name, color: rule.color });
              }
              grouped = true;
            }
          }
          if (!grouped) {
            const domain = getDomain(tab.url);
            if (domain) {
              const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
              const match = existingGroups.find((g) => g.title === domain);
              if (match) {
                await chrome.tabs.group({ tabIds: [tabId], groupId: match.id });
              } else {
                const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
                const sameDomain = windowTabs.filter((t) => t.id !== tabId && t.groupId === -1 && getDomain(t.url || "") === domain);
                if (sameDomain.length > 0) {
                  const groupId = await chrome.tabs.group({ tabIds: [tabId, ...sameDomain.map((t) => t.id!)] });
                  await chrome.tabGroups.update(groupId, { title: domain, color: GROUP_COLORS[Math.abs(hashCode(domain)) % GROUP_COLORS.length] });
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
    if (config.autoSort && changeInfo.status === "complete") {
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
