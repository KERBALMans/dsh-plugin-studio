# 更新日志

本文件记录插件工坊（`dsh-plugin-studio`）的所有版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.0.8] — 2026-11-02

新增「最近运行」档位：有些插件一直在跑，却永远不会出现在工具调用里。

### 背景

`dsh-media-lens` 注册了 `media_read_image` 等工具，但只有你主动让它看图时才会被调用；`dsh-builtin-browser` 只在真正开浏览器时才动。它们的会话记录还可能被清理掉，于是列里只剩「从没用过」——这既冤枉也不稳定。

### 改动

- 新增 `lib/activity.js`：读宿主运行日志（`<DSH_HOME>/logs/desktop-next-*.jsonl` 最近 3 个文件），按 `fields.pluginId` 取每个插件最近一次活动时间。
- **启动窗口过滤**：每次客户端启动时插件都会打「registered xxx」「config loaded」之类的日志，若不过滤，每次重启后所有行都会变成「刚刚」。因此丢弃同一 `runId` 起始 120 秒内的活动，只保留运行期真实操作。
- 归属：日志里的 `pluginId`（`include:` 前缀已剥离）先按 `entryId`、再按 `rowId`、再按 `moduleName` 匹配到 bundle 行。
- 展示优先级：**最后使用 > 最近运行 > 常驻运行 > 从没用过**。`最近运行` 有独立的措辞与悬停说明，明确写着「只说明它跑过，不代表你调用了它」。
- 台账增加 `runs` 段：宿主日志会轮转（只留 3 天），观测到的最晚活动时间写入 `usage-ledger.json`，不会因为日志滚动而倒退；它与真实使用分开存，真实使用永远优先。
- 性能：扫 3 个日志文件约 77 ms。

### 结果

34 行里 10 行有真实使用时间，另有 4 行显示「最近运行」：`dsh-plugin-wallpaper-engine`、`dsh-media-lens`、`@agents-anywhere/dsh-bridge-next`、`dsh-builtin-browser`。

### 测试

`node scripts/all.mjs --offline` → 10 suites, 10 passed。

---

## [1.0.7] — 2026-11-02

修回归：`dsh-context` 明明一直在跑却显示「从没用过」，而它在 1.0.6 之前是能显示的。

### 根因

1. **本插件自己的更新日志抢走了归属权。** `literalOwner()` 判断某个 projection 键属于哪个
   包时，只看「哪个包里出现过这个字面量」，不看出现的位置。1.0.6 的 `CHANGELOG.md` 在解释
   修复时写下了 `contextHeaders` 这个词，于是 `dsh-context`（代码里声明）和 `dsh-plugin-studio`
   （文档里提到）各算一票，平票即放弃——`dsh-context` 注册的 `contextHeaders` /
   `contextActivity` 全部返回 null。现在按文件类型加权（代码 3 > JSON 2 > 文档 1），且只有
   最高权重来自代码文件才认，文档里的提及不再算数。
2. **会话日志被删，历史使用时间跟着蒸发。** 装在本机的 `dsh-session-clean` 会在你点清理时
   删除整个会话（`DataBase/logs/session-delete.log` 记录了 291 行操作，最近一次是
   2026-11-02T13:22:53Z 删掉 `session-b167f00e-…`）。被删会话里的 `tool/call` 一起消失，
   于是「上次用过」重新变回「从没用过」。这也解释了 `dsh-media-lens`、`dsh-builtin-browser`
   的时间为何在两次版本之间不见了——它们的使用记录在被删的会话里。

### 修复

- **加权归属**：`attributeKeys` 的 `literalOwner` 改为按文件权重取最高分，平票才放弃；
  只出现在 Markdown 里的词一律不算声明。`CACHE_VERSION` 升到 5，旧缓存自动作废。
- **持久使用台账**（新增 `lib/ledger.js`）：`DataBase/storages/dsh-plugin-studio/usage-ledger.json`
  按行名记住观测到的最新时间，每轮合并取最大值。会话被删、归属规则调整都不会让时间倒退，
  列只会往前走。台账里的时间以「来自历史使用记录」为悬停说明。
