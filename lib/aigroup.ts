// The /aigroup run. It lives in the service worker, not the popup, so it survives the popup
// closing; the popup starts it with an "aigroup-start" message and reads progress from session
// storage.

import { checkAIAvailability, suggestGroups, setAIProgress, getAIProgress, defaultProgress } from "./ai.ts";
import { acquireBulkLock, releaseBulkLock, newLockOwner, AI_LEASE_MS } from "./bulklock.ts";
import { pickMajorityWindow } from "./tabs/index.ts";
import { safeGroupUpdate } from "./automation.ts";
import type { SelfWriteLedger } from "./selfwrite.ts";

// How often a live AI run re-ups its bulk-lock lease. Far inside AI_LEASE_MS, so suppression
// can't lapse between ticks.
const AI_LEASE_RENEW_MS = 60 * 1000;

/** `selfWrites` is the worker's group ledger: the groups this makes are marked on it. */
export async function runAIGroup(selfWrites: SelfWriteLedger): Promise<{ ok: boolean; message: string }> {
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

    const { suggestions, omitted } = await suggestGroups(tabData);
    // The model only saw the tabs that fit its context window; the rest stay as they are.
    const leftOut = omitted > 0 ? `${omitted} tab(s) didn't fit the on-device model and were left as they are` : "";
    const withLeftOut = (msg: string) => (leftOut ? `${msg}; ${leftOut}` : msg);
    if (suggestions.length === 0) {
      await setAIProgress({ ...defaultProgress(), status: "done", total: tabData.length, processed: tabData.length, currentTab: leftOut });
      return { ok: true, message: withLeftOut("AI found no groups to suggest") };
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
      selfWrites.mark(memberIds);
      const gid = await chrome.tabs.group({ tabIds: memberIds, createProperties: { windowId: targetWindowId } });
      await safeGroupUpdate(gid, { title: s.groupName, color: s.color as chrome.tabGroups.ColorEnum });
      grouped += memberIds.length;
    }

    const msg = withLeftOut(`AI grouped ${grouped} tab(s) into ${suggestions.length} group(s)`);
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
