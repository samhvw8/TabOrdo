export interface ArchivedTab {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string;
  archivedAt: number;
  groupName?: string;
}

const STORAGE_KEY = "tabOrdo_archive";

export async function getArchive(): Promise<ArchivedTab[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

async function saveArchive(archive: ArchivedTab[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: archive });
}

export async function archiveTabs(
  tabs: { url: string; title: string; favIconUrl?: string; groupName?: string }[]
): Promise<number> {
  const archive = await getArchive();
  const now = Date.now();
  for (const tab of tabs) {
    if (!tab.url || tab.url === "chrome://newtab/") continue;
    archive.push({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      archivedAt: now,
      groupName: tab.groupName,
    });
  }
  await saveArchive(archive);
  return tabs.length;
}

export async function restoreFromArchive(ids: string[]): Promise<number> {
  const archive = await getArchive();
  const toRestore = archive.filter((a) => ids.includes(a.id));
  let restored = 0;
  for (const item of toRestore) {
    try {
      await chrome.tabs.create({ url: item.url, active: false });
      restored++;
    } catch {}
  }
  await saveArchive(archive.filter((a) => !ids.includes(a.id)));
  return restored;
}

export async function deleteFromArchive(ids: string[]): Promise<void> {
  const archive = await getArchive();
  await saveArchive(archive.filter((a) => !ids.includes(a.id)));
}

export async function clearArchive(): Promise<void> {
  await saveArchive([]);
}

export async function getArchiveCount(): Promise<number> {
  const archive = await getArchive();
  return archive.length;
}
