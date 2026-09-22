// Whole-window rearrangements that the dashboard tiles and the action-icon menu both offer. Each
// takes the undo snapshot itself: the tiles did and the menu entries did not, so Ctrl+Z after a
// menu Group or Sort undid whatever came before it. One function per action keeps the two from
// drifting apart again.

import { groupTabsByDomain, sortTabsInWindow } from "./tabs/index.ts";
import { snapshotBeforeGroup } from "./undo.ts";

/** Group every loose tab by site, keeping the groups that already exist. */
export async function groupAllByDomain(): Promise<void> {
  await snapshotBeforeGroup();
  await groupTabsByDomain("additive");
}

/** Sort one window by domain, locks and sort priority included. */
export async function sortWindowByDomain(windowId: number): Promise<void> {
  await snapshotBeforeGroup();
  await sortTabsInWindow(windowId);
}
