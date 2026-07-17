import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "./testing/chrome-stub.ts";
import { getArchive, archiveTabs, restoreFromArchive, deleteFromArchive, clearArchive, getArchiveCount } from "./archive.ts";

let stub: ChromeStub;

beforeEach(() => {
  stub = installChromeStub();
});

describe("archiveTabs", () => {
  it("appends entries with id and timestamp, skipping newtab and empty urls", async () => {
    const n = await archiveTabs([
      { url: "https://a.com", title: "A" },
      { url: "chrome://newtab/", title: "New Tab" },
      { url: "", title: "Empty" },
      { url: "https://b.com", title: "B", groupName: "Work" },
    ]);
    expect(n).toBe(2);
    const archive = await getArchive();
    expect(archive).toHaveLength(2);
    expect(archive[0]).toMatchObject({ url: "https://a.com", title: "A" });
    expect(archive[1]).toMatchObject({ url: "https://b.com", groupName: "Work" });
    expect(archive[0].id).toBeTruthy();
    expect(archive[0].id).not.toBe(archive[1].id);
    expect(archive[0].archivedAt).toBeGreaterThan(0);
    expect(await getArchiveCount()).toBe(2);
  });

  it("caps the archive at 5000, dropping the oldest entries", async () => {
    const old = Array.from({ length: 4999 }, (_, i) => ({
      id: `old-${i}`,
      url: `https://old.com/${i}`,
      title: `Old ${i}`,
      archivedAt: 1,
    }));
    stub.localData["tabOrdo_archive"] = old;

    await archiveTabs([
      { url: "https://new1.com", title: "N1" },
      { url: "https://new2.com", title: "N2" },
    ]);
    const archive = await getArchive();
    expect(archive).toHaveLength(5000);
    expect(archive[0].id).toBe("old-1"); // old-0 dropped
    expect(archive[4999].url).toBe("https://new2.com");
  });
});

describe("restoreFromArchive", () => {
  it("reopens the selected entries and removes them from the archive", async () => {
    await archiveTabs([
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: "B" },
    ]);
    const [a] = await getArchive();

    const restored = await restoreFromArchive([a.id]);
    expect(restored).toBe(1);
    expect(stub.created).toEqual([{ url: "https://a.com", active: false }]);
    const remaining = await getArchive();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].url).toBe("https://b.com");
  });

  it("returns 0 for unknown ids and leaves the archive untouched", async () => {
    await archiveTabs([{ url: "https://a.com", title: "A" }]);
    expect(await restoreFromArchive(["nope"])).toBe(0);
    expect(await getArchive()).toHaveLength(1);
  });

  it("keeps the archived entry when tab creation fails (regression)", async () => {
    await archiveTabs([
      { url: "https://works.com", title: "OK" },
      { url: "https://broken.com", title: "Fails" },
    ]);
    const [ok, broken] = await getArchive();
    stub.failCreateUrls.add("https://broken.com");

    const restored = await restoreFromArchive([ok.id, broken.id]);
    expect(restored).toBe(1);
    const remaining = await getArchive();
    // The failed one must survive; only the successfully reopened entry leaves the archive
    expect(remaining.map((a) => a.id)).toEqual([broken.id]);
  });
});

describe("deleteFromArchive / clearArchive", () => {
  it("deletes selected entries without opening tabs", async () => {
    await archiveTabs([
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: "B" },
    ]);
    const [a] = await getArchive();
    await deleteFromArchive([a.id]);
    expect(stub.created).toEqual([]);
    expect(await getArchive()).toHaveLength(1);
    expect(await getArchiveCount()).toBe(1);
  });

  it("clearArchive empties everything", async () => {
    await archiveTabs([{ url: "https://a.com", title: "A" }]);
    await clearArchive();
    expect(await getArchive()).toEqual([]);
    expect(await getArchiveCount()).toBe(0);
  });
});
