# Research Report: Chrome扩展新API (2024-2026) — 中文社区视角

Gatherer: gather-zh-apis | Language: ZH | Iterations: 8 | Date: 2026-07-24

## Executive Summary

中文开发者社区（V2EX、知乎、CSDN、SegmentFault、博客园、LINUX DO、HelloGitHub）对 Chrome 扩展新 API 的讨论集中在三大主题：**sidePanel 侧边栏**（已成熟，Chrome 114+，是标签管理器新趋势的核心载体）、**tabGroups 原生标签组**（API 存在明显能力缺口 — 无法查询"已保存/已关闭"的标签组，只能操作当前窗口活跃分组）、以及 **AI 自动分组**（2024-2025 新兴趋势，多个中文开源项目直接用 chrome.tabGroups + LLM 做语义分组，但普遍维护不善）。对 TabOrdo 最具行动价值的发现：(1) chrome.tabGroups 无法读取 Chrome 原生"已保存的标签组"(Saved Tab Groups)，只能靠扩展自己维护镜像状态并做双向同步（tab-wise 项目的真实 issue 证实这是主流方案）；(2) sidebar 类扩展有 360px 最小宽度硬限制，无法隐藏原生标签栏；(3) AI 自动分组是当前最热的差异化方向，但早期项目（1000+ star 的 ai-group-tabs）已停止维护，留有空位。

置信度：中高。sidePanel/tabGroups/sessions API 细节已用官方文档交叉验证；社区趋势判断基于多个独立论坛帖子和 GitHub issue 的一致信号。存在两处需警惕的**可疑信息源**（见下方"信息源可信度警告"）。

## Research Methodology

- 搜索语言：中文 (ZH) only，遵循分配
- 迭代次数：8 轮完整 search+fetch 循环
- 工具：WebSearch（主）、mcp__parallax__fetch_page（备用，部分被反爬拦截）、WebFetch、gh CLI
- 覆盖社区：V2EX、知乎、CSDN、博客园(cnblogs)、SegmentFault、LINUX DO、HelloGitHub(GitHub 中文策展社区)、GitHub issues/repos
- 官方文档交叉验证：developer.chrome.com (sidePanel, tabGroups, sessions, whats-new)

## Key Findings

### 1. sidePanel API — 侧边栏（标签管理器的新载体）[GEM]

