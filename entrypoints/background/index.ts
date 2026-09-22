// The service worker. Wiring only: each listener hands its event to a lib function, where the
// behaviour lives and is tested against the chrome stub.

import { recordOpener, lineageOpener, forgetTab } from "../../lib/tabs/index.ts";
import {
  createAutomationState, noteTabCreated, onTabRemoved, onTabRegrouped, onTabDetached, onConfigChanged,
  onTabNavigated, switchToExisting, followPinState,
} from "../../lib/automation.ts";
import { syncLockedTab, resetLocksAfterRestart } from "../../lib/locksync.ts";
import { runAIGroup } from "../../lib/aigroup.ts";
import { createMenus, runMenuItem, openDashboard } from "../../lib/menus.ts";
import { DISCARD_ALARM, startDiscardAlarm, ensureDiscardAlarm, discardIdleTabs } from "../../lib/discard.ts";

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
  const auto = createAutomationState();

  // Needs the manifest "commands" key; absent without it.
  register("commands.onCommand", () => {
    chrome.commands.onCommand.addListener(async (command) => {
      if (command === "open-dashboard") await openDashboard();
    });
  });

  register("tabs.onCreated", () => {
    chrome.tabs.onCreated.addListener((tab) => noteTabCreated(auto, tab));
  });

  // Tab lineage for /branch and /branchup. Recorded here rather than read on demand because
  // tab.openerTabId is only readable while the opener is still open, and gathering a reading
  // branch is most useful precisely after you have closed the listing page you started from.
  // Registered apart from the recentTabs listener above so a failure in one costs only itself.
  // The lineage writes stay in the worker: lib/tabs/tree.ts serialises them per realm and
  // assumes this is the only writer.
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

  // Group ages for auto-ungroup's settle window.
  register("tabGroups.onCreated", () => {
    chrome.tabGroups.onCreated.addListener((group) => {
      auto.groupCreatedAt.set(group.id, Date.now());
    });
  });
  register("tabGroups.onRemoved", () => {
    chrome.tabGroups.onRemoved.addListener((group) => {
      auto.groupCreatedAt.delete(group.id);
    });
  });

  register("tabs.onRemoved", () => {
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => onTabRemoved(auto, tabId, removeInfo));
  });

  register("tabs.onUpdated (switch-to-existing)", () => {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => switchToExisting(auto, tabId, changeInfo, tab));
  });

  register("tabs.onUpdated (groupId)", () => {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => onTabRegrouped(auto, tabId, changeInfo, tab));
  });

  register("tabs.onUpdated (pin URL sync)", () => {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => syncLockedTab(tabId, changeInfo, tab));
  });

  register("tabs.onDetached", () => {
    chrome.tabs.onDetached.addListener((_tabId, detachInfo) => onTabDetached(auto, detachInfo));
  });

  register("storage.onChanged", () => {
    chrome.storage.onChanged.addListener((changes, area) => onConfigChanged(auto, changes, area));
  });

  register("tabs.onUpdated (auto-group/auto-sort)", () => {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => onTabNavigated(auto, tabId, changeInfo, tab));
  });

  register("tabs.onUpdated (pin follow)", () => {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => followPinState(auto, tabId, changeInfo, tab));
  });

  register("runtime.onInstalled", () => {
    chrome.runtime.onInstalled.addListener(() => {
      startDiscardAlarm();
      createMenus();
    });
  });

  register("contextMenus.onClicked", () => {
    chrome.contextMenus.onClicked.addListener((info) => runMenuItem(info.menuItemId));
  });

  // The popup reads AI progress straight from session storage, so there is no status message
  // to answer here — only the start request.
  register("runtime.onMessage", () => {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "aigroup-start") {
        // Without the catch, anything rejecting before the run's own try left sendResponse
        // uncalled — the popup then waits on a port that will never answer.
        runAIGroup(auto.selfWrites)
          .then((result) => sendResponse(result))
          .catch((e) => sendResponse({ ok: false, message: String(e) }));
        return true;
      }
    });
  });

  register("runtime.onStartup", () => {
    chrome.runtime.onStartup.addListener(async () => {
      await resetLocksAfterRestart();
      await ensureDiscardAlarm();
    });
  });

  register("alarms.onAlarm", () => {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === DISCARD_ALARM) await discardIdleTabs();
    });
  });
});
