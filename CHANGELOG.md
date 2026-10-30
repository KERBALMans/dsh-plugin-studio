# 更新日志

本文件记录插件工坊（`dsh-plugin-studio`）的所有版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