- **两个来源合并**：`sessionQuery` 的快照只带会话尾部，早先的工具调用会丢。现在
  service 与磁盘两条路径都折进同一份结果，时间取最大值，来源标记为 `sessionQuery+files`。
- `emptyUsage()` 改为导出，供 `_diag/` 下的单会话探测脚本使用。

### 验证

- `node scripts/all.mjs --offline` → `10 suites, 10 passed`
- 离线复跑真实 profile：`dsh-context` 由 `projection:contextHeaders` 点亮（此前为 null），
  `dsh-connect-workbuddy` 仍由 `provider:workbuddy-global` 点亮。

已知限制：已经被删掉的会话无法复活，`dsh-media-lens` / `dsh-builtin-browser` 的历史时间
找不回来；从这一版起它们（以及所有插件）再被用过一次就会记进台账并一直保留。

## [1.0.6] — 2026-11-02

「最后使用时间」不再只看工具调用。这一版把三种同样真实、但完全不经过 `tool/call`
的使用痕迹也折进来，并解决面板每次切回都重新加载、要等三秒的问题。

### 判断规则

- **模型服务（provider）**：`model/selection`、`request/context`、`llm/retry` 三类事件都
  带 `data.provider`。插件把远端模型接成 provider 时一个工具都不注册——`dsh-connect-workbuddy`
  就是这样，之前无论用多少次都显示「从没用过」。现在按 provider id 归属到包：先在包里找
  该 id 的字面量，找不到再退化为「包名的词段命中 provider 前缀」（`workbuddy-global` 由
  `workbuddy-` 运行时拼出来，字面量根本不存在），只在唯一命中时才认。
- **会话投影（projection）**：`DataBase/storages/session_projcache/sessions/*.json` 的
  `record.rows` 的 key 就是各包注册的投影名，文件 mtime 就是该会话投影最后写入时间。
  `dsh-context` 注册的 `contextTimeline` / `contextHeaders` / `contextActivity` 因此能拿到
  真实时间——它没有工具，也不是 provider，之前同样一片空白。
- **斜杠命令**：`user/message` 正文以 `/cmd` 开头时记一笔（客户端展开的命令不落日志，
  所以这条是"有则更好"，不作为主要依据）。

三类共用一套归属：key 必须**恰好只有一个包**声明才认，投影 key 还要求 ≥13 字符，
避免 `goal`、`title` 这种半个安装目录都出现的短词被错误点亮。宁可留空，不可点亮错的行。

### 性能与交互

- 宿主端 `analyse()` 结果进内存缓存（`analysisCache`），`?refresh=1` 才重算；新装插件后
  点刷新即可看到。
- 客户端 `panelCache` 以 kind 为键缓存结果，组件卸载不丢，**切回面板立刻出图、不再重新请求**。
- 刷新按钮换成「↻ 刷新」，只在用户主动点击时才重新读取使用时间；悬停时间的提示会说明
  证据类型（工具调用 / 模型服务 / 会话投影 / 斜杠命令）。

### 验证

`node scripts/all.mjs --offline` → 10 suites, 10 passed。离线复算：`dsh-connect-workbuddy`
由 provider 规则点亮，`dsh-context` 由投影规则点亮，其余行保持不变。

## [1.0.5] — 2026-11-02

给「没有工具、因此永远不会有调用记录」的插件一个说法。之前这类行和真正没用过的插件
一样显示「从没用过」，看起来像监测又坏了。

判定方式是新增的 `toolSurface()`：把一个行的包和它挂载的每个子模块都扫一遍，看有没有
`tools.register(` / `defineTool(` / `registerTool(` / `toolRegistry.register(`——再看
根级 patch 有没有声明 `serverName`（MCP 服务是靠协议广播工具的，不走注册调用，
`@local/rea-switch` 就是这种）。判定为无工具的启用行改显示「常驻运行」并挂 tooltip；
停用行不动，它本来就有「已停用」徽章；包读不到时也保持原文案，不猜。

效果：24 个未点亮的行分成 15 个已停用、7 个常驻型（壁纸、费用统计、市场、优惠券、
会话清理、平滑输出、桥接）、2 个有工具但确实一次没调用过（`dsh-connect-workbuddy`、
`dsh-context`）。`toolSurface` 冷态 180 ms、热态 7 ms，按包 mtime 做进程内缓存。

