import { getAutoGroup, getUseRules, getRules, matchDomainToRule } from "../../lib/rules.ts";

export default defineBackground(() => {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) return;
    if (tab.pinned || tab.groupId !== -1) return;

    const enabled = await getAutoGroup();
    const rulesOn = await getUseRules();
    if (!enabled || !rulesOn) return;

    const hostname = getHostname(tab.url);
    if (!hostname) return;

    const rules = await getRules();
    const rule = matchDomainToRule(hostname, rules);
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

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