- **可用性**：Chrome 114+ (MV3)，`chrome.sidePanel.open()` 需 Chrome 116+，`close()` 需 141+，`getLayout()` 需 140+（判断面板在左/右，利于 RTL 支持）
- 核心方法：`setOptions()` / `getOptions()` / `open()` / `close()` / `setPanelBehavior()` / `getPanelBehavior()` / `getLayout()`
- 事件：`onOpened` (141+)、`onClosed` (142+)
- 权限：manifest 需声明 `"sidePanel"`
- 中文教程侧重"点击图标控制侧边栏显示/隐藏"的实现模式 ([CSDN](https://blog.csdn.net/xutongbao/article/details/137033142))
- **官方文档**：[chrome.sidePanel API 参考](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

**实践案例（真实标签管理器扩展）**：
- **VertiTab**（V2EX 自荐帖，[t/1078516](https://www.v2ex.com/t/1078516)）：仿 Firefox Sidebery 的垂直侧边栏标签管理器，功能含分组排序、书签快捷访问、画中画、自动丢弃标签、站点级设置、快照备份恢复。用户反馈"开几十个标签非常有用"。
- **多彩侧边栏标签页管理**（[ruanyf/weekly#4843](https://github.com/ruanyf/weekly/issues/4843) 自荐）：缩略图预览、最近关闭标签/历史搜索、画中画（仿 Arc Mini Player）、阅读进度指示器。

**技术硬伤（两个独立信息源一致确认）**[GEM]：
- 侧边栏**最小宽度 360px 不可调**，小屏体验差
- Chrome **不允许隐藏原生标签栏**，与侧边栏标签管理器功能重复，是用户抱怨焦点
- Vimium 等键盘扩展与 sidePanel 有兼容性 bug（新页面需先手动点击才能激活快捷键，社区归因于"Chrome side-panel bug"）

### 2. tabGroups API — 标签组能力缺口 [GEM — 对 TabOrdo 最直接可行动]

- **可用性**：Chrome 89+ (MV3)，权限 `"tabGroups"`
- 方法：`get()` / `query()` / `update()` / `move()`；分组/取消分组标签需改用 `chrome.tabs` API
- 可查询属性：`collapsed`、`color`、`title`、`windowId`、**`shared`（Chrome 137+ 新增，标记该组是否为"共享标签组"）**
- 事件：`onCreated` / `onMoved` / `onRemoved` / `onUpdated`
- **官方文档**：[chrome.tabGroups API 参考](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)

**关键缺口（多信息源确认）**：
- **`tabGroups.query()` 只能查询当前打开窗口里的活跃分组，无法查询 Chrome 原生"已保存的标签组"(Saved Tab Groups) 或已关闭的分组** — 这是浏览器 UI 层功能，未开放给扩展 API
- 真实开源项目 [tab-wise issue #39](https://github.com/Sid-1819/tab-wise/issues/39)（2026-06-30，活跃）详细记录了应对方案："Bidirectional sync with Chrome native Tab Groups" — 需要自己监听 `onCreated/onUpdated/onRemoved` + `tabs.onUpdated`(groupId 变化) 手动维护镜像状态，还要处理 Tab Wise 自定义分组 ID 与 Chrome 原生分组 ID 的映射问题。这证实了"读取容易、双向同步难"是当前标签管理器开发者的共同痛点。
- V2EX 开发者原话（[t/767832](https://www.v2ex.com/t/767832)）："分组关闭之后，每次再重新手工建立和管理太麻烦了" — 印证需要"快照/自动保存"机制来弥补 API 缺口

### 3. Chrome 原生"已保存标签组"跨设备同步 [GEM]

- Chrome 已上线"已保存的标签组"(Saved Tab Groups) 浏览器原生功能，可在 设置 → 同步 → 管理同步内容 中开启跨设备同步（Settings → Sync → Manage what you sync → "Saved tab groups"）
- **但这是浏览器 UI 层功能，不等于开放给扩展 API** —— 目前没有找到 `chrome.tabGroups` 暴露"已保存标签组"列表的方法
- 2025年新增：Chrome 137+ 引入 **共享标签组 (Shared Tab Groups)** 协作功能 — 可分享标签组链接给他人协作查看/添加标签，桌面版通过标签上的圆点 + hover card 显示活动提醒。`tabGroups` API 的 `shared` 布尔属性即用于标记这类分组，但暂无进一步文档说明扩展如何主动参与"共享"操作
- 截至研究时（2026-07），原生跨设备同步覆盖开放标签、历史、书签、密码，但**标签组的组织结构（分组/置顶排列/窗口布局）本身仍是设备本地的**，第三方扩展（如 SuperchargeNavigation，2026-04 新增）通过复用 Chrome 账户同步通道实现"完整工作区"（标签+分组+置顶+静音状态）同步，且不经过第三方服务器存储

### 4. sessions API — 恢复关闭标签 [MEH — 成熟功能，无新变化]

- `chrome.sessions.getRecentlyClosed()`：获取最近关闭标签/窗口列表，倒序排列（index 0 为最近关闭）
- `chrome.sessions.restore()`：恢复标签/窗口，恢复导航历史（前进/后退可用），可指定 `sessionId`
- 权限：`"sessions"`
- 中文资料以官方文档翻译 + 博客园"chrome扩展开发系列"教程为主，无 2024-2026 新增能力信号 — 该 API 相对稳定，未见近期变更

### 5. MV3 新特性 (2025-2026) [MEH — 多数与标签管理器弱相关，仅列关键项]

- **`chrome.userScripts.execute()`**（Chrome 135, 2025-03）：无需永久注册即可在任意时刻注入脚本一次
- 用户脚本权限从"全局开发者模式开关"迁移为"每扩展的 Allow User Scripts 开关"（Chrome 138 起，扩展详情页可见）
- **`storage.local`/`storage.session` 配额提升至约 10MB**（Chrome 112/114），`storage.local.getKeys()` 新增（Chrome 130, 2024-09）—— 对需要缓存大量标签快照的标签管理器有直接价值
- Offscreen API（离屏文档）：service worker 非持久化重启频繁场景下，用于 DOM 依赖操作（解析 HTML、剪贴板等），MV2→V3 迁移常见方案（[SegmentFault 迁移指南](https://segmentfault.com/a/1190000044555740)）
- **注意**：搜索返回"Chrome 148 (2026-05) 所有扩展 API 迁移到 `browser` 命名空间"、"structured clone 消息序列化"等条目 — 未能用官方一手文档逐条交叉验证版本号，标记为**中等置信度**，建议实现前用 `chrome://version` 和官方 whats-new 页面二次确认

### 6. AI 自动分组 — 2024-2025 新兴趋势 [GEM — 差异化机会点]

多个独立信息源（LINUX DO 论坛、V2EX、HelloGitHub、GitHub）一致指向"用 LLM + chrome.tabGroups API 做语义自动分组"是标签管理器的新兴差异化方向：

- **AI Group Tabs**（[MichaelYuhe/ai-group-tabs](https://github.com/MichaelYuhe/ai-group-tabs)）：1002 star，基于 GPT/Gemini + Tab Group API 自动分类归纳。**但最后推送于 2024-04-24，issue 列表显示 2023-12 之后无维护迹象**（"support ollama self-hosted llm"、"同步手动创建的分组"等 feature request 长期未处理）— 说明该细分市场存在"有热度但缺乏持续维护"的产品空位
- **chrome-ai-tab-group-plugin**（[mgsky1](https://github.com/mgsky1/chrome-ai-tab-group-plugin)）：仅 4 star 但 2026-07-21（3天前）仍在更新 — 小而活跃的替代方案
- **Auto Group Tabs**（V2EX [t/806131](https://www.v2ex.com/t/806131)，非 AI、规则式）：开发者原话"Chrome 89 原生分组需要手动管理，效率低"是开发动机；社区反馈聚焦：域名显示应缩短（二级域名而非完整 URL）、置顶标签不应被自动分组打散、低于阈值应自动解散分组
- LINUX DO 帖子（[topic/207035](https://linux.do/t/topic/207035)）标题"分享一款浏览器标签页AI自动分组扩展"确认该话题在中文技术社区有持续关注度（因反爬无法完整抓取正文，标记为**部分验证**）

## 信息源可信度警告 [重要]

搜索中出现两个**疑似仿冒站点**：`chrome2-google.com` 和 `chrome3-google.com`（均非 google.com 官方域名，标题伪装成"Chrome 博客"）。它们提供的具体版本细节（如"Chrome 121 正式将 Side Panel API 纳入 chrome.sidePanel 命名空间"、"Chrome 131 侧边栏默认开启多任务 + panel isolation cache 独立渲染进程"）**未能用官方 developer.chrome.com 交叉验证**，本报告未采信这些具体数值，仅采信官方文档确认的 114/116/140/141/142 等版本号。建议团队后续研究中主动屏蔽这两个域名。

## Cross-Reference 与中文社区独有信号

- 中文社区（V2EX/LINUX DO/HelloGitHub）比英文源更早、更密集讨论"AI 自动分组"这一细分趋势，且多个中文开发者独立复现了类似项目（ai-group-tabs, chrome-ai-tab-group-plugin, Auto Group Tabs），说明这是中文开发者生态的活跃创新区
- 中文用户对"域名过长占用标签栏空间"的抱怨反复出现在至少 3 个独立帖子中，是稳定的、跨项目的真实用户痛点，而非个例

## GitHub Repositories（中文关键词 + 相关英文库）

| Repo | Stars | 说明 | 状态 |
|---|---|---|---|
| [MichaelYuhe/ai-group-tabs](https://github.com/MichaelYuhe/ai-group-tabs) | 1002 | LLM 自动分组开山项目 | 停滞（末次推送 2024-04） |
| [mgsky1/chrome-ai-tab-group-plugin](https://github.com/mgsky1/chrome-ai-tab-group-plugin) | 4 | 小而活跃的 AI 分组替代方案 | 活跃（2026-07-21 更新） |
| [nitzanpap/auto-tab-groups](https://github.com/nitzanpap/auto-tab-groups) | 39 | 规则式子域名自动分组 | — |
| [furofo/TabGroupExtension](https://github.com/furofo/TabGroupExtension) | 25 | 基于 Tab Groups API 自动排序 | — |
| [TidyTabGroups/TidyTabGroups](https://github.com/TidyTabGroups/TidyTabGroups) | 16 | 分组折叠整理 | — |
| [Sid-1819/tab-wise](https://github.com/Sid-1819/tab-wise) | — | 侧边栏标签管理器，issue #39 详述与原生分组双向同步方案，最具参考价值 | 活跃 |
| bellazhuang417-cyber/tab-out-china | 0 | 中文关键词搜到的国产标签管理扩展，早期项目 | 新 |

**Issues/PR 信号**：
- [Sid-1819/tab-wise#39](https://github.com/Sid-1819/tab-wise/issues/39)（2026-06-30，活跃）：原生标签组双向同步的完整技术方案与验收标准，强烈建议 TabOrdo 参考其 "Mirror mode → Write-back → Event sync" 三阶段设计
- [MichaelYuhe/ai-group-tabs](https://github.com/MichaelYuhe/ai-group-tabs) issues：#35（ollama 本地模型支持，未解决）、#67（与手动创建分组同步，未解决）、#97（相同域名合并，未解决）— 均为长期未处理的真实需求，指向该产品方向仍有功能空缺

## Unresolved Questions

1. Chrome 148 (2026-05) `browser` 命名空间统一 / structured clone 消息序列化的具体细节未经官方一手文档验证（来源疑似受可信度存疑站点影响），建议用 `developer.chrome.com/docs/extensions/whats-new` 官方页面直接核实最新条目
2. `tabGroups.shared` 属性（Chrome 137+）目前只找到"标记该组是否共享"的只读信号，未找到扩展主动发起/管理共享的官方 API 文档 — 需进一步查证 chrome.tabGroups 是否会新增 share/unshare 方法
3. LINUX DO 关于 AI 自动分组的帖子正文因反爬（403）未能完整抓取，仅拿到标题与前情提要，如需完整社区反馈需人工登录访问
4. Chrome 原生"已保存标签组"是否会在未来版本开放给扩展 API 查询 — 目前没有找到官方路线图承诺

## Sources

- [chrome.sidePanel API 参考](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [chrome.tabGroups API 参考](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [chrome.sessions API 参考](https://developer.chrome.com/docs/extensions/reference/api/sessions)
- [What's new in Chrome extensions](https://developer.chrome.com/docs/extensions/whats-new)
- [V2EX: 自动创建、保存和管理 Chrome 标签分组的扩展程序](https://www.v2ex.com/t/767832)
- [V2EX: 分享 Chrome 扩展 VertiTab - 侧边栏垂直标签页](https://www.v2ex.com/t/1078516)
- [V2EX: Auto Group Tabs 自动分组插件](https://www.v2ex.com/t/806131)
- [GitHub: ruanyf/weekly#4843 多彩侧边栏标签页管理](https://github.com/ruanyf/weekly/issues/4843)
- [GitHub: 521xueweihan/HelloGitHub#2670 AI Group Tabs](https://github.com/521xueweihan/HelloGitHub/issues/2670)
- [GitHub: Sid-1819/tab-wise#39 原生标签组双向同步](https://github.com/Sid-1819/tab-wise/issues/39)
- [GitHub: MichaelYuhe/ai-group-tabs](https://github.com/MichaelYuhe/ai-group-tabs)
- [GitHub: mgsky1/chrome-ai-tab-group-plugin](https://github.com/mgsky1/chrome-ai-tab-group-plugin)
- [LINUX DO: 分享一款浏览器标签页AI自动分组扩展](https://linux.do/t/topic/207035)（部分验证，403 反爬）
- [SegmentFault: Chrome Extension v3 开发指南](https://segmentfault.com/a/1190000042851130)
- [SegmentFault: MV2 升级到 MV3 需要修改的点](https://segmentfault.com/a/1190000044555740)
- [博客园: Chrome浏览器扩展开发系列之十六](https://www.cnblogs.com/champagne/p/4872286.html)
- [知乎: Chrome扩展推荐：标签管理也是一门艺术](https://zhuanlan.zhihu.com/p/39697690)
- [CSDN: chrome扩展通过点击图标控制侧边栏](https://blog.csdn.net/xutongbao/article/details/137033142)

## GEM/MEH/NOISE 标签汇总

- **GEM**: sidePanel 360px 限制+原生标签栏不可隐藏；tabGroups 无法查询已保存/已关闭分组的能力缺口；tab-wise#39 双向同步方案；AI 自动分组趋势与市场空位；域名显示过长的跨项目一致痛点
- **MEH**: sessions API（稳定无新变化）；大部分 MV3 新特性（offscreen/userScripts）与标签管理器场景关联度低，仅 storage 配额提升直接相关
- **NOISE**: chrome2-google.com / chrome3-google.com 疑似仿冒域名的具体版本声明；通用"7款最佳标签管理扩展"之类营销向列表文章