## [1.0.4] — 2026-11-02

修掉 1.0.3 的缓存读写方向错误：MCP 服务名表写入时是 `[server, [包…]]`，读取时却按
`[包, [server…]]` 解析，于是 `mcp__rea__*` 那几行的使用时间每隔一次请求就消失一次
（`dsh-plugin-rea` 在「2 天前」和「从没用过」之间来回跳），而且每次缓存失效都会触发全量重扫
（`/inventory` 从 2.7 s 涨到 6.1 s）。改成同一方向读写后连跑三次结果一致，热态 12 ms。

## [1.0.3] — 2026-11-02

把 1.0.2 漏掉的插件补上。1.0.2 让 5 行显示了时间，但页面上绝大多数行仍是「从没用过」，
包括 `@deepseek-ai/dsh-base` 这种每天都在用的行。

### 根因

1.0.2 把「bundle 名」当成了包的归属单位，而页面上的每一行是一个 **bundle**，
它下面挂着几十个子模块。`@deepseek-ai/dsh-base` 一行就挂了 96 个加载项，
`read` / `grep` / `web_search` / `skill` 全都来自它的子模块，bundle 自己的源码里没有这些工具。
另外 `packageDir()` 只查 profile 的 `node_modules`，而 `dsh-base`、`dsh-web-app` 这些包
在 Harness 的安装目录里，profile 里根本没有副本，所以永远扫不到。

### 修复

- **两级归属**：先按 `packageNameOf(entry.moduleName)` 把工具归到子模块包，
  再按 bundle 的 `rows[].moduleName` 上卷到页面上的行。
- **两个搜索根**：`packageLocator(ctx)` 先用 `pluginPackages.packageOf()`（能解析到
  Harness 安装目录），失败才回退到 profile 的 `node_modules`。
- **MCP 服务名**：`mcp__rea__*` 这类工具按 `cordis.patch.yml` 里的 `serverName` 归属，
  声明同一 server 的包都算（`dsh-plugin-rea` 与 `@local/rea-switch`）。
- **CJK 指纹**：中文句号切句，中文最短 18 字（原先一律 40 字符，中文工具描述全被丢弃）。
- **名称兜底**：描述是运行时拼出来、任何文件里都没有原文时（`dsh_browser_list_tabs`），
  退回用工具名的引号字面量匹配。
- **平票取舍**：描述被多个包同时包含时（`dsh-tool-pwsh` 抄了 `bash` 的段落），
  优先「包名末段含该工具名」的那个，其次「唯一一个官方包」，其余判为无法归属。
- **性能**：`FILE_MAX` 提到 8 MiB、`TOTAL_MAX` 16 MiB（覆盖 `billion-context` 的 5.8 MB 打包产物）；
  缓存改为按工具增量（`CACHE_VERSION = 3`），冷跑 3.0 s，热跑 13 ms。

### 结果

34 行里 10 行有使用时间（1.0.2 是 5 行）：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、
`@local/rea-switch`、`billion-context`、`dsh-builtin-browser`、`dsh-gitbash-shell`、
`dsh-media-lens`、`dsh-ops`、`dsh-plugin-rea`、`dsh-plugin-studio`。

仍未归属的 5 个工具都是预期内的：`present` / `ask_user_question` /
`load_workspace_dependencies` 的包不在任何 bundle 的加载项里，`purge_status` / `modpack_list`
的来源包没有安装。

## [1.0.2] — 2026-11-02

修掉「最后使用时间」几乎全空的问题。这一版之前，页面上绝大多数行都显示「从没用过」，
包括每天都在用的插件。

### 根因

判定「用过」靠的是「这个包注册了哪些工具」再和会话日志里的 `tool/call` 对上。
这个映射原先由 `lib/classify.js` 的两条正则从包源码里猜工具名，而 34 个插件里有 29 个
一个都猜不出来：

- `dsh-ops` 的工具名是运行时拼的（`ops_` 前缀 + 能力名），源码里根本没有完整字符串；
- `billion-context` 的入口是打包产物，工具名不在可读的源码位置；
- 内置 `skill` 工具是运行时注入的，任何包都不拥有它。

