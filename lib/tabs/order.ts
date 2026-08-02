// Repositioning a tab or a group within the strip.

import { groupStartIndex } from "../pin.ts";

export async function shuffleTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const unpinned = tabs.filter((t) => !t.pinned);
  for (let i = unpinned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unpinned[i], unpinned[j]] = [unpinned[j], unpinned[i]];
  }
  // One move with the whole shuffled order, not one call per tab: chrome.tabs.move applies
  // the ids in the order given, so the batch lands the same strip with 1 round-trip
  // instead of N. At 150 tabs the per-tab version was visibly slow.
  await chrome.tabs.move(unpinned.map((t) => t.id!), { index: -1 });
}

function parsePosition(pos: string): "first" | "last" | number | null {
  const trimmed = pos.trim();
  if (trimmed === "^") return "first";
  if (trimmed === "$") return "last";
  const n = parseInt(trimmed, 10);
  if (!isNaN(n) && n >= 1) return n;
  return null;
}

export async function moveCurrentTab(posStr: string): Promise<string> {
  const position = parsePosition(posStr);
  if (position === null) return "Usage: /move ^|$|<number>";

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id) return "No active tab";

  const tabs = await chrome.tabs.query({ currentWindow: true });

  if (active.groupId !== -1) {
    const groupTabs = tabs.filter((t) => t.groupId === active.groupId).sort((a, b) => a.index - b.index);
    if (groupTabs.length === 0) return "No group tabs found";
    const minIdx = groupTabs[0].index;
    const maxIdx = groupTabs[groupTabs.length - 1].index;
    let targetIndex: number;
    if (position === "first") targetIndex = minIdx;
    else if (position === "last") targetIndex = maxIdx;
    else targetIndex = Math.min(minIdx + position - 1, maxIdx);
    await chrome.tabs.move(active.id, { index: targetIndex });
    return `Moved to position ${position === "first" ? "first" : position === "last" ? "last" : position} in group`;
  } else {
    const ungrouped = tabs.filter((t) => !t.pinned && t.groupId === -1).sort((a, b) => a.index - b.index);
    if (ungrouped.length === 0) return "No ungrouped tabs";
    // Bounds come from the ungrouped run itself, the same way the grouped branch above uses
    // minIdx/maxIdx. Deriving them from pinnedCount and tabs.length assumed the strip was
    // pinned-then-ungrouped, but organizeWindow lays the groups in between — so "^" dropped
    // the tab inside the first group.
    const minIdx = ungrouped[0].index;
    const maxIdx = ungrouped[ungrouped.length - 1].index;
    let targetIndex: number;
    if (position === "first") targetIndex = minIdx;
    else if (position === "last") targetIndex = maxIdx;
    else targetIndex = Math.min(minIdx + position - 1, maxIdx);
    await chrome.tabs.move(active.id, { index: targetIndex });
    return `Moved tab to position ${position === "first" ? "first" : position === "last" ? "last" : position}`;
  }
}

export async function moveGroup(posStr: string): Promise<string> {
  const position = parsePosition(posStr);
  if (position === null) return "Usage: /movegroup ^|$|<number>";

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || active.groupId === -1) return "Active tab is not in a group";

  const groupId = active.groupId;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  const groupTabs = tabs.filter((t) => t.groupId === groupId).sort((a, b) => a.index - b.index);
  const groupTabIds = groupTabs.map((t) => t.id!);

  let targetIndex: number;
  if (position === "first") targetIndex = pinnedCount;
  else if (position === "last") targetIndex = -1;
  else {
    const groups = await chrome.tabGroups.query({ windowId: active.windowId });
    // position is 1-based user input; groupStartIndex takes a 0-based slot.
    targetIndex = groupStartIndex(tabs, groupId, Math.min(position, groups.length) - 1, pinnedCount);
  }

  await chrome.tabs.move(groupTabIds, { index: targetIndex });
  await chrome.tabs.group({ tabIds: groupTabIds, groupId });
  return `Moved group to position ${position === "first" ? "first" : position === "last" ? "last" : position}`;
}
