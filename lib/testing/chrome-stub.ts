// In-memory chrome API stub for vitest. Install in beforeEach; each install starts clean.

export interface StubTab {
  id: number;
  url?: string;
  title?: string;
  pinned: boolean;
  windowId: number;
  groupId: number;
  active?: boolean;
}

export interface StubGroup {
  id: number;
  title?: string;
  color?: string;
}

export interface ChromeStub {
  localData: Record<string, unknown>;
  sessionData: Record<string, unknown>;
  openTabs: StubTab[];
  groups: StubGroup[];
  created: { url?: string; pinned?: boolean; active?: boolean }[];
  removedIds: number[];
  ungroupedIds: number[];
  groupUpdates: { id: number; title?: string; color?: string }[];
  failCreateUrls: Set<string>;
}

export function installChromeStub(): ChromeStub {
  const stub: ChromeStub = {
    localData: {},
    sessionData: {},
    openTabs: [],
    groups: [],
    created: [],
    removedIds: [],
    ungroupedIds: [],
    groupUpdates: [],
    failCreateUrls: new Set(),
  };

  let nextTabId = 1000;
  let nextGroupId = 100;

  const storageArea = (data: Record<string, unknown>) => ({
    get: async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of arr) if (k in data) out[k] = data[k];
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    },
    remove: async (key: string) => {
      delete data[key];
    },
  });

  globalThis.chrome = {
    storage: {
      local: storageArea(stub.localData),
      session: storageArea(stub.sessionData),
    },
    tabs: {
      query: async () => stub.openTabs,
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
      ungroup: async (ids: number | number[]) => {
        const arr = Array.isArray(ids) ? ids : [ids];
        stub.ungroupedIds.push(...arr);
        for (const t of stub.openTabs) if (arr.includes(t.id)) t.groupId = -1;
      },
      group: async (opts: { tabIds: number[]; groupId?: number }) => {
        const gid = opts.groupId ?? nextGroupId++;
        for (const t of stub.openTabs) if (opts.tabIds.includes(t.id)) t.groupId = gid;
        if (opts.groupId === undefined) stub.groups.push({ id: gid });
        return gid;
      },
    },
    tabGroups: {
      query: async () => stub.groups,
      update: async (id: number, props: { title?: string; color?: string }) => {
        stub.groupUpdates.push({ id, ...props });
        const g = stub.groups.find((x) => x.id === id);
        if (g) Object.assign(g, props);
        return g;
      },
    },
  } as unknown as typeof chrome;

  return stub;
}