技能行更彻底：`index.js` 里 `row.kind === 'skill'` 时把代码证据强制为 `null`，
所以技能永远不可能有使用时间。

### 修复

- **新增 `lib/attribution.js`**：改用「工具描述指纹」归属。`request/header` 事件里带着
  模型当时看到的完整工具目录（`{ name, description, parameters }`），而描述是注册它的
  包作者自己写的。取描述里 40–120 字符的句子做指纹，到每个包自己的字节里找，就能精确
  反推「哪个包拥有哪个工具」。实测归属：`dsh-builtin-browser` 33 个、`dsh-ops` 13 个、
  `dsh-plugin-studio` 3 个、`dsh-media-lens` 3 个、`dsh-gitbash-shell` 2 个。
  匹配按文件类型加权（`.js` 3 > `.json` 2 > `.md` 1），并跳过 `docs/`、`tests/`、
  `fixtures/`、`vendor/` —— `dsh-ops` 的文档里原样引用了内置 `skill` 工具的描述，
  不跳过就会把它误判成 skill 工具的拥有者。
- **技能行接上真实调用**：`skill` 工具的参数就是 `{ name: "animate" }`，会话日志里完整
  可读。`lib/usage.js` 新增 `skillCalls`，`lastUsedFor` 按技能名精确查表。
- **归属结果落盘缓存**：扫描全部包字节约 2 秒，而答案只在装/卸/升级包时变。缓存键是
  「各包目录 mtime + 顶层文件名」和「注册表工具名 + 描述」的哈希，12 小时过期。
  命中后 2ms。
- **行上带出处**：`row.usedVia` 形如 `tool:ops_read_files` 或 `skill`，作为 `title`
  挂在时间文本上，鼠标悬停能看到是哪一次调用点亮了这一行。

### 结果

同一个 profile 上，有使用时间的行从 3 行变成 5 个插件 + 2 个技能。仍然显示「从没用过」
的 282 个工具属于两种情况，都保持保守处理（宁可显示未使用，不可错误点亮）：

- 工具属于 Harness 自身安装目录里的包（`read`、`write`、`web_fetch`、`plugin_manager`
  等），profile 里没有这些包的源码可查；
- 描述短于 40 字符或过于通用（`present`、`list_agents`、`web_search`），不足以做指纹。

### 测试

- `node scripts/all.mjs --offline` 10/10 通过。

---

## [1.0.1] — 2026-10-30

修掉三个 AI 功能上的缺陷，都是用户直接撞得到的。

### 修复

- **单行「AI 讲解」讲错行数** —— `explain(keys)` 的入口判断 `keys && keys.length` 对字符串恒为真，`row.key` 原样当数组发出去。服务端 `Array.isArray(body.keys)` 为 false，`keys` 退化成 null，`rows` 变成「全部未讲解的行」，再被 `limit`（字符串长度 39）截断。点 1 行实际讲 8 行、耗时约 11 秒，并把 8 条讲解写进 `categories.json`。现在字符串会包成单元素数组，数组原样传，只有 `null`/`undefined` 才回落到选中集。
- **三个 Agent 工具返回非法输出** —— `text()` 返回的是完整 ToolResult 形状 `{ content: [...] }`，但宿主契约要求 `output.render` 直接返回 `ContentBlock[]`。宿主以 `INVALID_TOOL_OUTPUT` 拒绝，`studio_list` / `studio_explain` / `studio_remove` 在 UI 里从未可用。现在直接返回数组，并去掉重复的 `JSON.stringify`。
- **token 统计恒为 0** —— 宿主发的是 `{ type: 'usage', usage: { inputTokens, outputTokens } }`，代码读的是 `chunk.inputTokens`。现在优先读 `chunk.usage`，兼容旧 provider 的扁平写法与下划线命名。

### 改进

