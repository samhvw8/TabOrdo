import { getConfig, matchDomainToRule } from "../../lib/rules.ts";
import { getFullHostname } from "../../lib/tabs.ts";

export default defineBackground(() => {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) return;
    if (tab.pinned || tab.groupId !== -1) return;

    const config = await getConfig();
    if (!config.autoGroup || !config.useRules) return;

    const hostname = getFullHostname(tab.url);
    if (!hostname) return;

    const rule = matchDomainToRule(hostname, config.rules);
    if (!rule) return;

    const existingGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
    const match = existingGroups.find((g) => g.title === rule.name);

    if (match) {
      await chrome.tabs.group({ tabIds: [tabId], groupId: match.id });
    } else {
      const groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(groupId, { title: rule.name, color: rule.color });
    }
  });
});

