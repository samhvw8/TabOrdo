export interface ArchivedTab {
  id: string;
  url: string;
  title: string;
  archivedAt: number;
  groupName?: string;
  /** Legacy: entries written before 0.6.0 stored the site's own icon URL. No longer read
   *  or written — the archive page renders icons from Chrome's local favicon cache. */
  favIconUrl?: string;
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

/** What archiveTabs will actually keep. Exported so a caller that closes the tabs afterwards
 *  can close exactly the ones that were archived, and no more. */
export function isArchivable(tab: { url?: string }): boolean {
  return !!tab.url && tab.url !== "chrome://newtab/";
}

export async function archiveTabs(
  tabs: { url: string; title: string; groupName?: string }[]
): Promise<number> {
  const archive = await getArchive();
  const now = Date.now();
  let count = 0;
  for (const tab of tabs) {
    if (!isArchivable(tab)) continue;
    archive.push({
      id: crypto.randomUUID(),
      url: tab.url,
      title: tab.title,
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
  // Only drop entries whose tab actually opened — a failed restore must not lose the archive entry.
  const restoredIds = new Set<string>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") restoredIds.add(toRestore[i].id);
    else console.warn("Failed to restore tab:", r.reason);
  });
  await saveArchive(archive.filter((a) => !restoredIds.has(a.id)));
  return restoredIds.size;
}

export async function deleteFromArchive(ids: string[]): Promise<void> {
  const archive = await getArchive();
  const idSet = new Set(ids);
  await saveArchive(archive.filter((a) => !idSet.has(a.id)));
}

export async function clearArchive(): Promise<void> {
  await saveArchive([]);
}

// COUNT_KEY is a cheap denormalized read so the sidebar badge doesn't deserialize the whole
// archive. It only exists from the version that introduced saveArchive's dual write, so an
// archive written before that has entries and no count — fall back to measuring it, and
// backfill so the next read is cheap again.
export async function getArchiveCount(): Promise<number> {
  // Ask for the count ALONE. Requesting both keys in one get defeated the entire point of
  // storing a count: chrome.storage deserializes every key you name, so the popup — which
  // reads this on mount — paid for parsing up to MAX_ARCHIVE_SIZE entries on every open, and
  // the cost grew with the archive. The fallback below is the only path that needs the array.
  const data = await chrome.storage.local.get(COUNT_KEY);
  const count = data[COUNT_KEY];
  if (typeof count === "number") return count;
  const legacy = await chrome.storage.local.get(STORAGE_KEY);
  const archive: ArchivedTab[] = Array.isArray(legacy[STORAGE_KEY]) ? legacy[STORAGE_KEY] : [];
  await chrome.storage.local.set({ [COUNT_KEY]: archive.length }).catch(() => {});
  return archive.length;
}