- **模型漏答会补问** —— 24 行只回来 23 行时原先静默丢一条。抽出 `askBatch()`，对缺的 key 再问一遍；重试不计入 `asked`/`failed`，单列 `stats.retried`，避免 UI 声称读了比实际更多的行。
- **服务端校验 `keys` 类型** —— `/explain` 对非数组 `keys` 返回 400，而不是静默讲解全部积压。
- **显示 AI 统计** —— `aiStats` state 原本只写不渲染，是死代码。现在接到界面上（模型名、读了几条、回来几条、token 用量），部分成功时用 `explainPartial` 明说「只讲了 23/24 条，其余可再点一次补上」。

### 测试

- `scripts/ai.mjs` 新增两组回归：拒绝非数组 `keys`、工具 `render` 返回 `ContentBlock[]`。
- `node scripts/all.mjs --offline` 10/10 通过。

---

## [1.0.0] — 2026-10-30

第一个正式版本。相对前身 `dsh-modpack` 0.9.1 是一次重写：换了名字、换了界面、
换了分类算法，并补上了原来没有的四件事（删除、使用时间、技能管理、AI 讲解）。

### 新增

**三级自动分类**

- 新增 `lib/classify.js`，实现 8 个一级分类（`FAMILIES`）、17 个二级分类（`DOMAINS`）、三级为插件自身的三层树。
- 分类算法从「规则阶梯」改为「加权评分」：PURPOSE（作者自述，10 分，只投一票）、CAPABILITY（代码实际调用的服务，3–10 分）、AMBIENT（几乎所有插件都有的信号，1–2 分，仅用于打平手）。
- 同分裁决表 `TIE_ORDER = ['tools','net','model','session','ops','core','ui','other']`，更具体的赢，`ui` 永远最后。
- 置信度按 margin 计算（topScore − runnerUp）：`topScore>=8 && margin>=4` 为 high，`topScore>=4 && margin>=2` 为 medium，其余 low。
- 每一行都带 `evidence` 字段说明判定依据，`other` 是「有归属的归档」而非「判断失败」。本机 28 行真实数据上 `other` 命中数为 0。

**批量删除**

- 每行前置复选框，支持单选、多选、全选本组。
- 删除走 `pluginManager.removeBundle()`，不手删文件。
- 依据返回的 `application` 字段决定是否提示重启；`restartReason` 被翻译成人话（`lib/remove.js` 的 `RESTART_TEXT`）：`no-hmr` / `package-moved` / `host-module` / `unmanaged-plugin` / `module-comparison`。
- 不可删的行（官方底座、只读、来源不明）显示锁图标，复选框禁用并说明原因。
- 删除串行执行——每删一个都会重写 profile 依赖与 patch 文件，并发会丢改动。
- 支持 `dryRun`，先看会做什么再决定。

**AI 大白话分析**

- 新增 `lib/ai.js` 与 `lib/remote.js`。
- 结合三类证据推理：代码实际注册的插槽与工具、作者写的描述与 README、GitHub 检索到的仓库 README。
- GitHub 检索要求仓库名或描述里真的出现包名才算命中，防止同名项目误认；结果缓存 7 天。
- 输出 `what`（帮你做什么）/ `remove`（删了会怎样）/ `why`（依据是什么）三段，全部说人话。
- 提示词强制「先说帮你做什么，再说删了会怎样」，不用术语。

**最后使用时间**

- 新增 `lib/usage.js`。
- 数据源优先 `sessionQuery.listSessions()` + `readSession()`，不可用时回落到直接读 `~/.dsh/sessions/**/session.v4.jsonl.zstd`。
- **区分「用过」和「提过」**：`tool/call` 命中插件注册的工具名才算真用过（`usedAt`/`usedVia`），名字被提到只记为 `mentionedAt`，以次要样式显示。
- 实现 `decompressFrames()`：`session.v4.jsonl.zstd` 是多帧 zstd 拼接，按 magic `28 B5 2F FD` 扫描全部帧偏移逐帧解压——单次 `zstdDecompressSync(整个文件)` 只能解出第一帧。

**技能管理页**

