// In-memory chrome API stub for vitest. Install in beforeEach; each install starts clean.

export interface StubTab {
  id: number;
  url?: string;
  title?: string;
  pinned: boolean;
  windowId: number;
  groupId: number;
  index?: number;
  active?: boolean;
  lastAccessed?: number;
  muted?: boolean;
  highlighted?: boolean;
}

export interface StubGroup {
  id: number;
  title?: string;
  color?: string;
  collapsed?: boolean;
  windowId?: number;
}

export interface ChromeStub {
  localData: Record<string, unknown>;
  sessionData: Record<string, unknown>;
  openTabs: StubTab[];
  groups: StubGroup[];
  windows: { id: number }[];
  currentWindowId: number;
  created: { url?: string; pinned?: boolean; active?: boolean; windowId?: number }[];
  removedIds: number[];
  ungroupedIds: number[];
  discardedIds: number[];
  reloadedIds: number[];
  /** Tabs setTabVolume successfully injected into. */
  scriptedIds: number[];
  moves: { ids: number[]; windowId?: number; index?: number }[];
  groupUpdates: { id: number; title?: string; color?: string; collapsed?: boolean }[];
  tabUpdates: { id: number; pinned?: boolean; url?: string; highlighted?: boolean; muted?: boolean; active?: boolean }[];
  failCreateUrls: Set<string>;
  /** Every storage.get, in order, with the keys it asked for. */
  storageReads: { area: string; keys: string[] }[];
  changeListeners: ((changes: Record<string, unknown>, area: string) => void)[];
  /** Make every storage.set reject, to exercise failed-write paths. */
  failWrites: boolean;
  /** Make chrome.tabs.group reject, to exercise group-restore failure. */
  failGroup: boolean;
  /** Tabs scripting.executeScript rejects for — no host permissions in the real extension. */
  failScriptingIds: Set<number>;
}

/**
 * Re-lay the tab strip after a move: pull `moving` out of wherever they were, reinsert them
 * into `targetWindowId` at `index` (-1 or undefined = end), then renumber every touched
 * window so `tab.index` stays 0..n-1 per window the way Chrome guarantees.
 */
function reflow(stub: ChromeStub, targetWindowId: number, moving: StubTab[], index?: number): void {
  const movingIds = new Set(moving.map((t) => t.id));
  const byWindow = new Map<number, StubTab[]>();
  for (const t of stub.openTabs) {
    if (movingIds.has(t.id)) continue;
    if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
    byWindow.get(t.windowId)!.push(t);
  }
  for (const list of byWindow.values()) list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const target = byWindow.get(targetWindowId) ?? [];
  const at = index === undefined || index < 0 ? target.length : Math.min(index, target.length);
  target.splice(at, 0, ...moving);
  byWindow.set(targetWindowId, target);

  for (const list of byWindow.values()) list.forEach((t, i) => { t.index = i; });
  stub.openTabs = [...byWindow.values()].flat();
}

/** Tabs in a group sit contiguously in Chrome; grouping pulls stragglers together. */
function makeContiguous(stub: ChromeStub, groupId: number): void {
  const members = stub.openTabs.filter((t) => t.groupId === groupId);
  if (members.length < 2) return;
  const windowId = members[0].windowId;
  const anchor = Math.min(...members.map((t) => t.index ?? 0));
  reflow(stub, windowId, members.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)), anchor);
}

