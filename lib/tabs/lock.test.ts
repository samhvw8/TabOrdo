import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub.ts";
import { pinCurrentTab, unpinCurrentTab } from "./lock.ts";
import { getPinnedTabs, PIN_BADGE } from "../pin.ts";

let stub: ChromeStub;

function activate(id: number): void {
  for (const t of stub.openTabs) t.active = t.id === id;
}

const groupOrder = () =>
  stub.openTabs.filter((t) => t.groupId === 50).sort((a, b) => a.index! - b.index!).map((t) => t.id);

describe("pinCurrentTab in a group", () => {
  beforeEach(() => {
    stub = installChromeStub();
    // Group Work: a, b, c, d.
    stub.openTabs = ["a", "b", "c", "d"].map((name, i) => ({
      id: i + 1, url: `https://${name}.com`, pinned: false, windowId: 1, groupId: 50, index: i,
    }));
    stub.groups = [{ id: 50, title: "Work", windowId: 1 }];
  });

  // Re-locking a held tab at ^ used to set its slot to 0 without moving the lock already there.
  // Two locks then tied on slot 0, and the tie sent the lower tab id to the end of the group.
  it("re-locking a held tab at the top takes the top back, it does not drop to the bottom", async () => {
    activate(1);
    await pinCurrentTab("^");
    activate(2);
    await pinCurrentTab("^");
    expect(groupOrder()).toEqual([2, 1, 3, 4]);

    activate(1);
    await pinCurrentTab("^");
    expect(groupOrder()).toEqual([1, 2, 3, 4]);
    expect(await slots()).toEqual([[1, 0], [2, 1]]);
  });

  const slots = async () =>
    (await getPinnedTabs()).map((p) => [p.tabId!, p.position]).sort((a, b) => a[0] - b[0]);

  // Review finding: a move left pushed every lock at or after the new slot, so a lock past the
  // old slot drifted right and an unlocked tab took its place.
  it("moving a lock left only shifts the locks between the new slot and the old one", async () => {
    activate(1); await pinCurrentTab("1");
    activate(2); await pinCurrentTab("2");
    activate(3); await pinCurrentTab("3");
    activate(2); await pinCurrentTab("^");
    expect(await slots()).toEqual([[1, 1], [2, 0], [3, 2]]);
    expect(groupOrder()).toEqual([2, 1, 3, 4]);
  });

  // Review finding: a move right left its old slot empty, so /lock 2 on the first of two locked
  // tabs did not move it past the second, and repeated moves drifted the other lock off the end.
  it("moving a lock right takes the slot and closes the one it left", async () => {
    activate(1); await pinCurrentTab("1");
    activate(2); await pinCurrentTab("2");
    activate(1); await pinCurrentTab("2");
    expect(await slots()).toEqual([[1, 1], [2, 0]]);
    expect(groupOrder()).toEqual([2, 1, 3, 4]);
    activate(1); await pinCurrentTab("1");
    activate(1); await pinCurrentTab("2");
    expect(await slots()).toEqual([[1, 1], [2, 0]]);
  });

  // Review finding: a locked tab's title carries the badge, and re-locking stored it.
  it("re-locking a badged tab stores its title without the badge", async () => {
    activate(1); await pinCurrentTab("^");
    stub.openTabs[0].title = PIN_BADGE + "Docs";
    activate(1); await pinCurrentTab("2");
    expect((await getPinnedTabs())[0].title).toBe("Docs");
  });

  it("re-locking at the slot the tab already holds moves no other lock", async () => {
    activate(1);
    await pinCurrentTab("^");
    activate(2);
    await pinCurrentTab("2");
    activate(2);
    await pinCurrentTab("2");
    expect(await slots()).toEqual([[1, 0], [2, 1]]);
  });
});

describe("pinCurrentTab outside a group", () => {
  beforeEach(() => {
    stub = installChromeStub();
    stub.openTabs = [
      { id: 1, url: "https://a.com", pinned: false, windowId: 1, groupId: -1, index: 0 },
      { id: 2, url: "https://b.com", pinned: false, windowId: 1, groupId: -1, index: 1 },
    ];
  });

  it("pins the tab in Chrome and stores no position lock", async () => {
    activate(2);
    const msg = await pinCurrentTab("");
    expect(stub.openTabs.find((t) => t.id === 2)!.pinned).toBe(true);
    expect(stub.tabUpdates).toEqual([{ id: 2, pinned: true }]);
    expect(await getPinnedTabs()).toEqual([]);
    expect(msg).toMatch(/Pinned in Chrome/);
  });

  it("pins in Chrome on Alt (^) too", async () => {
    activate(1);
    await pinCurrentTab("^");
    expect(stub.openTabs.find((t) => t.id === 1)!.pinned).toBe(true);
  });

  it("an already Chrome-pinned tab is left alone", async () => {
    stub.openTabs[0].pinned = true;
    activate(1);
    expect(await pinCurrentTab("")).toBe("Already pinned in Chrome");
    expect(stub.tabUpdates).toEqual([]);
  });

  it("pins a tab whose url has not committed yet", async () => {
    stub.openTabs[0].url = undefined;
    activate(1);
    await pinCurrentTab("");
    expect(stub.openTabs[0].pinned).toBe(true);
  });

  it("unlock unpins a Chrome-pinned tab", async () => {
    stub.openTabs[0].pinned = true;
    activate(1);
    const msg = await unpinCurrentTab();
    expect(stub.openTabs.find((t) => t.id === 1)!.pinned).toBe(false);
    expect(msg).toMatch(/Unpinned in Chrome/);
  });

  it("unlock on a loose tab that is not pinned changes nothing", async () => {
    activate(1);
    await unpinCurrentTab();
    expect(stub.tabUpdates).toEqual([]);
  });
});