- 新增 `lib/skills.js`，与插件页功能对等：三级分类、搜索筛选、复选框批量删除、一键打包、启用/禁用。
- 扫描四个根目录：`<DSH_HOME>/skills`、`<DSH_HOME>/agents/skills`、`<cwd>/.dsh/skills`、`<cwd>/.agents/skills`。
- 优先用 `skills.list()` 服务，拿不到则自扫目录读 `SKILL.md` frontmatter。
- 删除技能有两道守卫：必须是目录、目录里必须有 `SKILL.md`。
- 技能二级分类比插件更细：`tools.skill.doc`（文档处理）、`tools.skill.dev`（开发与诊断）、`tools.skill`（其它）。

**重新设计的界面**

- 重命名：「插件整合包」→「插件工坊」，包名 `dsh-modpack` → `dsh-plugin-studio`，接口前缀 `/api/dsh-plugin-studio`。
- 三个 tab：插件 / 技能 / 整合包。
- 视图可在「三级树」与「平铺列表」之间切换，树可逐级折叠，每个分组带「全选本组」。
- 只用 13 个 `--dsw-alias-*` / `--dsw-specific-*` 主题 token，零硬编码色值，深浅色自动跟随。
- 不碰别人的 DOM：不 append 到 `document.body`、不查询别人元素、不用 `innerHTML`。
- 单个 `<style>` 标签，用 `ctx.effect()` 注册清理。
- 客户端/宿主 API 版本不一致时，页面顶部显示红条提示重启，而不是静默渲染空白。

**跨版本兼容**

- 新增 `lib/caps.js`，按**方法存在性**探测能力而非版本号。
- 新增 `scripts/compat.mjs`，为 5 个契约建模验证：`0.2.1-rc.1`、`0.2.1-rc.2`、`0.2.1-rc.3`、`future-additive`（只加不改）、`future-renamed`（删掉 `listBundles`，验证文件回落）。
- `pluginManager` 不可用或 `listBundles` 抛错时，回落到直接读 profile 的 `package.json` 与 `cordis.patch.yml`。

**Agent 工具**

- `studio_list`：列出插件或技能（带三级分类）。
- `studio_explain`：讲解某个插件。
- `studio_remove`：删除插件（支持 `dryRun`）。

**测试套件**

- 新增 8 个套件：`smoke` / `analyse` / `routes` / `actions` / `ai` / `style` / `render` / `compat`，全部不需要启动 GUI。
- 新增 3 个调试脚本：`scores`（评分明细）、`why`（某行为何这样分类）、`measure`（headless Edge 量布局）。
- `style.mjs` 审计模块契约：自定义属性必须在 14 个合法 token 内、禁止硬编码色值、禁止 `document.body` / `innerHTML` / `dangerouslySetInnerHTML` / `document.querySelector`、必须走 `__ModuleLoader__.load` 且只 `require('react')`。
- `render.mjs` 用最小 React 替身把 `Panel` 渲染成真实 HTML 并断言结构。
- `measure.mjs` 用 headless Edge 在真实浏览器里量布局：缩进、溢出、行高、token 有效性。

### 变更

- 整合包格式：`dsh-modpack` 的 `.dshmodpack.json` → `dsh-plugin-studio-pack`（`formatVersion: 1`），条目里多带 `category` 三级分类信息。
- 存储目录：`<DSH_HOME>/storages/dsh-modpack` → `<DSH_HOME>/storages/dsh-plugin-studio`。
- 分类建议接口：`/categories/suggest` → `/suggest`（同时承担 AI 分类与 AI 讲解）。
- 主入口 slot 仍是 `settings.section`（order 18）。`settings.plugins.tab` 已弃用——当前 build 接受注册但不渲染 tab 条。

### 修复

这些是开发过程中真实踩到并修掉的 bug，记下来是因为它们都很容易复发：