export function installChromeStub(): ChromeStub {
  const stub: ChromeStub = {
    localData: {},
    sessionData: {},
    openTabs: [],
    groups: [],
    windows: [{ id: 1 }],
    currentWindowId: 1,
    created: [],
    removedIds: [],
    ungroupedIds: [],
    discardedIds: [],
    reloadedIds: [],
    scriptedIds: [],
    moves: [],
    groupUpdates: [],
    tabUpdates: [],
    failCreateUrls: new Set(),
    storageReads: [],
    changeListeners: [],
    failWrites: false,
    failGroup: false,
    failScriptingIds: new Set(),
  };

  let nextTabId = 1000;
  let nextGroupId = 100;
  let nextWindowId = 900;

  const storageArea = (data: Record<string, unknown>, areaName: string) => ({
    get: async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      // Recorded so tests can assert *which* keys a read pulls in. chrome.storage
      // deserializes every key you name, so naming a big one you don't need is a real cost.
      stub.storageReads.push({ area: areaName, keys: [...arr] });
      const out: Record<string, unknown> = {};
      for (const k of arr) if (k in data) out[k] = data[k];
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      if (stub.failWrites) throw new Error("stub: storage write failed");
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: v };
      }
      Object.assign(data, structuredClone(items));
      // Real Chrome delivers onChanged to other contexts asynchronously; deliver on a
      // microtask rather than inline so tests can observe the pre-delivery window.
      for (const fn of stub.changeListeners) {
        void Promise.resolve().then(() => fn(structuredClone(changes), areaName));
      }
    },
    remove: async (key: string) => {
      const oldValue = data[key];
      delete data[key];
      for (const fn of stub.changeListeners) {
        void Promise.resolve().then(() => fn({ [key]: { oldValue } }, areaName));
      }
    },
  });

  globalThis.chrome = {
    storage: {
      local: storageArea(stub.localData, "local"),
      session: storageArea(stub.sessionData, "session"),
      onChanged: {
        addListener: (fn: (changes: Record<string, unknown>, area: string) => void) => {
          stub.changeListeners.push(fn);
        },
      },
    },
    tabs: {
      query: async (
        q: {
          windowId?: number; groupId?: number; currentWindow?: boolean; lastFocusedWindow?: boolean;
          active?: boolean; pinned?: boolean;
        } = {}
      ) =>
        stub.openTabs.filter((t) => {
          if (q.windowId !== undefined && t.windowId !== q.windowId) return false;
          if (q.groupId !== undefined && t.groupId !== q.groupId) return false;
          // The stub has a single focused window, so lastFocusedWindow — which production uses
          // to find the active tab — narrows to exactly what currentWindow does. Ignoring it
          // matched every tab, so those queries silently picked the first tab in the strip.
          if ((q.currentWindow || q.lastFocusedWindow) && t.windowId !== stub.currentWindowId) return false;
          // Without these two the `{active: true}` queries all matched every tab, so the
          // "active tab" every close/unite/isolate command pivots on was silently just the
          // first tab in the strip — and any test built on that would assert nothing.
          if (q.active !== undefined && (t.active ?? false) !== q.active) return false;
          if (q.pinned !== undefined && t.pinned !== q.pinned) return false;
          return true;
        }),
      // Chrome drops a tab's group when it crosses into another window, AND it reindexes
      // both windows. Modelling only the group drop made every ordering assertion vacuous:
      // reversing or deleting the sort in carryGroups still passed all 9 merge tests.
      move: async (ids: number | number[], props: { windowId?: number; index?: number }) => {
        const arr = Array.isArray(ids) ? ids : [ids];
        stub.moves.push({ ids: arr, windowId: props.windowId, index: props.index });
        // Chrome moves the tabs in the order given, not in their current strip order.
        const moving = arr
          .map((id) => stub.openTabs.find((t) => t.id === id))
          .filter((t): t is StubTab => !!t);
        if (moving.length === 0) return [];

        const targetWindowId = props.windowId ?? moving[0].windowId;
        for (const t of moving) {
          if (t.windowId !== targetWindowId) {
            t.windowId = targetWindowId;
            t.groupId = -1;
          }
        }
        reflow(stub, targetWindowId, moving, props.index);
        return moving;
      },
      create: async (props: { url?: string; pinned?: boolean; active?: boolean }) => {
        if (props.url && stub.failCreateUrls.has(props.url)) {
          throw new Error(`stub: create failed for ${props.url}`);
        }
        stub.created.push(props);
        const tab: StubTab = {
          id: nextTabId++,
          url: props.url,
          pinned: props.pinned ?? false,
          windowId: 1,
          groupId: -1,
          active: props.active,
        };
        stub.openTabs.push(tab);
        return tab;
      },
      remove: async (ids: number | number[]) => {
        const arr = Array.isArray(ids) ? ids : [ids];
        stub.removedIds.push(...arr);
        stub.openTabs = stub.openTabs.filter((t) => !arr.includes(t.id));
      },
      // Everything but muted/active used to be dropped on the floor, so the pin-follow and
      // navigate paths could not be observed at all: {pinned} and {url} left no trace.
      update: async (
        id: number,
        props: { pinned?: boolean; url?: string; highlighted?: boolean; muted?: boolean; active?: boolean }
      ) => {
        stub.tabUpdates.push({ id, ...props });
        const t = stub.openTabs.find((x) => x.id === id);
        if (!t) return undefined;
        if (props.pinned !== undefined) t.pinned = props.pinned;
        if (props.url !== undefined) t.url = props.url;
        if (props.highlighted !== undefined) t.highlighted = props.highlighted;
        if (props.muted !== undefined) t.muted = props.muted;
        if (props.active !== undefined) t.active = props.active;
        return t;
      },
      discard: async (id: number) => {
        stub.discardedIds.push(id);
      },
      reload: async (id: number) => {
        stub.reloadedIds.push(id);
      },
      ungroup: async (ids: number | number[]) => {
        const arr = Array.isArray(ids) ? ids : [ids];
        stub.ungroupedIds.push(...arr);
        for (const t of stub.openTabs) if (arr.includes(t.id)) t.groupId = -1;
      },
      group: async (opts: { tabIds: number[]; groupId?: number; createProperties?: { windowId?: number } }) => {
        if (stub.failGroup) throw new Error("stub: Tabs cannot be edited right now");
        const members = stub.openTabs.filter((t) => opts.tabIds.includes(t.id));
        // Chrome refuses tab ids that span windows; callers are expected to consolidate first.
        // Accepting them here let cross-window grouping pass in tests and fail in the browser.
        const targetWindowId = opts.createProperties?.windowId ?? members[0]?.windowId;
        if (members.some((t) => t.windowId !== targetWindowId)) {
          throw new Error("Tabs can only be grouped in the same window.");
        }
        const gid = opts.groupId ?? nextGroupId++;
        for (const t of members) t.groupId = gid;
        if (opts.groupId === undefined) {
          stub.groups.push({ id: gid, windowId: targetWindowId });
        }
        makeContiguous(stub, gid);
        return gid;
      },
    },
    scripting: {
      executeScript: async (opts: { target: { tabId: number } }) => {
        if (stub.failScriptingIds.has(opts.target.tabId)) {
          throw new Error("stub: cannot access contents of the page");
        }
        stub.scriptedIds.push(opts.target.tabId);
        return [];
      },
    },
    tabGroups: {
      query: async (q: { windowId?: number } = {}) =>
        stub.groups.filter((g) => q.windowId === undefined || g.windowId === q.windowId),
      update: async (id: number, props: { title?: string; color?: string; collapsed?: boolean }) => {
        stub.groupUpdates.push({ id, ...props });
        const g = stub.groups.find((x) => x.id === id);
        if (g) Object.assign(g, props);
        return g;
      },
    },
    windows: {
      getCurrent: async () => ({ id: stub.currentWindowId }),
      getAll: async () => stub.windows,
      // Detaching a tab into a fresh window drops its group, exactly like a cross-window
      // move — which is why the new-window movers need their own capture step.
      create: async (props: { tabId?: number } = {}) => {
        const id = nextWindowId++;
        stub.windows.push({ id });
        if (props.tabId !== undefined) {
          const t = stub.openTabs.find((x) => x.id === props.tabId);
          if (t) {
            t.windowId = id;
            t.groupId = -1;
            reflow(stub, id, [t], -1);
          }
        }
        return { id };
      },
      update: async (id: number, props: unknown) => ({ id, ...(props as object) }),
    },
  } as unknown as typeof chrome;

  return stub;
}
