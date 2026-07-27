# zh-user-complaints — Chinese community tab-manager gaps (LOW pass)

Scope: 简体中文 only. 7 searches + 2 fetches. Elite forums: V2EX (rich), linux.do (weak — no relevant threads). Competitors: OneTab, NiceTab/N-Tab, Workona, Toby, Session Buddy, The Great Suspender, Tree Style Tab.

## Top requested features (ranked, evidence)

1. **Never-lose-data storage + real backup/export** [GEM] — dominant theme. N-Tab's whole pitch: "OneTab丢过数据的举手集合! 4年自用敢保证永不丢失数据" ([N-Tab](https://github.com/scoful/N-Tab)). Users write custom backup scripts out of fear ([cnblogs](https://www.cnblogs.com/janbar/p/15235044.html), [CSDN py script](https://blog.csdn.net/qq_39682204/article/details/134162628)). Export must carry **timestamps** — OneTab's is "太简陋, 连时间戳也不带" ([V2EX 874282](https://www.v2ex.com/t/874282)).
2. **Session save/restore (persistent, named)** [GEM] — Chrome native groups don't persist: "新的分组如何持久化保存？不小心关掉就没了" ([V2EX 852445](https://www.v2ex.com/t/852445)). Session Buddy loved for full-session save/restore + cross-session search, local data, used 7-8 yrs (ibid #23; [BoTab](https://botab.net/zh/blog/best-chrome-edge-tab-managers-2026)).
3. **Cross-device sync (incl. self-hosted WebDAV/Gists)** [GEM] — Toby/Workona chosen mainly for sync ("换电脑要挨个点开" pain, [知乎](https://zhuanlan.zhihu.com/p/63654536)). NiceTab differentiates with Gists+WebDAV sync ([appinn](https://www.appinn.com/nicetab/)). Self-host/local-first sync valued in ZH.
4. **Tab suspend / memory saving (MV3-native, trustworthy)** [GEM] — core ZH motivation ("chrome太耗内存/释放内存"). The Great Suspender vacuum: sold→malware→Chrome force-disabled, 2M+ installs orphaned ([知乎](https://zhuanlan.zhihu.com/p/349380711), [知乎2](https://zhuanlan.zhihu.com/p/352809126)). Users migrated to Marvellous Suspender / MV3 Tab Suspender. Trust + open-source is the ask.
5. **Workspaces (project-scoped tab sets)** [GEM] — Workona = best-liked ("目前体验最好", per-project workspace, auto-save, cloud backup, suspend inactive; [少数派](https://sspai.com/post/71828)). Toby = visual kanban cards + team share.
6. **Vertical / tree tabs w/ parent-child hierarchy** [GEM] — persistent unmet Chrome demand; users defect to Vivaldi双层标签 / Edge垂直 / Firefox Tree Style Tab "勉强用着" ([V2EX 852445](https://www.v2ex.com/t/852445) #1,#16,#18). Tabs Outliner works but "UI丑了点". Vertical mgr remembers 从属关系 ([V2EX 965867](https://cn.v2ex.com/t/965867)).
7. **Command palette + fuzzy search** [MEH/validated] — native ⌘⇧A tab-search highly praised (#7,#11,#27). Launch X = option+space palette over tabs+history+bookmarks. **Pinyin search requested** ([V2EX 852445](https://www.v2ex.com/t/852445) #30) — ZH-specific.
8. **Smart dedupe** [MEH] — auto-close-duplicate plugins popular but users want to KEEP intentional dupes (base64/compare use) ([V2EX 1139951](https://www.v2ex.com/t/1139951)). SignalTabs = close-all + dedupe + global search ([V2EX 1213349](https://www.v2ex.com/t/1213349)).

## Top complaints per competitor

- **OneTab** [GEM]: (a) data loss on chrome upgrade/crash & on 标签组重命名; (b) collecting **force-closes current tabs** (无法保留); (c) duplicate right-click menu; (d) all data in ONE indexDB key → fragile, "Memory Out"; (e) cloud sync "即将推出" for years, uninstall deletes data ([appinn](https://www.appinn.com/nicetab/), [V2EX 874282](https://www.v2ex.com/t/874282), [one-tab troubleshooting](https://www.one-tab.com/zh-CN/troubleshooting)).
- **Chrome native tab groups**: non-persistent, accidental close loses everything ([V2EX 852445](https://www.v2ex.com/t/852445)).
- **The Great Suspender**: malware takeover → forced removal; trust destroyed ([知乎](https://zhuanlan.zhihu.com/p/349380711)).
- **Toby**: replaces new-tab page (intrusive); sync locked to Toby cloud.
- **Tabs Outliner**: ugly UI. **Tree Style Tab / Vivaldi**: means abandoning Chrome ecosystem/Google sync (friction, #9).
- **N-Tab**: "技术栈老旧" (per NiceTab dev).

## 3–5 gaps most relevant to TabOrdo

TabOrdo already has: sort, domain auto-group, dedupe, archive, pins, undo, URL-pattern rules, unified search, triage, mute. Missing vs ZH demand:

1. **Persistent named sessions + restore** — #1/#2 pain; TabOrdo's archive ≠ full session snapshot/restore. Highest ROI.
2. **Cross-device sync, local-first (WebDAV/Gist/export-import)** — table-stakes for ZH power users; pair with never-lose-data guarantee + timestamped export. This is the trust moat OneTab lost.
3. **Tab suspend / memory saving (MV3-native)** — core purchase motive; open vacuum since Great Suspender. TabOrdo doesn't list suspend.
4. **Workspaces** — project-scoped tab sets (Workona's love-reason); natural extension of existing groups/rules.
5. **Vertical/tree tabs + pinyin search** — hierarchy is chronic unmet demand; pinyin is cheap ZH-specific win on existing search.

## Unresolved / caveats
- linux.do yielded no relevant threads (weak forum coverage for this topic); more V2EX threads (1213349, 1207130, TabNest) unfetched — snippets sufficed.
- Sync/suspend demand inferred from competitor praise + migration stories, not direct TabOrdo feedback (TabOrdo not yet in ZH discourse).
- Did not quantify install/★ counts per competitor.