- **分类器读文件预算太小**：`CODE_FILE_MAX = 96*1024` 会把 `dsh-modpack/client.js`（129698 字节）截断，而它的 `seat('settings.section', ...)` 在文件末尾第 2535 行，被截掉后 slots 为空导致误判。改为 `FILE_MAX = 2MB` / `TOTAL_MAX = 8MB` / `MAX_FILES = 40`。
- **入口文件只认固定名**：原只读 `client.js` / `index.js` / `lib/*`，而 `billion-context` 的代码在 `dist/agent/dsh-native.js`（由 `exports` 指向），读到 0 字节。改为从 `pkg.main` / `pkg.module` / 递归展开 `pkg.exports` / `pkg.dsh.client.entry` 推导，再补约定名，再扫一层目录。
- **分类器读到自己**：`mcp` 正则含裸 `mcp`，匹配到了 `lib/classify.js` 里自己的注释和正则字面量。改为 `/@modelcontextprotocol\/sdk|new\s+McpServer\s*\(|mcpServers\s*[:=]\s*\{|["'`]mcp__[a-z]/`。**教训：任何信号正则都不得匹配到正则字面量本身。**
- **官方可选包被误判成内核**：core 规则原为 `official && availability==='installation'`，但所有官方可选实验包也满足，导致 19 行全落「系统与内核」。加 `&& optional !== true`。
- **「被提到」被当成「被使用」**：无 tool 命中时回落到 `mentions`，结果讨论插件时所有插件都显示「刚刚使用」，28 行里 19 行有时间。改为分级返回 `{time, via, strong, weak}`。
- **`classifyAll` 返回 Map 却被当对象索引**：`index.js` 里 `verdicts[row.key]` 应为 `verdicts.get(row.key)`，导致 HTTP 路由 500。库函数单测全过，只有路由真调才暴露。
- **会话文件路径层级写死**：`listSessionFiles()` 原写死两级 `sessions/<slug>/<file>`，实际是三层 `sessions/<slug>/session-<uuid>/session.v4.jsonl.zstd`，导致扫到 0 个文件。改为递归 4 层。
- **主题插件判定方向反了**：`THEME_RE` 原含 `--dsw-alias-`，导致任何写 CSS 的插件都被判成主题插件。改为匹配 `overrideTokens(` / `theme.register(` / `setTheme(` / `registerTheme`——主题插件是**改** token，普通 UI 插件只是**用** token。
- **技能全部挤在一个二级分类**：`classifyFacts` 的 skill 快速路径硬编码 `domain: 'tools.skill'`，绕过 DOMAINS 匹配器；且 `rowFacts` 不含 `whenToUse` 与 `bodyHead`。改为用同一套匹配器解析 domain，并把技能文本拼进 `text`。
- **`/skills` 缺 `roots` 字段**：`analyse()` 返回值没有 `roots`，UI 无法显示搜索路径。补上，插件分支报 profile 目录，技能分支报实际扫描到的根。
- **测试依赖环境数据**：多个断言写死「本机装了 dsh-modpack」或「至少有若干行能算出使用时间」，卸载后必挂。改为用合成记录测规则本身，破坏性测试末尾自清理持久状态。

### 移除

- 卸载前身 `dsh-modpack` 0.9.1（`plugin_manager remove_bundle`，`application: applied`，profile 依赖与 bundle 列表均已移除）。
- 移除 `settings.plugins.tab` 注册点（当前 build 不渲染）。
- 移除旧版「手动确认每个分类建议」的流程，改为 AI 批量分类 + 结果可改判。

### 已知限制

- 本机只安装了 `0.2.1-rc.3`，`0.2.1-rc.1` / `0.2.1-rc.2` 无法真实安装验证。`scripts/compat.mjs` 做的是契约级验证（模拟各版本的服务面），等价于「按接口编程」的验证，不等价于「真的在 rc.1 上跑过」。
- AI 功能需要可用的模型。无模型时 `/explain` 与 `/suggest` 会返回 `available: false` 并说明原因，不会抛异常，也不会静默改判。
- GitHub 检索需要网络。无网络时降级为「只用本地证据」，分类结果仍然完整，只是证据少一路。
- 技能的「启用/禁用」通过写 `.disabled` 标记文件实现，是否被 Harness 采纳取决于版本。

---

## 版本号约定

- **主版本号**：整合包格式或存储结构不兼容变更；
- **次版本号**：新增功能（向下兼容）；
- **修订号**：修 bug、改文案、调样式。

`engines.dsh` 声明最低支持的 Harness 版本。但由于能力是按方法存在性探测的，
新版本 Harness 通常不需要改本插件——除非某个 Service 的方法签名发生不兼容变更，
届时会在本文件的「变更」或「移除」段说明。
