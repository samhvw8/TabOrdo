// Shared shapes for the tab modules.

export interface TabInfo {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  groupId: number;
  groupTitle?: string;
  groupColor?: string;
  audible?: boolean;
  mutedInfo?: chrome.tabs.MutedInfo;
  discarded?: boolean;
  frozen?: boolean;
  lastAccessed?: number;
}

export const GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
  "blue",
  "cyan",
  "green",
  "yellow",
  "orange",
  "pink",
  "purple",
  "red",
  "grey",
];

export interface MoveGroupsResult {
  moved: number;
  /** Groups that could not be rebuilt; their tabs are sitting loose or untitled. */
  groupsFailed: number;
}
