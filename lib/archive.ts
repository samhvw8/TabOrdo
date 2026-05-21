export interface ArchivedTab {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string;
  archivedAt: number;
  groupName?: string;
}

const STORAGE_KEY = "tabOrdo_archive";
const COUNT_KEY = "tabOrdo_archiveCount";
const MAX_ARCHIVE_SIZE = 5000;

export async function getArchive(): Promise<ArchivedTab[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

async function saveArchive(archive: ArchivedTab[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: archive, [COUNT_KEY]: archive.length });
}

export async function archiveTabs(
  tabs: { url: string; title: string; favIconUrl?: string; groupName?: string }[]
): Promise<number> {
  const archive = await getArchive();
  const now = Date.now();
  let count = 0;
  for (const tab of tabs) {
    if (!tab.url || tab.url === "chrome://newtab/") continue;
    archive.push({
      id: crypto.randomUUID(),
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      archivedAt: now,
      groupName: tab.groupName,
    });
    count++;
  }
  if (archive.length > MAX_ARCHIVE_SIZE) {
    archive.splice(0, archive.length - MAX_ARCHIVE_SIZE);
  }
  await saveArchive(archive);
  return count;
}

export async function restoreFromArchive(ids: string[]): Promise<number> {
  const archive = await getArchive();
  const idSet = new Set(ids);
  const toRestore = archive.filter((a) => idSet.has(a.id));
  const results = await Promise.allSettled(
    toRestore.map((item) => chrome.tabs.create({ url: item.url, active: false }))
  );
  const restored = results.filter((r) => r.status === "fulfilled").length;
  for (const r of results) {
    if (r.status === "rejected") console.warn("Failed to restore tab:", r.reason);
  }
  await saveArchive(archive.filter((a) => !idSet.has(a.id)));
  return restored;
}

export async function deleteFromArchive(ids: string[]): Promise<void> {
  const archive = await getArchive();
  const idSet = new Set(ids);
  await saveArchive(archive.filter((a) => !idSet.has(a.id)));
}

export async function clearArchive(): Promise<void> {
  await saveArchive([]);
}

export async function getArchiveCount(): Promise<number> {
  const data = await chrome.storage.local.get(COUNT_KEY);
  return data[COUNT_KEY] || 0;
}
